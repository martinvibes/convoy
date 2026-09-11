import { formatEther } from 'ethers';
import { appFor, chain } from '../chain';
import type { Route } from '../useConvoy';
import { Empty, Code } from './Chrome';

export function Subscribers({ routes }: { routes: Route[] }) {
  if (routes.length === 0) {
    return (
      <Empty title="Nobody has subscribed yet">
        Run <Code>npm run deploy:creditcoin</Code> to put the three demo apps on the route table.
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {routes.map((r) => {
        const app = appFor(r.callback);
        const funded = r.fee > 0n ? Number(r.balance / r.fee) : 0;
        return (
          <div key={r.subId} className={`block-card ${app.fill} p-4`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-base font-bold">{app.name}</span>
              <span className="text-xs font-bold uppercase tracking-[0.1em]">
                {r.active ? 'listening' : 'paused'}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium">
              {formatEther(r.balance)} CTC left, which buys {funded} more deliveries at{' '}
              {formatEther(r.fee)} each.
            </p>
            <a
              className="mt-2 inline-block break-all border-b-2 border-ink font-mono text-[11px] hover:bg-paper"
              href={`${chain.sepoliaExplorer}/address/${r.emitter}`}
              target="_blank"
              rel="noreferrer"
            >
              watching {r.emitter} on Sepolia
            </a>
          </div>
        );
      })}
    </div>
  );
}
