import { commas, SKIP_REASON } from '../chain';
import type { Convoy, Skip } from '../useConvoy';

type Row = { block: number; key: string; refused: boolean; text: string; badge: string };

/**
 * Refusals are grouped by convoy and reason. A convoy that was entirely duplicates produced nine
 * identical lines, which buried the convoy above it without saying anything the count does not.
 */
function groupSkips(skips: Skip[]): Row[] {
  const buckets = new Map<string, { block: number; reason: number; count: number }>();
  for (const s of skips) {
    const key = `${s.block}:${s.reason}`;
    const hit = buckets.get(key);
    if (hit) hit.count += 1;
    else buckets.set(key, { block: s.block, reason: s.reason, count: 1 });
  }
  return [...buckets.entries()].map(([key, b]) => ({
    block: b.block,
    key,
    refused: true,
    text:
      b.count === 1
        ? `Threw out one transaction: ${SKIP_REASON[b.reason] ?? 'unknown reason'}`
        : `Threw out ${b.count} transactions: ${SKIP_REASON[b.reason] ?? 'unknown reason'}`,
    badge: 'refused',
  }));
}

export function DispatchLog({ convoys, skips }: { convoys: Convoy[]; skips: Skip[] }) {
  const rows: Row[] = [
    ...convoys.map((c) => ({
      block: c.block,
      key: `c${c.block}`,
      refused: false,
      text: `Convoy of ${c.queries} arrived, ${c.facts} fact${c.facts === 1 ? '' : 's'} delivered`,
      badge: `${c.queries}× on one escort`,
    })),
    ...groupSkips(skips),
  ]
    .sort((a, b) => b.block - a.block || Number(a.refused) - Number(b.refused))
    .slice(0, 12);

  if (rows.length === 0) {
    return <div className="block-card p-5 text-sm font-bold">Nothing has been dispatched yet.</div>;
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
