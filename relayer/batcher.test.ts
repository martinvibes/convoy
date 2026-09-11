/**
 * Batching policy tests. Plain node:test, no chain.
 * Run with: npx tsx --test relayer/batcher.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatch, savings, modelledCostCtc, type PendingItem } from './batcher.js';

const policy = { maxBatchSize: 10, maxBatchRange: 1000, maxWaitMs: 180_000 };
const NOW = 1_800_000_000_000;

const item = (block: number, ageMs = 0): PendingItem => ({
  txHash: `0x${block.toString(16)}`,
  blockNumber: block,
  seenAt: NOW - ageMs,
});

test('a lone dApp with a few fresh events ships nothing and keeps waiting', () => {
  const plan = planBatch([item(9_000_000), item(9_000_040), item(9_000_080)], NOW, policy);
  assert.equal(plan.batch.length, 0);
  assert.equal(plan.remaining.length, 3);
  assert.equal(plan.reason, 'none');
});

test('a full window ships immediately', () => {
  const pending = Array.from({ length: 10 }, (_, i) => item(9_000_000 + i * 70));
  const plan = planBatch(pending, NOW, policy);
  assert.equal(plan.batch.length, 10);
  assert.equal(plan.reason, 'full');
  assert.equal(plan.remaining.length, 0);
});

test('an item past its deadline drags its window out of the door', () => {
  const plan = planBatch([item(9_000_000, 200_000), item(9_000_050)], NOW, policy);
  assert.equal(plan.batch.length, 2);
  assert.equal(plan.reason, 'deadline');
});

test('an item outside the block range starts the next convoy instead of blocking this one', () => {
  const plan = planBatch([item(9_000_000, 200_000), item(9_004_000, 200_000)], NOW, policy);
  assert.equal(plan.batch.length, 1);
  assert.equal(plan.remaining.length, 1);
  assert.equal(plan.remaining[0].blockNumber, 9_004_000);
});

test('a waiting window ships early when something behind it is already overdue', () => {
  // Two fresh items in the anchor window, one overdue item far outside it. The overdue item cannot
  // ship until the anchor window clears, so the anchor window must go now.
  const plan = planBatch(
    [item(9_000_000), item(9_000_010), item(9_005_000, 200_000)],
    NOW,
    policy,
  );
  assert.equal(plan.batch.length, 2);
  assert.equal(plan.reason, 'range');
  assert.equal(plan.remaining.length, 1);
});

test('never exceeds the precompile batch size', () => {
  const pending = Array.from({ length: 25 }, (_, i) => item(9_000_000 + i * 10, 200_000));
  const plan = planBatch(pending, NOW, policy);
  assert.equal(plan.batch.length, policy.maxBatchSize);
  assert.equal(plan.remaining.length, 15);
});

test('empty input is a no-op', () => {
  const plan = planBatch([], NOW, policy);
  assert.equal(plan.reason, 'none');
  assert.equal(plan.batch.length, 0);
});

test('savings scale with batch size against a fixed continuity proof', () => {
  const s = savings(10, 1000);
  assert.equal(s.hashesAlone, 10_000);
  assert.equal(s.hashesInConvoy, 1000);
  assert.equal(s.factor, 10);
});

test('cost model matches the documented figures', () => {
  // ~10 hashes: a transaction proven minutes after finality.
  assert.ok(Math.abs(modelledCostCtc(10) - 2.59e-5) < 1e-7);
  // ~1000 hashes: the same transaction a day later, once attestations are compacted.
  assert.ok(Math.abs(modelledCostCtc(1000) - 3.13e-4) < 1e-6);
});
