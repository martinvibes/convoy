import { useEffect, useState } from 'react';
import {
  ago,
  appFor,
  commas,
  costCtc,
  shortHash,
  sourceTxHash,
  sourceTxUrl,
  txUrl,
  SKIP_REASON,
} from '../chain';
import type { Convoy, Fact, Skip } from '../useConvoy';
import { useConvoyDetail, useNow } from '../useConvoy';
import { Empty, Code, HashLink, Copy } from './Chrome';

type Item = {
  id: string;
  label: string;
  fill: string;
  state: string;
  height: number;
  txIndex: number;
};

/**
 * The hero. One escort slab on the left, the cargo it covered on the right.
 *
 * This is the whole product in one picture: the expensive thing is bought once, and everything
 * clamped to it rode along for free. Each row links back to the Ethereum transaction it was built
 * from, because a factId nobody can check is not evidence of anything.
 */
export function Manifest({
  convoy,
  facts,
  skips,
  isLatest,
}: {
  convoy?: Convoy;
  facts: Fact[];
  skips: Skip[];
  isLatest: boolean;
}) {
  if (!convoy) {
    return (
      <Empty title="No convoy has arrived yet">
        Send source traffic and deliver it in one command with <Code>npm run demo -- 9</Code>, or run{' '}
        <Code>npm run emit -- 9</Code> and <Code>npm run relayer</Code> separately. The first
        manifest lands about six minutes later, once the attestor network has covered those Sepolia
        blocks.
      </Empty>
    );
  }

  // A convoy carries everything the router saw, including what it threw out. Showing only the
  // delivered facts would hide the receipt-status gate, which is half the point.
  const cargo: Item[] = [
    ...facts
      .filter((f) => f.txHash === convoy.txHash)
      .map((f) => ({
        id: f.factId,
        label: appFor(f.callback).name,
        fill: f.accepted ? appFor(f.callback).fill : 'bg-refused',
        state: f.accepted ? 'delivered' : 'refused',
        height: f.height,
        txIndex: f.txIndex,
      })),
    ...skips
      .filter((s) => s.txHash === convoy.txHash)
      .map((s) => ({
        id: s.queryId,
        label: SKIP_REASON[s.reason] ?? 'unknown reason',
        fill: 'bg-refused',
        state: 'refused',
        height: s.height,
        txIndex: s.txIndex,
      })),
  ];

  return (
    <div className="block-card-lg overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[13rem_1fr]">
        <div className="flex flex-col justify-center border-b-4 border-ink bg-escort p-6 md:border-b-0 md:border-r-4">
          <span className="text-xs font-bold uppercase tracking-[0.14em]">One escort</span>
          <span className="mt-2 block font-display text-[5rem] leading-[0.85] tabular-nums md:text-[6.5rem]">
            {commas(convoy.hashes)}
          </span>
          <span className="mt-2 text-sm font-bold leading-tight">
            continuity hashes, bought once and shared by all {convoy.queries}
          </span>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b-[3px] border-ink px-4 py-2 sm:px-5">
            <span className="text-xs font-bold uppercase tracking-[0.14em]">
              Cargo {isLatest ? '' : '· earlier convoy'}
            </span>
            <span className="font-mono text-xs tabular-nums">
              delivered in{' '}
              <HashLink href={txUrl(convoy.txHash)} title={convoy.txHash}>
                {shortHash(convoy.txHash)}
              </HashLink>
            </span>
          </div>

          {cargo.length === 0 ? (
            <p className="p-5 text-sm">
              Verified, but nothing on these routes was subscribed at the time.
            </p>
          ) : (
            <ul className="divide-y-[3px] divide-ink">
              {cargo.map((item, i) => (
                <CargoRow key={item.id} item={item} index={i + 1} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <Footer convoy={convoy} />
    </div>
  );
}

function CargoRow({ item, index }: { item: Item; index: number }) {
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void sourceTxHash(item.height, item.txIndex).then((h) => {
      if (live) setHash(h);
    });
    return () => {
      live = false;
    };
  }, [item.height, item.txIndex]);

  return (
    <li className={`flex items-center gap-x-3 px-4 py-2.5 sm:gap-x-4 sm:px-5 ${item.fill}`}>
      <span className="w-6 shrink-0 font-display text-lg leading-none tabular-nums">{index}</span>
      <span className="hidden shrink-0 font-mono text-xs sm:inline sm:text-sm">
        {hash ? (
          <HashLink href={sourceTxUrl(hash)} title={`Sepolia ${hash}`}>
            {shortHash(hash)}
          </HashLink>
        ) : (
          <span className="opacity-50">resolving…</span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.label}</span>
      <span className="hidden shrink-0 font-mono text-[11px] tabular-nums opacity-70 lg:inline">
        block {commas(item.height)} · tx {item.txIndex}
      </span>
      <span className="shrink-0 text-xs font-bold uppercase tracking-[0.1em]">{item.state}</span>
    </li>
  );
}


function Footer({ convoy }: { convoy: Convoy }) {
  const detail = useConvoyDetail(convoy.txHash);
  // ago() reads the clock at render time, so without a tick "2m ago" would sit there saying 2m an
  // hour later.
  useNow(10_000);
  const alone = costCtc(convoy.hashes * convoy.queries, convoy.queries);
  const shared = costCtc(convoy.hashes, 1);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-[3px] border-ink bg-paper px-4 py-2.5 text-xs sm:px-5">
      <span className="font-bold">
        relayed by{' '}
        <HashLink href={txUrl(convoy.txHash)} title={convoy.relayer}>
          {convoy.relayer.slice(0, 8)}…{convoy.relayer.slice(-4)}
        </HashLink>
      </span>
      <Copy value={convoy.relayer} label="relayer address" />

      <span className="font-mono tabular-nums opacity-70">
        Creditcoin block {commas(convoy.block)}
        {detail && ` · ${commas(detail.gasUsed)} gas · ${ago(detail.timestamp)}`}
      </span>

      <span className="ml-auto border-2 border-ink bg-escort px-2 py-1 font-bold tabular-nums">
        this convoy: {(alone / shared).toFixed(1)}× cheaper than proving these apart
      </span>
    </div>
  );
}
