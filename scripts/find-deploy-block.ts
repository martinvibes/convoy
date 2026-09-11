/**
 * Recover the block a contract was deployed at, by binary search on eth_getCode.
 *
 * Creditcoin's public RPC times out on an unbounded eth_getLogs, so every log scan needs a floor.
 * Deploy scripts record that floor going forward; this recovers it for a deployment that predates
 * them, and is the fix for "query timeout of 10 seconds exceeded" rather than retrying harder.
 */
import { JsonRpcProvider } from 'ethers';
import { readDeployments, writeDeployments, CREDITCOIN_RPC } from './lib.js';

const provider = new JsonRpcProvider(CREDITCOIN_RPC, undefined, { staticNetwork: true });
const address = process.argv[2] ?? readDeployments().RELAYER_BOND_ADDRESS;
if (!address) throw new Error('no address given and RELAYER_BOND_ADDRESS not in deployments.json');

const head = await provider.getBlockNumber();
let absent = Math.max(head - 200_000, 1);
let present = head;

if ((await provider.getCode(address, absent)) !== '0x') {
  throw new Error(`${address} already existed at block ${absent}; widen the search window`);
}

while (absent + 1 < present) {
  const mid = Math.floor((absent + present) / 2);
  if ((await provider.getCode(address, mid)) === '0x') absent = mid;
  else present = mid;
}

console.log(`${address} first has code at block ${present} (head ${head})`);

if (!process.argv[2]) {
  const d = readDeployments();
  d.DEPLOY_BLOCK = String(present);
  writeDeployments(d);
  console.log('recorded DEPLOY_BLOCK in deployments.json');
}
