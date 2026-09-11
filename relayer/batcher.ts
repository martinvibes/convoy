/**
 * Convoy's batching policy.
 *
 * The precompile will verify up to MAX_BATCH_SIZE transactions under a single continuity proof, as
 * long as they sit within MAX_BATCH_RANGE blocks of each other. That is the whole saving, and it
 * pulls in two directions at once:
 *
 *   Wait longer  -> more transactions per batch -> the continuity proof is split more ways.
 *   Wait longer  -> the source blocks age -> once the attestations covering them are compacted into
 *                   sparse checkpoints (one per 1000 blocks for Ethereum, roughly every 20 minutes)
 *                   the continuity proof for those blocks jumps from ~10 hashes to ~1000.
 *
 * So the cost curve is not monotonic. Holding a transaction to find it companions is profitable
 * right up until the moment its block falls off the dense attestation window, at which point the
 * proof you are amortising has become 100x more expensive and no amount of sharing wins it back.
 *
 * This module is deliberately pure so the policy can be tested and tuned without a chain.
 */

export interface PendingItem {
  txHash: string;
  blockNumber: number;
  /** ms timestamp when the relayer first saw it */
  seenAt: number;
}

export interface BatchPolicy {
  maxBatchSize: number;
  maxBatchRange: number;
  /** Hard ceiling on how long a single item may sit waiting for companions. */
  maxWaitMs: number;
}

export interface BatchPlan {
  batch: PendingItem[];
  remaining: PendingItem[];
  reason: 'full' | 'deadline' | 'range' | 'none';
}

/**
 * Decide whether to ship a batch now.
 *
 * Items are grouped by block proximity, oldest first. A group ships when it is full, or when its
 * oldest member is out of time. Anything that would break the block range starts the next group
 * rather than being dropped.
 */
export function planBatch(pending: PendingItem[], now: number, policy: BatchPolicy): BatchPlan {
  if (pending.length === 0) return { batch: [], remaining: [], reason: 'none' };

  const sorted = [...pending].sort((a, b) => a.blockNumber - b.blockNumber || a.seenAt - b.seenAt);

  const anchor = sorted[0];
  const group: PendingItem[] = [];
  const rest: PendingItem[] = [];

  for (const item of sorted) {
    if (group.length >= policy.maxBatchSize) {
      rest.push(item);
      continue;
    }
    if (item.blockNumber - anchor.blockNumber > policy.maxBatchRange) {
      rest.push(item);
      continue;
    }
    group.push(item);
  }

  const full = group.length >= policy.maxBatchSize;
  const oldest = Math.min(...group.map((i) => i.seenAt));
  const expired = now - oldest >= policy.maxWaitMs;

  // A group that is neither full nor out of time keeps waiting, unless something behind it is
  // already out of range and therefore blocked on this group shipping first.
  const blocking = rest.length > 0 && rest.some((i) => now - i.seenAt >= policy.maxWaitMs);

  if (!full && !expired && !blocking) {
    return { batch: [], remaining: sorted, reason: 'none' };
  }

  return {
    batch: group,
    remaining: rest,
    reason: full ? 'full' : expired ? 'deadline' : 'range',
  };
}

/**
 * What this batch actually saved, in continuity hashes.
 *
 * Delivering n transactions one at a time costs n continuity proofs. Delivering them as a convoy
 * costs one. `hashesPerProof` is the length of the continuity proof the prover returned.
 */
export function savings(batchSize: number, hashesPerProof: number) {
  const alone = batchSize * hashesPerProof;
  const convoy = hashesPerProof;
  return {
    hashesAlone: alone,
    hashesInConvoy: convoy,
    hashesSaved: alone - convoy,
    factor: convoy === 0 ? 0 : alone / convoy,
  };
}

/**
 * Documented CTC cost model for on-chain verification:
 *   cost ~= 2.3e-5 + 2.9e-7 * continuityHashCount
 * Source: Attestcoin docs, "Gas Costs".
 */
export function modelledCostCtc(continuityHashCount: number): number {
  return 2.3e-5 + 2.9e-7 * continuityHashCount;
}
