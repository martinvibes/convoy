# Convoy

**The shared proof-delivery layer for Attestcoin. Many dApps, one continuity proof.**

Built for BUIDL CTC 2026 Fall (Creditcoin & Credit Labs). Track: Infrastructure / DeFi.

---

## The one-paragraph version

On Creditcoin, verifying a foreign transaction costs roughly `2.3e-5 + 2.9e-7 × continuityHashCount`
CTC, and the continuity proof is nearly all of it. The block-prover precompile will verify ten
transactions under a *single* continuity proof, provided they sit within 1000 blocks of each other.
`ASCBase` — the base contract every Attestcoin dApp inherits — never calls that overload, and a
single dApp could not fill a batch anyway, because one application rarely emits ten of its own
events in a 1000-block window. Batching is only reachable by pooling traffic across applications
that have nothing to do with each other. Convoy is that pool.

## Why this is infrastructure and not another app

Every other way to reach the batch overload requires one application to generate enough of its own
traffic to fill a 1000-block window. Almost none do. The saving is not a feature a dApp can build
for itself, which is why it has to live one layer down.

Convoy also closes a footgun the Attestcoin docs flag in a warning box: the precompile proves that a
transaction was *included*, not that it *succeeded*. Every ASC is expected to check the receipt
status itself. Convoy checks it once, centrally, so a subscriber cannot get it wrong.

## What's here

```
contracts/sol/
  ConvoyRouter.sol            the ASC: batch verify, dedupe, status gate, route fan-out
  SubscriptionRegistry.sol    prepaid per-delivery fees, pull-payment to relayers
  RelayerBond.sol             permissionless relaying against a slashable bond
  ConvoyTypes.sol             the Fact a subscriber receives
  source/ConvoyEmitter.sol    source-chain emitter, deployed to Sepolia
  subscribers/                three unrelated demo dApps on one route table
relayer/
  batcher.ts                  the batching policy, pure and testable
  index.ts                    watch, group, prove, deliver
bench/bench.ts                the claim, measured on CC3 testnet
docs/ATTESTCOIN.md            how the protocol is used, and what is deliberately not used
```

## The three subscribers

They exist to prove one thing: the batch fills with traffic from applications that share nothing.

- **PassportSubscriber** — a portable credit passport fed by proved Ethereum repayments.
- **EscrowSubscriber** — CTC escrow released by a proved delivery-acceptance receipt.
- **CouncilSubscriber** — an autonomous agent treasury that may only move money on a quorum vote
  over a fact it received through Convoy. A proposal citing a fact the router never delivered to it
  cannot be constructed, not merely rejected. A council that runs its own ingest is only as honest
  as whoever operates that ingest; here the ingest is a bonded third party delivering the same fact
  to unrelated subscribers in the same transaction.

Each one is around forty lines. No precompile call, no proof handling, no status check, no worker.
That is the product.

## Running it

```bash
npm install
forge install foundry-rs/forge-std --no-git
forge test                       # 11 tests, real decoder, etched mock precompile
npx tsx relayer/index.ts --dry-run   # batching policy, no chain, no keys, no funds
```

The dry run is the fastest way to see the argument:

```
one dApp alone: three of its own events in a 1000-block window
  ship: 0  hold: 3  reason: none

shared rail: ten events from unrelated dApps land in the same window
  ship: 10  hold: 0  reason: full
  continuity hashes 10000 alone vs 1000 in convoy (10.0x)
  modelled CTC 0.003130 alone vs 0.000313 in convoy
```

### Live on testnet

```bash
cp .env.example .env             # fill in RPCs and three keys
npm run deploy:sepolia           # ConvoyEmitter on Sepolia
npm run deploy:creditcoin        # full stack on CC3 testnet, three dApps subscribed
npx tsx scripts/bond.ts          # relayer posts its bond
npm run emit -- 9                # source traffic, including one deliberate revert
npm run relayer                  # watch, group, prove, deliver
npm run bench -- 5               # measure convoy vs one-at-a-time, same work both ways
```

## Design notes worth arguing about

**Batching has a deadline, and waiting is not free.** Holding a transaction to find it companions
is profitable right up until its block falls out of the dense attestation window. After that the
attestations covering it are compacted into sparse checkpoints and the continuity proof jumps from
about 10 hashes to about 1000 — a hundredfold increase that no amount of sharing wins back. The
cost curve is not monotonic, and `relayer/batcher.ts` treats the wait as a bounded resource.

**Per-item failures never revert the batch.** A duplicate, a reverted source transaction, an
underfunded subscriber and a hostile callback each cost only their own slot. The single exception is
a proof that fails to verify, which correctly takes the whole convoy down, because in that case
nothing in it was established.

**Subscribers are charged before their callback runs.** The relayer has already paid the gas to
arrive. A dApp that reverts on purpose should not get free delivery.

**The bond does not secure the data.** A relayer cannot forge a proof; the precompile settles that.
The bond prices the two things a proof cannot rule out: censoring a paying subscriber, and spamming
the router with batches that deliver nothing.

## Status

Contracts, relayer, benchmark and tests are complete and green. Live testnet addresses land in
`deployments.json` once the deploy scripts run.
