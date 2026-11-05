const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const AMT = 1_000_000n; // 1 USDC
const PAISE = 9876n;
const UPI = ethers.id("merchant@upi");
const UTR = ethers.id("UTR123");

async function sign(attestor, escrow, id, lp, paise, utr) {
  const { chainId } = await ethers.provider.getNetwork();
  const inner = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "uint256", "address", "uint256", "bytes32"],
      [chainId, await escrow.getAddress(), id, lp, paise, utr]
    )
  );
  return attestor.signMessage(ethers.getBytes(inner));
}

async function setup() {
  const [payer, lp, attestor, other, arbiter] = await ethers.getSigners();
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const escrow = await (await ethers.getContractFactory("UpiEscrow")).deploy(await usdc.getAddress(), attestor.address, arbiter.address, 900, 600, 5000);
  await usdc.mint(payer.address, 10n * AMT);
  await usdc.connect(payer).approve(await escrow.getAddress(), 10n * AMT);
  await escrow.connect(payer).createOrder(AMT, PAISE, UPI);
  await usdc.mint(lp.address, 10n * AMT);
  await usdc.connect(lp).approve(await escrow.getAddress(), 10n * AMT);
  await escrow.connect(lp).depositStake(5n * AMT);
  return { usdc, escrow, payer, lp, attestor, other, arbiter };
}

describe("UpiEscrow", () => {
  const prove = async (escrow, lp, attestor, id = 1n) => {
    await escrow.connect(lp).acceptOrder(id);
    await escrow.submitProof(id, UTR, await sign(attestor, escrow, id, lp.address, PAISE, UTR));
  };

  it("proof alone does not pay the LP", async () => {
    const { usdc, escrow, lp, attestor } = await setup();
    await prove(escrow, lp, attestor);
    expect(await usdc.balanceOf(lp.address)).to.equal(5n * AMT);
  });

  it("payer confirmation pays the LP immediately", async () => {
    const { usdc, escrow, payer, lp, attestor } = await setup();
    await prove(escrow, lp, attestor);
    await escrow.connect(payer).confirm(1);
    expect(await usdc.balanceOf(lp.address)).to.equal(5n * AMT + AMT);
  });

  it("only the payer can confirm", async () => {
    const { escrow, lp, attestor, other } = await setup();
    await prove(escrow, lp, attestor);
    await expect(escrow.connect(other).confirm(1)).to.be.revertedWithCustomError(escrow, "NotAuthorized");
  });

  it("LP can claim only after the dispute window", async () => {
    const { usdc, escrow, lp, attestor } = await setup();
    await prove(escrow, lp, attestor);
    await expect(escrow.connect(lp).claim(1)).to.be.revertedWithCustomError(escrow, "TooEarly");
    await time.increase(601);
    await escrow.connect(lp).claim(1);
    expect(await usdc.balanceOf(lp.address)).to.equal(5n * AMT + AMT);
  });

  it("dispute blocks claim; arbiter can refund the payer", async () => {
    const { usdc, escrow, payer, lp, attestor, arbiter } = await setup();
    await prove(escrow, lp, attestor);
    await escrow.connect(payer).dispute(1);
    await time.increase(601);
    await expect(escrow.connect(lp).claim(1)).to.be.revertedWithCustomError(escrow, "BadState");
    await expect(escrow.connect(lp).resolve(1, true)).to.be.revertedWithCustomError(escrow, "NotAuthorized");
    await escrow.connect(arbiter).resolve(1, false);
    expect(await usdc.balanceOf(payer.address)).to.equal(10n * AMT + AMT / 2n);
  });

  it("arbiter can rule for the LP", async () => {
    const { usdc, escrow, payer, lp, attestor, arbiter } = await setup();
    await prove(escrow, lp, attestor);
    await escrow.connect(payer).dispute(1);
    await escrow.connect(arbiter).resolve(1, true);
    expect(await usdc.balanceOf(lp.address)).to.equal(5n * AMT + AMT);
  });

  it("cannot dispute after the window", async () => {
    const { escrow, payer, lp, attestor } = await setup();
    await prove(escrow, lp, attestor);
    await time.increase(601);
    await expect(escrow.connect(payer).dispute(1)).to.be.revertedWithCustomError(escrow, "TooEarly");
  });

  it("rejects a proof signed by anyone but the attestor", async () => {
    const { escrow, lp, other } = await setup();
    await escrow.connect(lp).acceptOrder(1);
    await expect(escrow.submitProof(1, UTR, await sign(other, escrow, 1n, lp.address, PAISE, UTR))).to.be.revertedWithCustomError(escrow, "BadProof");
  });

  it("rejects a proof for a different LP", async () => {
    const { escrow, lp, attestor, other } = await setup();
    await escrow.connect(lp).acceptOrder(1);
    await expect(escrow.submitProof(1, UTR, await sign(attestor, escrow, 1n, other.address, PAISE, UTR))).to.be.revertedWithCustomError(escrow, "BadProof");
  });

  it("cannot pay out twice", async () => {
    const { escrow, payer, lp, attestor } = await setup();
    await prove(escrow, lp, attestor);
    await escrow.connect(payer).confirm(1);
    await expect(escrow.connect(payer).confirm(1)).to.be.revertedWithCustomError(escrow, "BadState");
  });

  it("payer can cancel an unaccepted order", async () => {
    const { usdc, escrow, payer } = await setup();
    await escrow.connect(payer).refund(1);
    expect(await usdc.balanceOf(payer.address)).to.equal(10n * AMT);
  });

  it("payer can only refund an accepted order after the pay window", async () => {
    const { usdc, escrow, payer, lp } = await setup();
    await escrow.connect(lp).acceptOrder(1);
    await expect(escrow.connect(payer).refund(1)).to.be.revertedWithCustomError(escrow, "TooEarly");
    await time.increase(901);
    await escrow.connect(payer).refund(1);
    expect(await usdc.balanceOf(payer.address)).to.equal(10n * AMT + AMT / 2n);
  });

  it("only the payer can refund", async () => {
    const { escrow, other } = await setup();
    await expect(escrow.connect(other).refund(1)).to.be.revertedWithCustomError(escrow, "NotAuthorized");
  });

  it("LP cannot accept without enough stake", async () => {
    const { escrow, other } = await setup();
    await expect(escrow.connect(other).acceptOrder(1)).to.be.revertedWithCustomError(escrow, "InsufficientStake");
  });

  it("locks stake on accept and unlocks after payout", async () => {
    const { escrow, payer, lp, attestor } = await setup();
    await prove(escrow, lp, attestor);
    expect(await escrow.stake(lp.address)).to.equal(5n * AMT - AMT / 2n);
    await escrow.connect(payer).confirm(1);
    expect(await escrow.stake(lp.address)).to.equal(5n * AMT);
  });

  it("LP that misses the pay window is slashed to the payer", async () => {
    const { usdc, escrow, payer, lp } = await setup();
    await escrow.connect(lp).acceptOrder(1);
    await time.increase(901);
    await escrow.connect(payer).refund(1);
    expect(await usdc.balanceOf(payer.address)).to.equal(10n * AMT + AMT / 2n);
    expect(await escrow.stake(lp.address)).to.equal(5n * AMT - AMT / 2n);
  });

  it("locked stake cannot be withdrawn", async () => {
    const { escrow, lp } = await setup();
    await escrow.connect(lp).acceptOrder(1);
    await expect(escrow.connect(lp).withdrawStake(5n * AMT)).to.be.revertedWithCustomError(escrow, "InsufficientStake");
    await escrow.connect(lp).withdrawStake(4n * AMT);
  });
});
