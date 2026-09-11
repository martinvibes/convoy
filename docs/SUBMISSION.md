# Convoy — BUIDL CTC 2026 Fall

**The shared proof-delivery layer for Attestcoin. Many dApps, one continuity proof.**

Track: Infrastructure / DeFi. Live on Creditcoin CC3 testnet, reading Ethereum Sepolia.

## The problem, in one paragraph

An Attestcoin dApp that wants to trust an Ethereum transaction pays for two things: a Merkle proof
that the transaction is in its block, and a continuity proof linking that block back to one the
attestor network has already signed. The continuity proof is nearly the whole bill. Creditcoin
publishes the cost as roughly `2.3e-5 + 2.9e-7 × continuityHashCount` CTC per verification, and on a
quiet stretch of chain the hash count is the term that moves.

The precompile already knows how to avoid paying for it repeatedly. Its batch overload verifies up
to ten transactions under a **single** continuity proof, as long as they sit within 1000 blocks of
each other. Two things keep that overload out of reach:

1. `ASCBase`, the base contract every Attestcoin dApp inherits, never calls it.
2. A single dApp cannot fill it. One application almost never emits ten of its own events inside a
   1000-block window, and the ones that do are the ones that least need the discount.

The batch is only reachable by pooling traffic from applications that have nothing to do with each
other. That pooling cannot be built inside any one dApp. It has to live a layer down.

## What Convoy is

A bonded relayer watches the source chain for events belonging to **any** subscribed route, groups
them into a convoy of up to ten, buys one continuity proof for the group, and delivers every
resulting fact in a single Creditcoin transaction. Subscribers prepay a per-delivery fee; the
relayer is paid per delivered fact and has a slashable bond at stake.

```
contracts/sol/
  ConvoyRouter.sol            the ASC: batch verify, dedupe, status gate, route fan-out
  SubscriptionRegistry.sol    prepaid per-delivery fees, pull-payment to relayers
  RelayerBond.sol             permissionless relaying against a slashable bond
  source/ConvoyEmitter.sol    the source-chain emitter, deployed to Sepolia
  subscribers/                three unrelated demo dApps on one route table
relayer/                      watch, group, prove, deliver
ui/                           the dispatch board: Vite, React, Tailwind, no backend
```

A subscriber is about forty lines. It implements one callback and receives a `Fact`. No precompile
call, no proof handling, no receipt check, no worker process.

## The second thing it fixes

The Attestcoin docs carry a warning that is easy to read past: the precompile proves a transaction
was **included**, not that it **succeeded**. Every ASC is expected to check the receipt status
itself, and a dApp that forgets will happily act on a transaction that reverted.

Convoy checks it once, centrally, and refuses the query. A subscriber cannot get this wrong, because
a failed source transaction never reaches it. There is a live example of this below.

## Proof that it runs

Deployed and running on CC3 testnet. `npm run status` prints all of it live from the chain, and the
dashboard shows the same thing in a browser with no backend between.

| contract | address |
|---|---|
| ConvoyRouter | `0xD702DFdC1881144145660d92066B71b32Fac298D` |
| SubscriptionRegistry | `0xcA1A8a243DeC777eede2d63Db1B14fD3E6D02753` |
| RelayerBond | `0xb418a1EC09a002DCDbBdF775d3F5647B5AdC021D` |
| ConvoyEmitter (Sepolia) | `0x493eC14D06ce94C6F230A5dB7b3f3981949daB6C` |

The one transaction worth opening is
[`0xec3f6378…b822`](https://creditcoin-testnet.blockscout.com/tx/0xec3f63786e0e4549e51a971fd30072e4a2f820a7c6d6a18303bcd1888c4eb822):
ten real Sepolia transactions verified under one continuity proof of 20 hashes rather than 200, nine
facts handed to three dApps that share nothing, and one transaction refused because it had reverted
at the source. The precompile verified that tenth proof happily, because the transaction really is
in that block. Only Convoy's own receipt check stopped it becoming a fact.

Three convoys have been delivered on this deployment, carrying 26 Sepolia transactions and paying
for 50 continuity hashes where separate deliveries would have paid for 448. In the published cost
model that is 0.00008350 CTC against 0.00072792, a factor of 8.7. The most recent one,
[`0x5e32d031…055d`](https://creditcoin-testnet.blockscout.com/tx/0x5e32d031550acf9f737b982ba1554d3614b2350c8bab17a3fa22548a7cdd055d),
is the relayer working unattended: it filled a batch of ten from three unrelated routes, waited for
the attestor network to cover the last source block, and shipped.

## What a judge can run

```bash
npm install
forge install foundry-rs/forge-std --no-git
npm run check      # talks to the real precompile, prints what is attested, needs no keys
npm test           # 12 contract tests + 9 batching-policy tests
npm run ui         # the live dispatch board at http://localhost:5178
```

`npm run check` and `npm run ui` need no wallet and no funds. The board reads Creditcoin and Sepolia
straight from the browser, so it shows the live state of the deployment above without anything being
deployed locally.

To reproduce a convoy end to end with a funded key, `npm run demo -- 9` emits nine ordinary source
transactions plus one that reverts, waits for the attestor network, and delivers all ten as a single
convoy.

## What we learned running this against a live network

`docs/ATTESTCOIN.md` records four things that cost us real time and that any Attestcoin team will
hit: the SDK's attestation wait gives up long before the network catches up, a reverted source
transaction emits no logs so `eth_getLogs` can never find it, ethers v6 throws on a reverted receipt
in a way that hides it, and the public RPC rejects an unbounded `eth_getLogs`. None of these are in
the documentation.

## Scope, stated plainly

Writability is not used. The Attestcoin docs state it is still undergoing third-party testing and
audits, so Convoy is read-only by design.

The CTC figures on the board and in `npm run status` are modelled from Creditcoin's published cost
formula rather than metered per call, because the precompile does not bill separately from the
transaction. The hash counts they are computed from are real: they come from the events the router
emitted, and `npm run bench` runs the same work both ways to compare.
