import { blocksAsTime, commas, shortHash, sourceBlockUrl, CHAIN_INFO_ADDRESS } from '../chain';
import type { Attestation } from '../useConvoy';
import { HashLink, Copy } from './Chrome';

/**
 * The clock the whole system runs on.
 *
 * A Sepolia transaction cannot be proven on Creditcoin until the attestor network has covered its
 * block. Every convoy on this page waited for exactly this gap to close, so the gap is the honest
 * answer to "how long does a delivery take", and it is read live off the ChainInfo precompile.
 */
export function Attestors({ attestation }: { attestation: Attestation | null }) {
  if (!attestation) {
    return (
      <div className="block-card p-5 text-sm font-bold">
        Creditcoin has not reported an attestation for Sepolia yet.
      </div>
    );
  }

  const { attested, sourceHead, lag, hash } = attestation;
  // A fixed 300-block window, so the bar means the same thing on every refresh: a longer red tail
  // is always a longer wait, never a rescaled axis.
  const window = 300;
  const covered = Math.min(100, Math.max(0, ((window - lag) / window) * 100));

  return (
    <div className="block-card overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[13rem_1fr]">
        <div className="flex flex-col justify-center border-b-[3px] border-ink bg-escrow p-5 md:border-b-0 md:border-r-[3px]">
          <span className="text-xs font-bold uppercase tracking-[0.14em]">Wait before travel</span>
          <span className="mt-2 block font-display text-[3.5rem] leading-[0.85] tabular-nums">
            {blocksAsTime(lag)}
          </span>
          <span className="mt-2 text-sm font-bold leading-tight">
            {commas(lag)} Sepolia blocks still uncovered
          </span>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-bold">
              Attestors have reached block {commas(attested)}
            </span>
            <span className="font-mono text-xs tabular-nums opacity-70">
              Sepolia is at {commas(sourceHead)}
            </span>
          </div>

          {/* Blue is covered and provable. Red is the stretch nothing can be proven from yet. */}
          <div className="mt-3 h-9 border-[3px] border-ink bg-refused">
            <div
              className={`h-full bg-escrow ${covered < 100 ? 'border-r-[3px] border-ink' : ''}`}
              style={{ width: `${covered}%` }}
            />
          </div>
          <div className="mt-1 flex items-baseline justify-between font-mono text-[11px] tabular-nums opacity-70">
            <span>proven from here back</span>
            <span>{lag > 0 ? `${commas(lag)} blocks not covered yet` : 'caught up'}</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
            <span className="font-bold uppercase tracking-[0.1em]">Latest attested block</span>
            <HashLink href={sourceBlockUrl(attested)} title={hash}>
              {shortHash(hash)}
            </HashLink>
            <Copy value={hash} label="attested block hash" />
            <span className="ml-auto font-mono font-medium opacity-70">
              ChainInfo precompile {CHAIN_INFO_ADDRESS.slice(0, 6)}…{CHAIN_INFO_ADDRESS.slice(-4)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
