/**
 * Print what Convoy has actually done on chain. The same numbers the dashboard shows, for anyone
 * reading this repo without a browser open.
 */
import { JsonRpcProvider, Contract, formatEther } from 'ethers';
import { readDeployments, need, CREDITCOIN_RPC } from './lib.js';
import { abiOf } from '../relayer/config.js';

const d = readDeployments();
const provider = new JsonRpcProvider(CREDITCOIN_RPC, undefined, { staticNetwork: true });
const from = Number(d.DEPLOY_BLOCK ?? 0);

const router = new Contract(need('CONVOY_ROUTER_ADDRESS'), abiOf('ConvoyRouter'), provider);
const registry = new Contract(
  need('SUBSCRIPTION_REGISTRY_ADDRESS'),
  abiOf('SubscriptionRegistry'),
  provider,
);

const [batches, queries, hashes, facts] = await Promise.all([
  router.totalBatches(),
  router.totalQueriesVerified(),
  router.totalContinuityHashes(),
  router.totalFactsDelivered(),
]);

console.log(`router ${await router.getAddress()}`);
console.log(`  convoys delivered     ${batches}`);
console.log(`  transactions proven   ${queries}`);
console.log(`  continuity hashes     ${hashes}`);
console.log(`  facts handed to apps  ${facts}`);

const convoys = await router.queryFilter(router.filters.ConvoyDelivered(), from, 'latest');
let alone = 0;
let shared = 0;
console.log(`\nper convoy:`);
for (const ev of convoys as any[]) {
  const q = Number(ev.args.queries);
  const h = Number(ev.args.continuityHashes);
  alone += q * h;
  shared += h;
  console.log(
    `  block ${ev.blockNumber}  ${q} transactions  ${h} hashes shared  ` +
      `(${q * h} if delivered alone, ${(q).toFixed(1)}x)`,
  );
}

// The published model: a flat cost per verification call plus one term per continuity hash.
const cost = (h: number, proofs: number) => 2.3e-5 * proofs + 2.9e-7 * h;
const aloneProofs = (convoys as any[]).reduce((s, e) => s + Number(e.args.queries), 0);
if (convoys.length > 0) {
  console.log(
    `\nmodelled cost  alone ${cost(alone, aloneProofs).toFixed(8)} CTC` +
      `  vs convoy ${cost(shared, convoys.length).toFixed(8)} CTC` +
      `  (${(cost(alone, aloneProofs) / cost(shared, convoys.length)).toFixed(1)}x)`,
  );
}

const skips = await router.queryFilter(router.filters.QuerySkipped(), from, 'latest');
const REASON: Record<number, string> = {
  1: 'already delivered',
  2: 'source transaction failed',
  3: 'unsupported transaction type',
};
console.log(`\nrefused: ${skips.length}`);
for (const ev of skips as any[]) {
  console.log(`  block ${ev.blockNumber}  ${REASON[Number(ev.args.reason)] ?? 'unknown'}`);
}

console.log(`\nsubscriptions:`);
const subs = await registry.queryFilter(registry.filters.Subscribed(), from, 'latest');
for (const ev of subs as any[]) {
  const s = await registry.get(ev.args.subId);
  const label =
    [
      ['passport', d.PASSPORT_ADDRESS],
      ['escrow', d.ESCROW_ADDRESS],
      ['council', d.COUNCIL_ADDRESS],
    ].find(([, a]) => a?.toLowerCase() === s.callback.toLowerCase())?.[0] ?? s.callback;
  console.log(
    `  ${String(label).padEnd(10)} ${s.active ? 'listening' : 'paused  '}  ` +
      `${formatEther(s.balance)} CTC left at ${formatEther(s.feePerDelivery)} per delivery`,
  );
}
