/**
 * Three lines for someone who has never heard of Attestcoin.
 *
 * The board is otherwise self-explanatory only if you already know why a continuity proof is the
 * expensive part, and why one application cannot reach the batch discount on its own. This is a
 * real sequence, so it is numbered.
 */
const STEPS = [
  {
    n: 1,
    title: 'Proving costs, and the proof is the cost',
    body: 'To trust an Ethereum transaction, a Creditcoin contract pays for a chain of hashes linking its block back to one the network already attested. That chain is nearly the whole bill.',
  },
  {
    n: 2,
    title: 'Ten can share one chain, and nobody can fill ten',
    body: 'The precompile verifies up to ten transactions under a single chain, if they fall within 1000 blocks. One app almost never emits ten of its own events that close together.',
  },
  {
    n: 3,
    title: 'So pool apps that share nothing',
    body: 'A bonded relayer collects transactions for unrelated dApps, buys one chain for the group, and is paid per delivery. The discount only exists if somebody pools the demand.',
  },
];

export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {STEPS.map((s) => (
        <li key={s.n} className="block-card flex gap-3 p-4">
          <span className="font-display text-3xl leading-none tabular-nums opacity-25">{s.n}</span>
          <div>
            <h3 className="mb-1 font-sans text-base font-bold normal-case tracking-normal">{s.title}</h3>
            <p className="text-sm leading-snug">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
