import { commas, SKIP_REASON } from '../chain';
import type { Convoy, Skip } from '../useConvoy';

export function DispatchLog({ convoys, skips }: { convoys: Convoy[]; skips: Skip[] }) {
  const rows = [
    ...convoys.map((c) => ({
      block: c.block,
      key: `c${c.block}`,
      refused: false,
      text: `Convoy of ${c.queries} arrived, ${c.facts} fact${c.facts === 1 ? '' : 's'} delivered`,
      badge: `${c.queries}× on one escort`,
    })),
    ...skips.map((s) => ({
      block: s.block,
      key: `s${s.queryId}`,
      refused: true,
      text: `Threw out one transaction: ${SKIP_REASON[s.reason] ?? 'unknown reason'}`,
      badge: 'refused',
    })),
  ]
    .sort((a, b) => b.block - a.block)
    .slice(0, 12);

  if (rows.length === 0) {
    return (
      <div className="block-card p-5 text-sm font-bold">Nothing has been dispatched yet.</div>
    );
  }

  return (
    <ul className="block-card divide-y-[3px] divide-ink">
      {rows.map((r) => (
        <li
          key={r.key}
          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 ${
            r.refused ? 'bg-refused' : ''
          }`}
        >
          <span className="text-sm font-bold">{r.text}</span>
          <span className="border-2 border-ink bg-paper px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums">
            {r.badge}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums">
            block {commas(r.block)}
          </span>
        </li>
      ))}
    </ul>
  );
}
