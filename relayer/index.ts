/**
 * Convoy relayer.
 *
 * Watches the source chain for events that somebody has paid to receive, groups them into convoys,
 * buys one continuity proof for the group, and delivers them to Creditcoin in a single transaction.
 *
 * Run `tsx relayer/index.ts --dry-run` to exercise the batching policy with synthetic traffic and
 * no chain, no keys and no funds. Everything else needs a funded, bonded relayer key.
 */
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { chainInfo, proofProvider } from '@gluwa/usc-sdk';
import { config, abiOf } from './config.js';
import { planBatch, savings, modelledCostCtc, type PendingItem } from './batcher.js';

interface Route {
  subId: string;
  emitter: string;
  topic0: string;
  callback: string;
  active: boolean;
}

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

async function discoverRoutes(registry: Contract): Promise<Route[]> {
  const events = await registry.queryFilter(registry.filters.Subscribed(), 0, 'latest');
  const routes: Route[] = [];
  const seen = new Set<string>();

  for (const ev of events) {
    const subId: string = (ev as any).args.subId;
    if (seen.has(subId)) continue;
    seen.add(subId);
    const s = await registry.get(subId);
    routes.push({
      subId,
      emitter: s.emitter,
      topic0: s.topic0,
      callback: s.callback,
      active: s.active,
    });
  }
  return routes.filter((r) => r.active);
}

async function collect(
  source: JsonRpcProvider,
  routes: Route[],
  fromBlock: number,
  toBlock: number,
  now: number,
): Promise<PendingItem[]> {
  const emitters = [...new Set(routes.map((r) => r.emitter))];
  const topics = [...new Set(routes.map((r) => r.topic0))];
  if (emitters.length === 0) return [];

  const logs = await source.getLogs({
    address: emitters,
    topics: [topics],
    fromBlock,
    toBlock,
  });

  // One transaction can carry several subscribed logs. Convoy proves transactions, not logs, so
  // deduplicate here or the same proof gets bought twice.
  const byTx = new Map<string, PendingItem>();
  for (const l of logs) {
    if (!byTx.has(l.transactionHash)) {
      byTx.set(l.transactionHash, {
        txHash: l.transactionHash,
        blockNumber: l.blockNumber,
        seenAt: now,
      });
    }
  }
  return [...byTx.values()];
}

async function deliverConvoy(
  router: Contract,
  builder: proofProvider.service.ProofBuilder,
  chainInfoProvider: chainInfo.PrecompileChainInfoProvider,
  batch: PendingItem[],
): Promise<void> {
  const chainKey = config.sourceChainKey;
  const highest = Math.max(...batch.map((i) => i.blockNumber));

  log(`convoy of ${batch.length}: waiting for block ${highest} to be attested`);
  await chainInfoProvider.waitUntilHeightAttested(chainKey, highest);

  const result = await builder.getBatchProof(batch.map((i) => i.txHash));
  if (!result.success || !result.data) {
    throw new Error(`batch proof generation failed: ${result.error}`);
  }
  const data = result.data;

  // Flatten the nested proof map into the parallel arrays the router expects.
  const heights: number[] = [];
  const txBytes: string[] = [];
  const merkleProofs: unknown[] = [];
  for (const [headerNumber, proofsMap] of data.merkleProofs.entries()) {
    for (const [, entry] of proofsMap.entries()) {
      heights.push(headerNumber);
      txBytes.push(entry.txBytes);
      merkleProofs.push(entry.merkleProof);
    }
  }

  const hashes = data.continuityProof.roots.length;
  const s = savings(heights.length, hashes);
  log(
    `one continuity proof of ${hashes} hashes for ${heights.length} transactions ` +
      `(${s.hashesAlone} hashes if delivered alone, ${s.factor.toFixed(1)}x)`,
  );

  const tx = await router.deliver(chainKey, heights, txBytes, merkleProofs, data.continuityProof);
  const receipt = await tx.wait();

  log(
    `delivered in ${receipt.hash} | gas ${receipt.gasUsed} | ` +
      `modelled alone ${modelledCostCtc(hashes) * heights.length} CTC vs convoy ${modelledCostCtc(hashes)} CTC`,
  );
}

