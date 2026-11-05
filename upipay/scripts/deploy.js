// npx hardhat run scripts/deploy.js --network baseSepolia
// Env: DEPLOYER_KEY, ATTESTOR_ADDRESS, ARBITER_ADDRESS; optional USDC_ADDRESS, PAY_WINDOW, DISPUTE_WINDOW, STAKE_BPS.
// Without USDC_ADDRESS a MockUSDC is deployed (local / throwaway testnets only).
const fs = require('node:fs');
const hre = require('hardhat');

// Circle's testnet USDC on Base Sepolia.
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const attestor = process.env.ATTESTOR_ADDRESS || deployer.address;
  const arbiter = process.env.ARBITER_ADDRESS || deployer.address;
  if (hre.network.name === 'baseSepolia' && (!process.env.ATTESTOR_ADDRESS || !process.env.ARBITER_ADDRESS)) {
    throw new Error('Set ATTESTOR_ADDRESS and ARBITER_ADDRESS explicitly for a shared testnet');
  }

  let usdc = process.env.USDC_ADDRESS || (hre.network.name === 'baseSepolia' ? BASE_SEPOLIA_USDC : null);
  if (!usdc) {
    const mock = await (await hre.ethers.getContractFactory('MockUSDC')).deploy();
    await mock.waitForDeployment();
    usdc = await mock.getAddress();
  }

  const F = await hre.ethers.getContractFactory('UpiEscrow');
  const escrow = await F.deploy(
    usdc, attestor, arbiter,
    Number(process.env.PAY_WINDOW || 900), Number(process.env.DISPUTE_WINDOW || 600), Number(process.env.STAKE_BPS || 5000)
  );
  await escrow.waitForDeployment();
  const receipt = await escrow.deploymentTransaction().wait();
  const out = { network: hre.network.name, chainId: Number((await hre.ethers.provider.getNetwork()).chainId), usdc, escrow: await escrow.getAddress(), attestor, arbiter, fromBlock: receipt.blockNumber };
  fs.writeFileSync('deployment.json', JSON.stringify(out, null, 2));
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
