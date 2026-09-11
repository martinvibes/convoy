import { useEffect, useState } from 'react';
import type { EventLog } from 'ethers';
import { chain, provider, routerContract, registryContract } from './chain';

export type Convoy = {
  block: number;
  relayer: string;
  queries: number;
  facts: number;
  hashes: number;
};

export type Fact = {
  block: number;
  factId: string;
  callback: string;
  accepted: boolean;
};

export type Skip = { block: number; queryId: string; reason: number };

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
  totals: { batches: number; queries: number; hashes: number; facts: number };
  convoys: Convoy[];
  facts: Fact[];
  skips: Skip[];
  routes: Route[];
};

type State =
  | { status: 'undeployed' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; board: Board; stale: boolean };

const REFRESH_MS = 10_000;

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
    totals: {
      batches: Number(batches),
      queries: Number(queries),
      hashes: Number(hashes),
      facts: Number(facts),
    },
    convoys: (convoyLogs as EventLog[]).map((ev) => ({
      block: ev.blockNumber,
      relayer: ev.args.relayer as string,
      queries: Number(ev.args.queries),
      facts: Number(ev.args.facts),
      hashes: Number(ev.args.continuityHashes),
    })),
    facts: (factLogs as EventLog[]).map((ev) => ({
      block: ev.blockNumber,
      factId: ev.args.factId as string,
      callback: ev.args.callback as string,
      accepted: ev.args.accepted as boolean,
    })),
    skips: (skipLogs as EventLog[]).map((ev) => ({
      block: ev.blockNumber,
      queryId: ev.args.queryId as string,
      reason: Number(ev.args.reason),
    })),
    routes,
  };
}

export function useConvoy(): State {
  const [state, setState] = useState<State>(
    chain.router ? { status: 'loading' } : { status: 'undeployed' },
  );

  useEffect(() => {
    if (!chain.router) return;
    let live = true;

    const poll = async () => {
      try {
        const board = await load();
        if (live) setState({ status: 'ready', board, stale: false });
      } catch (err) {
        if (!live) return;
        // A failed refresh should not blank a board that is already showing good data. Public RPCs
        // time out; the last known state stays up and is marked stale.
        setState((prev) =>
          prev.status === 'ready'
            ? { ...prev, stale: true }
            : { status: 'error', message: (err as Error).message },
        );
      }
    };

    void poll();
    const timer = setInterval(poll, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return state;
}
