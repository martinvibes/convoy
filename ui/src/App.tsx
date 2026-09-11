import { useMemo, useState } from 'react';
import { chain, commas, addressUrl, ago } from './chain';
import { useConvoy, useNow, REFRESH_MS } from './useConvoy';
import { Heading, Empty, Code, HashLink, Copy } from './components/Chrome';
import { Manifest } from './components/Manifest';
import { Savings } from './components/Savings';
import { Totals } from './components/Totals';
import { DispatchLog } from './components/DispatchLog';
import { Subscribers } from './components/Subscribers';
import { HowItWorks } from './components/HowItWorks';

export function App() {
  const { state, refresh, refreshing, nextRefreshAt } = useConvoy();
  const [selected, setSelected] = useState<string | null>(null);

  const board = state.status === 'ready' ? state.board : null;
  const latest = board?.convoys[board.convoys.length - 1];
  const shown = useMemo(
    () => board?.convoys.find((c) => c.txHash === selected) ?? latest,
    [board, selected, latest],
  );

  return (
    <div className="min-h-screen overflow-x-hidden p-2 sm:p-4">
      <div className="mx-auto w-full max-w-6xl">
        <Header
          state={state}
          refresh={refresh}
          refreshing={refreshing}
          nextRefreshAt={nextRefreshAt}
        />

        {state.status === 'undeployed' && (
          <Empty title="Convoy is not on chain yet">
            Run <Code>npm run deploy:creditcoin</Code>. This board reads Creditcoin straight from
            your browser, so it fills in on its own once the router exists.
          </Empty>
        )}

        {state.status === 'loading' && (
          <div className="block-card p-6 text-sm font-bold">Reading Creditcoin…</div>
        )}

        {state.status === 'error' && (
          <Empty title="Could not reach Creditcoin">
            The public RPC did not answer: {state.message}. The board keeps retrying.
          </Empty>
        )}

        {board && (
          <div className="space-y-8">
            <HowItWorks />

            <section>
              <Heading
                note={
                  shown && shown.txHash !== latest?.txHash
                    ? 'showing an earlier convoy · pick another from the log below'
                    : 'the transactions that travelled together under one proof'
                }
              >
                {shown && shown.txHash !== latest?.txHash ? 'Manifest' : 'Latest manifest'}
              </Heading>
              <Manifest
                convoy={shown}
                facts={board.facts}
                skips={board.skips}
                isLatest={shown?.txHash === latest?.txHash}
              />
            </section>

            {board.convoys.length > 0 && (
              <section>
                <Heading note="what these same transactions would have cost apart">
                  What sharing saved
                </Heading>
                <Savings convoys={board.convoys} />
              </section>
            )}

            <section>
              <Heading>Since deployment</Heading>
              <Totals totals={board.totals} />
            </section>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
              <section>
                <Heading note="pick a convoy to see its manifest">Dispatch log</Heading>
                <DispatchLog
                  convoys={board.convoys}
                  skips={board.skips}
                  selected={shown?.txHash}
                  onSelect={setSelected}
                />
              </section>
              <section>
                <Heading>Who is subscribed</Heading>
                <Subscribers routes={board.routes} />
              </section>
            </div>
          </div>
        )}

        <footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 pb-4 text-xs font-medium text-paper/50">
          <span>Reading Creditcoin CC3 testnet and Ethereum Sepolia directly from this browser.</span>
          <span>No backend, no indexer.</span>
          {chain.router && (
            <span className="ml-auto flex items-center gap-2">
              <HashLink href={addressUrl(chain.router)}>
                <span className="text-paper/70">{chain.router}</span>
              </HashLink>
              <Copy value={chain.router} label="router address" />
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

function Header({
  state,
  refresh,
  refreshing,
  nextRefreshAt,
}: {
  state: ReturnType<typeof useConvoy>['state'];
  refresh: () => void;
  refreshing: boolean;
  nextRefreshAt: number;
}) {
  const now = useNow();
  const live = state.status === 'ready';
  const stale = state.status === 'ready' && state.stale;
  const period = REFRESH_MS / 1000;
  // Clamped at both ends. A negative width is not a valid CSS length, so the browser drops the rule
  // and the bar renders full instead of empty.
  const secondsLeft = Math.min(period, Math.max(0, Math.ceil((nextRefreshAt - now) / 1000)));
  const progress = live ? Math.min(100, Math.max(0, ((period - secondsLeft) / period) * 100)) : 0;

  return (
    <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
      <h1 className="font-display text-5xl leading-none text-escort sm:text-6xl">CONVOY</h1>
      <p className="w-full max-w-[34ch] text-sm font-medium leading-snug text-paper/80 sm:w-auto">
        Ten shipments, one escort. Shared proof delivery for apps on Creditcoin that have nothing to
        do with each other.
      </p>

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <span
          className={`border-[3px] border-ink px-3 py-1.5 font-mono text-xs font-bold tabular-nums shadow-hard-sm ${
            stale ? 'bg-refused' : live ? 'bg-passport' : 'bg-paper'
          }`}
        >
          {live ? `block ${commas(state.board.head)}` : 'connecting'}
        </span>

        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="border-[3px] border-ink bg-paper px-3 py-1.5 font-mono text-xs font-bold tabular-nums shadow-hard-sm transition-[box-shadow,transform] hover:-translate-x-px hover:-translate-y-px hover:bg-escort hover:shadow-hard disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? 'reading…' : `refresh · ${secondsLeft}s`}
        </button>
      </div>

      {/* The road. The painted lane fills as the next read approaches, so the wait is visible. */}
      <div className="relative h-2 w-full border-y-[3px] border-ink bg-ink/40" aria-hidden="true">
        <div className="lane h-full" style={{ width: `${progress}%` }} />
      </div>

      {stale && (
        <span className="-mt-1 w-full text-[11px] font-medium text-refused">
          The last read failed. This is what was already loaded, from {ago(state.board.fetchedAt)}.
        </span>
      )}
    </header>
  );
}
