import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventLog } from 'ethers';
import { chain, provider, sourceProvider, routerContract, registryContract, chainInfoContract } from './chain';

export type Convoy = {
  block: number;
  txHash: string;
  relayer: string;
  queries: number;
  facts: number;
  hashes: number;
};

export type Fact = {
  block: number;
  txHash: string;
  factId: string;
  callback: string;
  accepted: boolean;
  height: number;
  txIndex: number;
};

export type Skip = {
  block: number;
  txHash: string;
  queryId: string;
  reason: number;
  height: number;
  txIndex: number;
};

export type Route = {
  subId: string;
  callback: string;
  emitter: string;
  active: boolean;
  balance: bigint;
  fee: bigint;
};

/** How far Creditcoin's attestor network has got through the source chain. */
export type Attestation = {
  attested: number;
  hash: string;
  sourceHead: number;
  lag: number;
};

export type Board = {
  head: number;
  fetchedAt: number;
  totals: { batches: number; queries: number; hashes: number; facts: number };
  convoys: Convoy[];
  facts: Fact[];
  skips: Skip[];
  routes: Route[];
  attestation: Attestation | null;
};

export type State =
  | { status: 'undeployed' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; board: Board; stale: boolean };

export const REFRESH_MS = 15_000;

async function load(): Promise<Board> {
  const router = routerContract()!;
  const registry = registryContract()!;
  const from = chain.fromBlock;

  const [head, batches, queries, hashes, facts, attestation] = await Promise.all([
    provider.getBlockNumber(),
    router.totalBatches(),
    router.totalQueriesVerified(),
    router.totalContinuityHashes(),
    router.totalFactsDelivered(),
    readAttestation(),
  ]);

  const [convoyLogs, factLogs, skipLogs, subLogs] = await Promise.all([
    router.queryFilter(router.filters.ConvoyDelivered!(), from, 'latest'),
    router.queryFilter(router.filters.FactDelivered!(), from, 'latest'),
    router.queryFilter(router.filters.QuerySkipped!(), from, 'latest'),
    registry.queryFilter(registry.filters.Subscribed!(), from, 'latest'),
  ]);

  const routes = await Promise.all(
    (subLogs as EventLog[]).map(async (ev) => {
      const s = await registry.get(ev.args.subId);
      return {
        subId: ev.args.subId as string,
        callback: s.callback as string,
        emitter: s.emitter as string,
        active: s.active as boolean,
        balance: s.balance as bigint,
        fee: s.feePerDelivery as bigint,
      };
    }),
  );

  return {
    head,
    fetchedAt: Date.now(),
    totals: {
      batches: Number(batches),
      queries: Number(queries),
      hashes: Number(hashes),
      facts: Number(facts),
    },
    convoys: (convoyLogs as EventLog[]).map((ev) => ({
      block: ev.blockNumber,
      txHash: ev.transactionHash,
      relayer: ev.args.relayer as string,
      queries: Number(ev.args.queries),
      facts: Number(ev.args.facts),
      hashes: Number(ev.args.continuityHashes),
    })),
    facts: (factLogs as EventLog[]).map((ev) => ({
      block: ev.blockNumber,
      txHash: ev.transactionHash,
      factId: ev.args.factId as string,
      callback: ev.args.callback as string,
      accepted: ev.args.accepted as boolean,
      height: Number(ev.args.height),
      txIndex: Number(ev.args.txIndex),
    })),
    skips: (skipLogs as EventLog[]).map((ev) => ({
      block: ev.blockNumber,
      txHash: ev.transactionHash,
      queryId: ev.args.queryId as string,
      reason: Number(ev.args.reason),
      height: Number(ev.args.height),
      txIndex: Number(ev.args.txIndex),
    })),
    routes,
    attestation,
  };
}

/**
 * The attestor network's progress, straight off the ChainInfo precompile.
 *
 * This is the clock the whole system runs on: a Sepolia transaction cannot be proven on Creditcoin
 * until the attestors have covered its block, so this gap is the wait before any convoy can leave.
 */
async function readAttestation(): Promise<Attestation | null> {
  try {
    const [latest, sourceHead] = await Promise.all([
      chainInfoContract().get_latest_attestation_height_and_hash(chain.sourceChainKey),
      sourceProvider.getBlockNumber(),
    ]);
    if (!latest.exists) return null;
    const attested = Number(latest.height);
    return { attested, hash: latest.hash as string, sourceHead, lag: sourceHead - attested };
  } catch {
    // One precompile hiccup must not take the board down with it.
    return null;
  }
}

export function useConvoy() {
  const [state, setState] = useState<State>(
    chain.router ? { status: 'loading' } : { status: 'undeployed' },
  );
  const [nextRefreshAt, setNextRefreshAt] = useState(Date.now() + REFRESH_MS);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!chain.router) return;
    setRefreshing(true);
    try {
      const board = await load();
      if (alive.current) setState({ status: 'ready', board, stale: false });
    } catch (err) {
      if (!alive.current) return;
      // A failed refresh must not blank a board that is already showing good data. Public RPCs time
      // out; the last known state stays up and is marked stale instead.
      setState((prev) =>
        prev.status === 'ready'
          ? { ...prev, stale: true }
          : { status: 'error', message: (err as Error).message },
      );
    } finally {
      if (alive.current) {
        setRefreshing(false);
        setNextRefreshAt(Date.now() + REFRESH_MS);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return { state, refresh, refreshing, nextRefreshAt };
}

/** A once-a-second tick, for anything that counts down rather than waiting on the chain. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type ConvoyDetail = { gasUsed: bigint; timestamp: number } | null;

/**
 * The receipt and block for one convoy, fetched only for the convoy on screen.
 *
 * Gas and timing are not in the event, and pulling a receipt for every convoy in the log would be
 * dozens of extra calls to a public RPC for numbers nobody is looking at.
 */
export function useConvoyDetail(txHash?: string): ConvoyDetail {
  const [detail, setDetail] = useState<ConvoyDetail>(null);

  useEffect(() => {
    if (!txHash) {
      setDetail(null);
      return;
    }
    let live = true;
    setDetail(null);
    void (async () => {
      try {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) return;
        const block = await provider.getBlock(receipt.blockNumber);
        if (live && block) setDetail({ gasUsed: receipt.gasUsed, timestamp: block.timestamp * 1000 });
      } catch {
        // Gas and timing are decoration. A board that blanks because one extra call failed is worse
        // than a board missing two numbers.
      }
    })();
    return () => {
      live = false;
    };
  }, [txHash]);

  return detail;
}
