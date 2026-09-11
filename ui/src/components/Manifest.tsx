import { appFor, commas, shortHash, SKIP_REASON } from '../chain';
import type { Convoy, Fact, Skip } from '../useConvoy';
import { Empty, Code } from './Chrome';

/**
 * The hero. One escort slab on the left, the cargo it covered on the right.
 *
 * This is the whole product in one picture: the expensive thing is bought once, and everything
 * clamped to it rode along for free.
 */
export function Manifest({
  convoy,
  facts,
  skips,
}: {
  convoy?: Convoy;
  facts: Fact[];
  skips: Skip[];
}) {
  if (!convoy) {
    return (
      <Empty title="No convoy has arrived yet">
        Send source traffic with <Code>npm run emit -- 9</Code>, then start the relayer with{' '}
        <Code>npm run relayer</Code>. The first manifest lands about six minutes later, once the
        attestor network has covered those Sepolia blocks.
      </Empty>
    );
  }

  // A convoy carries everything the router saw, including what it threw out. Showing only the
  // delivered facts would hide the receipt-status gate, which is half the point.
  const cargo = [
    ...facts
      .filter((f) => f.block === convoy.block)
      .map((f) => ({
        id: f.factId,
        label: appFor(f.callback).name,
        fill: f.accepted ? appFor(f.callback).fill : 'bg-refused',
        state: f.accepted ? 'delivered' : 'refused',
      })),
    ...skips
      .filter((s) => s.block === convoy.block)
      .map((s) => ({
        id: s.queryId,
        label: SKIP_REASON[s.reason] ?? 'unknown reason',
        fill: 'bg-refused',
        state: 'refused',
      })),
  ];

  return (
    <div className="block-card-lg grid grid-cols-1 overflow-hidden md:grid-cols-[13rem_1fr]">
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
        <div className="flex flex-wrap items-center justify-between gap-x-3 border-b-[3px] border-ink px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] sm:px-5">
          <span>Cargo</span>
          <span className="font-mono tabular-nums normal-case tracking-normal">
            block {commas(convoy.block)}
          </span>
        </div>

        {cargo.length === 0 ? (
          <p className="p-5 text-sm">
            Verified, but nothing on these routes was subscribed at the time.
          </p>
        ) : (
          <ul className="divide-y-[3px] divide-ink">
            {cargo.map((item, i) => (
              <li
                key={item.id}
                className={`flex items-center gap-x-3 px-4 py-2.5 sm:gap-x-4 sm:px-5 ${item.fill}`}
              >
                <span className="w-6 shrink-0 font-display text-lg leading-none tabular-nums">
                  {i + 1}
                </span>
                <span className="hidden shrink-0 font-mono text-xs sm:inline sm:text-sm">
                  {shortHash(item.id)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{item.label}</span>
                <span className="shrink-0 text-xs font-bold uppercase tracking-[0.1em]">
                  {item.state}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
