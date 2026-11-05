// Dev launcher: local chain + deploy + app server. Hardhat accounts are the well-known test keys; never use them on a real network.
const { spawn } = require('node:child_process');
const { ethers } = require('ethers');
const { start } = require('./server');

const RPC = 'http://127.0.0.1:8545';
const ATTESTOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // hardhat #1
const ARBITER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'; // hardhat #2
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // hardhat #0

(async () => {
  const node = spawn('npx', ['hardhat', 'node'], { stdio: 'ignore' });
  process.on('exit', () => node.kill());
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });
  for (let i = 0; i < 60; i++) {
    try { await provider.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const art = (n) => require(`../artifacts/contracts/${n}.sol/${n}.json`);
  const deploy = async (n, args = []) => {
    const f = new ethers.ContractFactory(art(n).abi, art(n).bytecode, deployer);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return c.getAddress();
  };
  const usdc = await deploy('MockUSDC');
  const attestorAddr = new ethers.Wallet(ATTESTOR_KEY).address;
  const escrow = await deploy('UpiEscrow', [usdc, attestorAddr, new ethers.Wallet(ARBITER_KEY).address, 900, Number(process.env.DISPUTE_WINDOW || 120), 5000]);
  const { chainId } = await provider.getNetwork();
  const rate = Number(process.env.RATE || 98.76); // INR per USDC, fixed for the demo
  await start({ rpc: RPC, escrow, usdc, attestorKey: ATTESTOR_KEY, arbiterKey: ARBITER_KEY, rate, chainId: Number(chainId), port: Number(process.env.PORT || 8788) });
  console.log(`payer:  http://localhost:${process.env.PORT || 8788}/\nLP:     http://localhost:${process.env.PORT || 8788}/lp\nescrow: ${escrow}`);
})();
