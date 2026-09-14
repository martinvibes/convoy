<p align="center">
  <strong>CONVOY</strong><br>
  The shared proof-delivery layer for Attestcoin.<br>
  Many dApps, one continuity proof.
</p>

<p align="center">
  Built for <strong>BUIDL CTC 2026 Fall</strong> · Track: Infrastructure / DeFi<br>
  Live on Creditcoin CC3 testnet, reading Ethereum Sepolia
</p>

---

## The Problem

Every Attestcoin dApp that trusts an Ethereum transaction pays for two things: a Merkle proof that the transaction is in its block, and a **continuity proof** linking that block to one the attestor network has already signed. The continuity proof is nearly the entire cost — roughly `2.3e-5 + 2.9e-7 × continuityHashCount` CTC per verification.

The precompile already has a batch overload that shares one continuity proof across ten transactions. But two things keep it out of reach:

1. **`ASCBase` never calls it.** The base contract every Attestcoin dApp inherits uses the single-transaction path.
2. **No single dApp can fill it.** One app almost never emits ten events in a 1000-block window.

The batch is only reachable by pooling traffic from applications that have **nothing to do with each other**. That pooling can't be built inside any one dApp. It has to live a layer down.

## The Solution

Convoy is that layer. A bonded relayer watches the source chain for events from **any** subscribed route, groups them into a convoy of up to ten, buys one continuity proof for the group, and delivers every resulting fact in a single Creditcoin transaction.

Subscribers prepay a per-delivery fee. The relayer is paid per delivered fact and has a slashable bond at stake.

### What a subscriber writes

About **forty lines**. One callback, receives a `Fact`. No precompile call, no proof handling, no receipt check, no worker process. That's the entire integration.

### The second thing it fixes

The Attestcoin docs carry a warning that's easy to read past: the precompile proves a transaction was **included**, not that it **succeeded**. A dApp that forgets will act on a reverted transaction. Convoy checks the receipt status once, centrally, and refuses the delivery. A subscriber **cannot get this wrong** — failed source transactions never reach it.

---

## Proof That It Works

Deployed and verified on CC3 testnet. Every number below is read from the chain.

### Testnet Results

```
Convoys delivered       3
Transactions proven    26
Continuity hashes      50   (vs 448 if delivered alone)
Facts delivered        25
```

| Convoy | Transactions | Shared Hashes | Alone Hashes | Savings |
|--------|:---:|:---:|:---:|:---:|
| Full batch | 10 | 20 | 200 | **10.0×** |
| Deadline ship | 6 | 13 | 78 | **6.0×** |
| Full batch | 10 | 17 | 170 | **10.0×** |

**Modelled cost: 0.00008350 CTC vs 0.00072792 CTC alone → 8.7× cheaper.**

### Key Transactions

