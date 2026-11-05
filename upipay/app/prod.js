// Production-style launcher: uses deployment.json from scripts/deploy.js. No faucet, no dev arbiter endpoint.
// Env: RPC_URL, ATTESTOR_KEY (must match the deployed attestor), PORT, SPREAD_PCT, RATE (fallback INR/USDC).
const fs = require('node:fs');
const { start } = require('./server');

const d = JSON.parse(fs.readFileSync('deployment.json', 'utf8'));
if (!process.env.RPC_URL || !process.env.ATTESTOR_KEY) throw new Error('RPC_URL and ATTESTOR_KEY are required');

start({
  rpc: process.env.RPC_URL,
  escrow: d.escrow,
  usdc: d.usdc,
  chainId: d.chainId,
  fromBlock: d.fromBlock,
  attestorKey: process.env.ATTESTOR_KEY,
  rate: Number(process.env.RATE || 90),
  spreadPct: Number(process.env.SPREAD_PCT || 1),
  enableFaucet: false,
  port: Number(process.env.PORT || 8788),
}).then(() => console.log('up on', process.env.PORT || 8788));
