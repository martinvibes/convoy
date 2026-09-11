import { commas, costCtc } from '../chain';
import type { Convoy } from '../useConvoy';

/**
 * The thesis as two bars.
 *
 * Every transaction in a convoy could have been proven on its own, each paying for its own
 * continuity proof. "Alone" is that counterfactual, summed over every convoy delivered so far.
 */
export function Savings({ convoys }: { convoys: Convoy[] }) {
  const alone = convoys.reduce((s, c) => s + c.queries * c.hashes, 0);
  const shared = convoys.reduce((s, c) => s + c.hashes, 0);
  const aloneProofs = convoys.reduce((s, c) => s + c.queries, 0);
  const saved = alone - shared;
  const savedCtc = costCtc(alone, aloneProofs) - costCtc(shared, convoys.length);
  const pct = alone > 0 ? Math.max((shared / alone) * 100, 1.5) : 0;

  return (
    <div className="block-card p-5 sm:p-6">
      <Bar label="Proven alone" hashes={alone} proofs={aloneProofs} width={100} fill="bg-refused" />
      <Bar
        label="Proven in convoy"
        hashes={shared}
        proofs={convoys.length}
        width={pct}
        fill="bg-escort"
      />

      <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t-[3px] border-ink pt-4">
        <span className="text-xs font-bold uppercase tracking-[0.14em]">Not paid for</span>
        <span className="font-display text-4xl leading-none tabular-nums">{commas(saved)}</span>
        <span className="text-sm font-bold">hashes</span>
        <span className="font-display text-4xl leading-none tabular-nums">
          {savedCtc.toFixed(5)}
        </span>
        <span className="text-sm font-bold">CTC</span>
      </div>
    </div>
  );
}

function Bar({
  label,
  hashes,
  proofs,
  width,
  fill,
}: {
  label: string;
  hashes: number;
  proofs: number;
  width: number;
  fill: string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold">{label}</span>
        <span className="font-mono text-xs tabular-nums">
          {commas(proofs)} proof{proofs === 1 ? '' : 's'} · {commas(hashes)} hashes
        </span>
      </div>
      <div className="h-8 border-[3px] border-ink bg-paper">
        <div
          className={`h-full ${fill} ${width < 100 ? 'border-r-[3px] border-ink' : ''}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
