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
  attestation.ts              a wait that survives the public RPC
ui/                           the dispatch board: Vite, React, Tailwind, no backend
bench/bench.ts                the claim, measured on CC3 testnet
docs/ATTESTCOIN.md            how the protocol is used, and what is deliberately not used
docs/SUBMISSION.md            the hackathon write-up: problem, proof, and what a judge can run
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

## Live on Creditcoin CC3 testnet

| contract | address |
|---|---|
| ConvoyRouter | `0xD702DFdC1881144145660d92066B71b32Fac298D` |
| SubscriptionRegistry | `0xcA1A8a243DeC777eede2d63Db1B14fD3E6D02753` |
| RelayerBond | `0xb418a1EC09a002DCDbBdF775d3F5647B5AdC021D` |
| PassportSubscriber | `0xCF95FDC334C387bD9efEa3Ea65Cad47563af648a` |
| EscrowSubscriber | `0xAd3CA72748fF16BbD2A8C6f995C70ED61E875942` |
| CouncilSubscriber | `0x2F6C91d8046F2f398894C070eB4d5b0934493826` |
| ConvoyEmitter (Sepolia) | `0x493eC14D06ce94C6F230A5dB7b3f3981949daB6C` |

Six convoys delivered so far, carrying 48 real Sepolia transactions to three unrelated dApps.

```
convoys delivered     6
transactions proven   48
continuity hashes     190
facts handed to apps  36

per convoy:
  9 transactions   15 hashes shared    (135 if delivered alone,   9.0x)
  1 transaction     4 hashes shared      (4 if delivered alone,   1.0x)
 10 transactions   30 hashes shared    (300 if delivered alone,  10.0x)
  8 transactions   17 hashes shared    (136 if delivered alone,   8.0x)
 10 transactions  108 hashes shared   (1080 if delivered alone,  10.0x)
 10 transactions   16 hashes shared    (160 if delivered alone,  10.0x)

modelled cost  alone 0.00163035 CTC  vs convoy 0.00019310 CTC  (8.4x)
```

The fifth line is the interesting one. Those transactions sat unclaimed long enough for their
attestations to start compacting, and the continuity proof went from about 16 hashes to 108. That is
the cost curve `relayer/batcher.ts` is built around, showing up on a live network.

The most recent convoy is the whole argument in one transaction
([`0x901e3e42…2658a`](https://creditcoin-testnet.blockscout.com/tx/0x901e3e4286a9f7d58799977b151335549d5e88dc1c27e8b8b2db1efa0ed2658a)):
ten Sepolia transactions verified under one continuity proof of 16 hashes, nine facts handed to
three dApps that share nothing, and one transaction refused because it had reverted at the source.
The precompile verified that tenth proof happily, because the transaction really is in that block.
Only Convoy's own receipt check stopped it becoming a fact.

`npm run status` prints all of that live from the chain.

## Running it

```bash
npm install
forge install foundry-rs/forge-std --no-git
npm test                         # 12 contract tests + 9 batching-policy tests
npm run check                    # preflight against live CC3 testnet, no keys needed
npx tsx relayer/index.ts --dry-run   # batching policy, no chain, no keys, no funds
npm run ui                       # the dispatch board, reads the chain from your browser
```

### The dashboard

`npm run ui` serves a live board at `http://localhost:5178`. Vite, React and Tailwind, with no
backend and no indexer. Both the Creditcoin and Sepolia public RPCs send
`access-control-allow-origin: *`, so the browser reads them directly, and the contract addresses
come from the same `deployments.json` the deploy script writes.

The hero is the manifest of one convoy: the shared escort on the left, the cargo it covered on the
right, one coloured block per subscribing dApp and red for anything refused. Under it, two bars for
what those same transactions would have cost travelling alone.

Below that is the clock the whole system runs on: how far Creditcoin's attestor network has got
through Sepolia, read live off the ChainInfo precompile. Nothing can be proven from the red stretch
yet, so that gap is the honest answer to how long a delivery takes, and it is where the six-minute
wait in every run below comes from.

Nothing on it is unverifiable. Every cargo row resolves its source block height and transaction
index against Sepolia and links the real Ethereum transaction, on a phone as well as a desktop.
Every convoy and refusal links to the Creditcoin transaction that delivered it, and every hash and
address on the page can be copied in one click. The dispatch log is selectable, so any earlier
convoy can be pulled up into the manifest, and each row carries the time its block was mined. The
refresh is visible rather than silent: a countdown to the next read, a button to force one, and a
failed read that says so while keeping the data it already had.

`npm run check` talks to the real ChainInfo precompile and prints what is currently attested:

```
Creditcoin  chain id 102031  head 5469349  https://rpc.cc3-testnet.creditcoin.network
source chains readable from here:
  chainKey 3   Ethereum           evm chain id 1          latest attestation 25954240 (attestation)
  chainKey 1   Sepolia ethereum   evm chain id 11155111   latest attestation 11682000 (attestation)
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
cp .env.example .env                 # fill in RPCs and three keys
npm run deploy:sepolia               # ConvoyEmitter on Sepolia
npm run deploy:creditcoin            # full stack on CC3 testnet, three dApps subscribed
npx tsx scripts/fund-relayer.ts 150  # the relayer is a separate key on purpose
npx tsx scripts/bond.ts              # relayer posts its bond
npm run demo -- 9                    # the whole argument in one command
npm run status                       # what actually happened, read back from the chain
```

`npm run demo` emits nine events for three unrelated dApps plus one transaction that reverts, waits
for the attestor network, and delivers all ten as a single convoy. Nine facts are handed to
subscribers; the reverted one is refused. Add `--resume` to redeliver the same source transactions
without paying to emit them again.

The relayer is the same thing without the staging:

```bash
npm run emit -- 9                    # source traffic
npm run relayer                      # watch, group, prove, deliver
npm run relayer -- --from <block>    # replay a range after a restart
npm run bench -- 5                   # convoy vs one-at-a-time, same work both ways
```

Note that `npm run relayer` cannot deliver the reverted transaction: a revert emits no logs, so
`eth_getLogs` never sees it. `scripts/prove-failure.ts <txhash>` delivers one by hash, which is how
the receipt-status gate gets exercised against a real failure.

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

**The public testnet RPC shapes the code more than it should.** Three things were not optional.
`eth_getLogs` must be bounded, so every scan starts at `DEPLOY_BLOCK`. The SDK's
`waitUntilHeightAttested` defaults to a 60 second timeout against a measured attestation lag of
about 6.4 minutes, and gives up after five failed polls, so `relayer/attestation.ts` replaces it.
And a relayer that starts at chain head silently drops whatever was emitted while it was down.

## Status

Deployed and running on CC3 testnet. Contracts, relayer, dashboard, benchmark and tests are
complete and green. Writability is not used: the Attestcoin docs state it is still undergoing
third-party testing and audits, so Convoy is read-only by design.
