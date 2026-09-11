import { chain, commas } from './chain';
import { useConvoy } from './useConvoy';
import { Heading, Empty, Code } from './components/Chrome';
import { Manifest } from './components/Manifest';
import { Savings } from './components/Savings';
import { Totals } from './components/Totals';
import { DispatchLog } from './components/DispatchLog';
import { Subscribers } from './components/Subscribers';

export function App() {
  const state = useConvoy();

  return (
    <div className="min-h-screen overflow-x-hidden p-2 sm:p-4">
      <div className="mx-auto w-full max-w-6xl">
        <Header state={state} />

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
            The public RPC did not answer: {state.message}. The board keeps retrying every ten
            seconds.
          </Empty>
        )}

        {state.status === 'ready' && (
          <div className="space-y-8">
            <section>
              <Heading note="the transactions that travelled together under one proof">
                Latest manifest
              </Heading>
              <Manifest
                convoy={state.board.convoys[state.board.convoys.length - 1]}
                facts={state.board.facts}
                skips={state.board.skips}
              />
            </section>

            {state.board.convoys.length > 0 && (
              <section>
                <Heading note="what these same transactions would have cost apart">
                  What sharing saved
                </Heading>
                <Savings convoys={state.board.convoys} />
              </section>
            )}

            <section>
              <Heading>Since deployment</Heading>
              <Totals totals={state.board.totals} />
            </section>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
              <section>
                <Heading>Dispatch log</Heading>
                <DispatchLog convoys={state.board.convoys} skips={state.board.skips} />
              </section>
              <section>
                <Heading>Who is subscribed</Heading>
                <Subscribers routes={state.board.routes} />
              </section>
            </div>
          </div>
        )}

        <footer className="mt-10 pb-4 text-xs font-medium text-paper/50">
          Reading Creditcoin CC3 testnet directly from this browser. No backend, no indexer.
        </footer>
      </div>
    </div>
  );
}

function Header({ state }: { state: ReturnType<typeof useConvoy> }) {
  const live = state.status === 'ready';
  const stale = state.status === 'ready' && state.stale;

  return (
    <header className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
      <h1 className="font-display text-5xl leading-none text-escort sm:text-6xl">CONVOY</h1>
      <p className="w-full max-w-[34ch] text-sm font-medium leading-snug text-paper/80 sm:w-auto">
        Ten shipments, one escort. Shared proof delivery for apps on Creditcoin that have nothing to
        do with each other.
      </p>

      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        {chain.router && (
          <a
            href={`${chain.explorer}/address/${chain.router}`}
            target="_blank"
            rel="noreferrer"
            className="border-[3px] border-ink bg-paper px-3 py-1.5 font-mono text-xs font-bold shadow-hard-sm hover:bg-escort"
          >
            router {chain.router.slice(0, 6)}…{chain.router.slice(-4)}
          </a>
        )}
        <span
          className={`border-[3px] border-ink px-3 py-1.5 font-mono text-xs font-bold tabular-nums shadow-hard-sm ${
            stale ? 'bg-refused' : live ? 'bg-passport' : 'bg-paper'
          }`}
        >
          {live ? `block ${commas(state.board.head)}` : 'connecting'}
        </span>
      </div>

      {/* The road. It only moves while the board is actually live. */}
      <div
        className={`lane h-2 w-full border-y-[3px] border-ink ${live && !stale ? 'animate-lane' : ''}`}
        aria-hidden="true"
      />
    </header>
  );
}
