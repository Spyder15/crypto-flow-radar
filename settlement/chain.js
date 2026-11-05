import { createPublicClient, http, parseAbiItem, parseEventLogs } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export const getHead = () => client.getBlockNumber();

// Returns every ERC-20 Transfer in the tx so wrong-token / wrong-recipient claims can be told apart.
export async function transfersInTx(txHash) {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') return [];
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return parseEventLogs({ abi: [transferEvent], logs: receipt.logs }).map((l) => ({
    txHash,
    logIndex: l.logIndex,
    token: l.address,
    from: l.args.from,
    to: l.args.to,
    value: l.args.value,
    blockNumber: receipt.blockNumber,
    blockTime: Number(block.timestamp) * 1000,
  }));
}