function dryRun(): void {
  log('dry run: batching policy against synthetic traffic, no chain touched');
  const policy = {
    maxBatchSize: config.maxBatchSize,
    maxBatchRange: config.maxBatchRange,
    maxWaitMs: config.maxWaitMs,
  };
  const now = Date.now();

  const scenarios: Array<[string, PendingItem[], number]> = [
    [
      'one dApp alone: three of its own events in a 1000-block window, none of them urgent',
      [0, 1, 2].map((i) => ({ txHash: `0xaa${i}`, blockNumber: 9_000_000 + i * 40, seenAt: now })),
      now,
    ],
    [
      'shared rail: ten events from unrelated dApps land in the same window',
      Array.from({ length: 10 }, (_, i) => ({
        txHash: `0xbb${i}`,
        blockNumber: 9_000_000 + i * 70,
        seenAt: now,
      })),
      now,
    ],
    [
      'thin traffic: two events, the older one has run out of patience',
      [
        { txHash: '0xcc0', blockNumber: 9_000_000, seenAt: now - policy.maxWaitMs - 1 },
        { txHash: '0xcc1', blockNumber: 9_000_050, seenAt: now },
      ],
      now,
    ],
    [
      'range split: one event sits far outside the anchor window',
      [
        { txHash: '0xdd0', blockNumber: 9_000_000, seenAt: now - policy.maxWaitMs - 1 },
        { txHash: '0xdd1', blockNumber: 9_004_000, seenAt: now - policy.maxWaitMs - 1 },
      ],
      now,
    ],
  ];

  for (const [name, pending, at] of scenarios) {
    const plan = planBatch(pending, at, policy);
    const hashes = 1000; // a block old enough to need a checkpoint-length continuity proof
    console.log(`\n  ${name}`);
    console.log(`    ship: ${plan.batch.length}  hold: ${plan.remaining.length}  reason: ${plan.reason}`);
    if (plan.batch.length > 0) {
      const s = savings(plan.batch.length, hashes);
      console.log(
        `    continuity hashes ${s.hashesAlone} alone vs ${s.hashesInConvoy} in convoy (${s.factor.toFixed(1)}x)`,
      );
      console.log(
        `    modelled CTC ${(modelledCostCtc(hashes) * plan.batch.length).toFixed(6)} alone vs ` +
          `${modelledCostCtc(hashes).toFixed(6)} in convoy`,
      );
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  if (process.argv.includes('--dry-run')) {
    dryRun();
    return;
  }

  const source = new JsonRpcProvider(config.sourceRpc());
  const creditcoin = new JsonRpcProvider(config.creditcoinRpc);
  const wallet = new Wallet(config.relayerKey(), creditcoin);

  const registry = new Contract(config.registryAddress(), abiOf('SubscriptionRegistry'), creditcoin);
  const router = new Contract(config.routerAddress(), abiOf('ConvoyRouter'), wallet);
  const bond = new Contract(config.bondAddress(), abiOf('RelayerBond'), creditcoin);

  if (!(await bond.isBonded(wallet.address))) {
    throw new Error(`relayer ${wallet.address} is not bonded. Run scripts/bond.ts first.`);
  }

  const builder = new proofProvider.service.ProofBuilder(config.sourceChainKey, config.proofBuilderUrl);
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoin);

  const routes = await discoverRoutes(registry);
  log(`relaying as ${wallet.address} for ${routes.length} active subscriptions`);
  for (const r of routes) log(`  route ${r.emitter} / ${r.topic0.slice(0, 10)} -> ${r.callback}`);

  let cursor = await source.getBlockNumber();
  let pending: PendingItem[] = [];
  const policy = {
    maxBatchSize: config.maxBatchSize,
    maxBatchRange: config.maxBatchRange,
    maxWaitMs: config.maxWaitMs,
  };

  for (;;) {
    try {
      const head = await source.getBlockNumber();
      if (head >= cursor) {
        const found = await collect(source, routes, cursor, head, Date.now());
        if (found.length > 0) log(`picked up ${found.length} transaction(s) in blocks ${cursor}..${head}`);
        pending.push(...found);
        cursor = head + 1;
      }

      const plan = planBatch(pending, Date.now(), policy);
      if (plan.batch.length > 0) {
        log(`shipping convoy (${plan.reason}): ${plan.batch.length} transactions`);
        await deliverConvoy(router, builder, chainInfoProvider, plan.batch);
        pending = plan.remaining;
      }
    } catch (err) {
      log('cycle failed, will retry:', (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
