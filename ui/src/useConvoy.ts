import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventLog } from 'ethers';
import { chain, provider, routerContract, registryContract } from './chain';

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

export type Board = {
  head: number;
  fetchedAt: number;
  totals: { batches: number; queries: number; hashes: number; facts: number };
  convoys: Convoy[];
  facts: Fact[];
  skips: Skip[];
  routes: Route[];
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

  const [head, batches, queries, hashes, facts] = await Promise.all([
    provider.getBlockNumber(),
    router.totalBatches(),
    router.totalQueriesVerified(),
    router.totalContinuityHashes(),
    router.totalFactsDelivered(),
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
  };
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
