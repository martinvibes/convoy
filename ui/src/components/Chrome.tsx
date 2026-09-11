import { useState, type ReactNode } from 'react';

export function Heading({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 className="text-2xl leading-none text-paper sm:text-3xl">{children}</h2>
      {note && (
        <span className="w-full pb-[2px] text-xs font-medium text-paper/60 sm:w-auto">{note}</span>
      )}
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

/** A hash that goes somewhere. Underlined rather than coloured, so the block fills stay readable. */
export function HashLink({
  href,
  children,
  title,
}: {
  href: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className="border-b-2 border-ink/30 font-mono hover:border-ink hover:bg-escort"
    >
      {children}
    </a>
  );
}

/** Addresses and hashes are for pasting somewhere else, so let people take them. */
export function Copy({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          setDone(false);
        }
      }}
      className="border-2 border-ink bg-paper px-1.5 py-0.5 font-mono text-[10px] font-bold hover:bg-escort"
      aria-label={`Copy ${label ?? value}`}
    >
      {done ? 'copied' : 'copy'}
    </button>
  );
}
