import { commas } from '../chain';
import type { Board } from '../useConvoy';

export function Totals({ totals }: { totals: Board['totals'] }) {
  const cells = [
    { n: totals.batches, k: 'convoys arrived', fill: 'bg-paper' },
    { n: totals.queries, k: 'transactions proven', fill: 'bg-escrow' },
    { n: totals.facts, k: 'facts handed to apps', fill: 'bg-passport' },
    { n: totals.hashes, k: 'continuity hashes paid for', fill: 'bg-escort' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cells.map((c) => (
        <div key={c.k} className={`block-card ${c.fill} p-4`}>
          <div className="font-display text-4xl leading-none tabular-nums">{commas(c.n)}</div>
          <div className="mt-1 text-xs font-bold leading-tight">{c.k}</div>
        </div>
      ))}
    </div>
  );
}