- [**`0xec3f6378…b822`**](https://creditcoin-testnet.blockscout.com/tx/0xec3f63786e0e4549e51a971fd30072e4a2f820a7c6d6a18303bcd1888c4eb822) — The whole argument in one tx: 10 Sepolia transactions, one continuity proof (20 hashes), 9 facts to 3 unrelated dApps, 1 reverted tx caught and refused.
- [**`0x5e32d031…055d`**](https://creditcoin-testnet.blockscout.com/tx/0x5e32d031550acf9f737b982ba1554d3614b2350c8bab17a3fa22548a7cdd055d) — Fully unattended delivery: the relayer filled a batch of 10 from 3 routes, waited for attestation, and shipped.

---

## Deployed Contracts

| Contract | Network | Address |
|---|---|---|
| ConvoyRouter | CC3 Testnet | `0xD702DFdC1881144145660d92066B71b32Fac298D` |
| SubscriptionRegistry | CC3 Testnet | `0xcA1A8a243DeC777eede2d63Db1B14fD3E6D02753` |
| RelayerBond | CC3 Testnet | `0xb418a1EC09a002DCDbBdF775d3F5647B5AdC021D` |
| PassportSubscriber | CC3 Testnet | `0xCF95FDC334C387bD9efEa3Ea65Cad47563af648a` |
| EscrowSubscriber | CC3 Testnet | `0xAd3CA72748fF16BbD2A8C6f995C70ED61E875942` |
| CouncilSubscriber | CC3 Testnet | `0x2F6C91d8046F2f398894C070eB4d5b0934493826` |
| ConvoyEmitter | Sepolia | `0x493eC14D06ce94C6F230A5dB7b3f3981949daB6C` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     ETHEREUM SEPOLIA                         │
│  ConvoyEmitter.sol — emits events for subscribed dApps       │
└───────────────────────────┬─────────────────────────────────┘
                            │  events
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    RELAYER (off-chain)                        │
│  Watch → Group into convoys (≤10) → Wait for attestation     │
│  → Build batch continuity proof → Deliver to router          │
└───────────────────────────┬─────────────────────────────────┘
                            │  single tx
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  CREDITCOIN CC3 TESTNET                       │
│                                                              │
│  ConvoyRouter.sol ── batch verify, dedupe, status-gate,      │
│       │               route fan-out                           │
│       ├── SubscriptionRegistry.sol (prepaid fees)             │
│       ├── RelayerBond.sol (slashable bond)                    │
│       │                                                      │
│       ├──→ PassportSubscriber  (credit passport)              │
│       ├──→ EscrowSubscriber    (escrow release)               │
│       └──→ CouncilSubscriber   (DAO treasury)                 │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
contracts/sol/
  ConvoyRouter.sol              the ASC: batch verify, dedupe, status gate, route fan-out
  SubscriptionRegistry.sol      prepaid per-delivery fees, pull-payment to relayers
  RelayerBond.sol               permissionless relaying against a slashable bond
  ConvoyTypes.sol               the Fact struct a subscriber receives
  source/ConvoyEmitter.sol      source-chain emitter (Sepolia)
  subscribers/                  three unrelated demo dApps on one route table

relayer/
  batcher.ts                    the batching policy, pure and testable
  index.ts                      watch, group, prove, deliver
  attestation.ts                a wait that survives the public RPC

ui/                             dispatch board: Vite + React + Tailwind, no backend
bench/bench.ts                  the cost claim, measured on CC3 testnet
docs/ATTESTCOIN.md              how the protocol is used and what is deliberately skipped
docs/SUBMISSION.md              hackathon write-up: problem, proof, and what a judge can run
```

### The Three Subscribers

They exist to prove one thing: **the batch fills with traffic from applications that share nothing.**

| Subscriber | What it does | Why it needs a cross-chain fact |
|---|---|---|
| **PassportSubscriber** | Portable credit passport | Fed by proved Ethereum repayments |
| **EscrowSubscriber** | CTC escrow release | Triggered by proved delivery-acceptance receipt |
| **CouncilSubscriber** | DAO treasury with quorum governance | Can only move funds on a fact delivered through Convoy — a proposal citing a fact the router never delivered cannot even be constructed |

Each is ~40 lines. No precompile call, no proof handling, no status check, no worker. **That is the product.**

---

## Quickstart

### View only (no wallet, no funds needed)

```bash
npm install
forge install foundry-rs/forge-std --no-git
npm test                           # 12 contract tests + 9 batching-policy tests
npm run check                      # preflight against live CC3 testnet
npm run ui                         # dispatch board at http://localhost:5178
```

The dashboard reads Creditcoin and Sepolia **directly from the browser** — no backend, no indexer. It shows the live state of the deployed contracts immediately.

### Full end-to-end (with funded keys)

```bash
cp .env.example .env               # fill in RPCs and three private keys
npm run deploy:sepolia             # ConvoyEmitter on Sepolia
npm run deploy:creditcoin          # full stack on CC3, three dApps auto-subscribed
npx tsx scripts/fund-relayer.ts 150
npx tsx scripts/bond.ts            # relayer posts its bond
npm run demo -- 9                  # emit 9 events + 1 revert → deliver as one convoy
npm run status                     # read results from the chain
```

### Relayer mode

```bash
npm run emit -- 9                  # source traffic
npm run relayer                    # watch, group, prove, deliver
npm run relayer -- --from <block>  # replay a range after restart
npm run bench -- 5                 # convoy vs one-at-a-time, same work both ways
```

### The Dashboard

`npm run ui` serves a live board at `http://localhost:5178`.

| Section | What it shows |
|---|---|
| **Header** | Live Creditcoin block height, auto-refresh countdown |
| **How It Works** | Quick visual explainer |
| **Latest Manifest** | The shared escort + cargo, coloured per subscriber, red for refused |
| **What Sharing Saved** | Two bars: cost alone vs cost in convoy |
| **Where the Attestors Are** | Live attestation progress — the honest answer to "how long" |
| **Since Deployment** | Aggregate totals across all convoys |
| **Dispatch Log** | Every convoy ever shipped, click to swap manifest view |
| **Who Is Subscribed** | Active subscribers and their routes |

---

## Design Decisions

**Batching has a deadline, and waiting is not free.**
Holding a transaction to find companions is profitable only until its block falls out of the dense attestation window. After that, continuity proofs jump from ~10 hashes to ~1000. The cost curve is not monotonic, and `relayer/batcher.ts` treats wait time as a bounded resource.

**Per-item failures never revert the batch.**
A duplicate, a reverted source tx, an underfunded subscriber, or a hostile callback each cost only their own slot. The only exception: a proof that fails to verify takes the whole convoy down, because nothing in it was established.

**Subscribers are charged before their callback runs.**
The relayer already paid gas to arrive. A dApp that reverts on purpose shouldn't get free delivery.

**The bond doesn't secure the data.**
A relayer can't forge a proof — the precompile settles that. The bond prices two things proofs can't rule out: censoring a paying subscriber, and spamming the router with empty batches.

**The public testnet RPC shapes the code more than it should.**
Three things were unavoidable: `eth_getLogs` must be bounded (every scan starts at `DEPLOY_BLOCK`), the SDK's `waitUntilHeightAttested` times out before attestation completes (replaced in `relayer/attestation.ts`), and a relayer starting at chain head silently drops everything emitted while it was down.

---

## Status

✅ **Live on CC3 testnet** — contracts, relayer, dashboard, benchmark, and tests are all complete and green.

Writability is not used. The Attestcoin docs state it is still undergoing third-party testing and audits, so Convoy is **read-only by design**.

---

<p align="center">
  <strong>Convoy — because the discount only exists if you share the road.</strong>
</p>
