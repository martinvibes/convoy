import type { ReactNode } from 'react';

export function Heading({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="text-2xl leading-none text-paper sm:text-3xl">{children}</h2>
      {note && <span className="pb-[2px] text-xs font-medium text-paper/60">{note}</span>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="block-card p-6">
      <h3 className="mb-2 text-xl leading-none">{title}</h3>
      <p className="max-w-[58ch] text-sm leading-relaxed">{children}</p>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="border-2 border-ink bg-escort px-1.5 py-0.5 font-mono text-[0.8em] font-bold">
      {children}
    </code>
  );
}
