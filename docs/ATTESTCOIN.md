# How Convoy uses the Attestcoin Protocol

This is the integration document required by the submission rules. It covers what Convoy calls, why
it calls it that way, and which parts of the protocol it deliberately does not touch.

## The gap Convoy fills

The Attestcoin docs describe four pieces a cross-chain dApp must stand up: a source chain contract,
an Attestcoin Smart Contract on Creditcoin, business logic contracts, and an off-chain readability
worker. Two places in the documentation note that the fourth piece is meant to become a service:

> In the future Attestcoin relayers will offer a paid service to submit readability queries to dApp
> Attestcoin Smart Contracts. With this service, dApp teams can avoid standing up their own Oracle
> Workers, instead paying a small fee for query submission.

That service does not exist yet. Every dApp runs its own worker, and every worker buys its own
proofs.

## Why a shared worker is cheaper, and not by a little

On-chain verification cost is dominated by the continuity proof. The documented model is:

```
CTC cost ~= 2.3e-5 + 2.9e-7 * continuityHashCount
```

The hash count is not fixed. It depends on how far the queried block sits from the nearest
attestation or checkpoint:

| when the transaction is proven | continuity hashes | modelled CTC |
| --- | --- | --- |
| ~10 minutes after finality, dense attestations still in storage | ~10 | 0.0000259 |
| 24 hours later, attestations compacted into checkpoints (1 per 1000 blocks) | ~1000 | 0.000313 |

The block-prover precompile at `0x0FD2` exposes a batch overload:

```solidity
function verifyAndEmit(
    uint64 chainKey,
    uint64[] calldata heights,
    bytes[] calldata encodedTransactions,
    MerkleProof[] calldata merkleProofs,
    ContinuityProof calldata sharedContinuityProof
) external returns (bool);
```

One continuity proof, up to `MAX_BATCH_SIZE` (10) transactions, which must fall within
`MAX_BATCH_RANGE` (1000) blocks of each other.

`ASCBase.execute` — the base contract the official examples hand every dApp — does not call it. It
calls the single-transaction overload and carries a full continuity proof for each query.

That is not an oversight so much as a consequence. A single application very rarely emits ten of its
own events inside a 1000-block window, so even a dApp that implemented batching itself would spend
most of its life shipping batches of one. The batch overload is only reachable in practice by
pooling traffic across applications that have nothing to do with each other, and no single
application can do that for itself.

Convoy is that pool. It is the only reason the batch overload becomes economically live.

## What Convoy calls

**`INativeQueryVerifier.verifyAndEmit` (batch overload)** — `ConvoyRouter.deliver`. One call per
convoy, carrying up to ten transactions under one shared continuity proof. This is the load-bearing
call in the entire project.

**`INativeQueryVerifier.verifyAndEmit` (single overload)** — `ConvoyRouter.deliverSingle`. Kept
deliberately as the benchmark baseline. It reproduces the path `ASCBase` puts every dApp on, so the
saving Convoy claims is measured as the difference between two functions on the same contract doing
identical downstream work, rather than a comparison against a different codebase.

**`INativeQueryVerifier.calculateTxIndex`** — used to derive a stable query id
`keccak(chainKey, blockHeight, txIndex)` for replay protection. A transaction's position in its
block is part of its identity, so two different proofs of the same transaction collapse to the same
id and the second is skipped.

**`EvmV1Decoder.getTransactionType` / `decodeReceiptFields` / `getLogsByEventSignature`** — decoding
the verified transaction bytes into receipt fields and logs. The Gluwa library is used as-is; the
test suite builds fixtures in its exact `abi.encode(uint8 txType, bytes[] chunks)` layout so a
change in that layout breaks the suite rather than passing silently.

**`chainInfo.PrecompileChainInfoProvider.waitUntilHeightAttested`** — the relayer blocks here before
asking for proofs, so it never requests a proof for a block the attestor network has not covered.

**`proofProvider.service.ProofBuilder.getBatchProof` / `getProof`** — proof construction, hosted
service rather than local computation.

## The receipt status gate

The documentation carries this warning:

> The block prover precompile does not validate if a transaction was successful or not. It only
> validates if a transaction is included in a block and that block is really a part of the confirmed
> source chain. Therefore, a dApp's ASC MUST check the "status" field of the transaction.

Inclusion is not success. A reverted transaction is mined, included, and fully provable, and its
transaction-level fields — sender, recipient, value, calldata — survive intact in the proved bytes.
An ASC that reads those fields without checking the receipt status will act on a payment that never
moved.

Every ASC is expected to remember this independently. Convoy checks it once, in
`ConvoyRouter._process`, before a fact is constructed at all. A subscriber holding a
`ConvoyTypes.Fact` is holding a log from a transaction that was both proven and successful, and does
not need to know the rule exists.

`ConvoyEmitter.repayThenRevert` on Sepolia is the live negative case: a real transaction, really
included, really provable, correctly skipped with `SKIP_SOURCE_TX_FAILED`.

## Failure isolation

A shared rail where one bad passenger strands everyone else is not a shared rail. Convoy never
reverts a batch for a per-item problem:

| situation | outcome |
| --- | --- |
| duplicate query | that slot is skipped, `QuerySkipped(SKIP_DUPLICATE)` |
| source transaction reverted | that slot is skipped, `QuerySkipped(SKIP_SOURCE_TX_FAILED)` |
| unsupported transaction type | that slot is skipped, `QuerySkipped(SKIP_BAD_TX_TYPE)` |
| subscriber out of prepaid balance | that subscriber is skipped, others still served |
| subscriber callback reverts | caught, capped at its own gas limit, `FactDelivered(accepted=false)` |
| proof does not verify | the whole batch reverts, which is correct — the proof covers all of it |

The last row is the only one that takes everyone down, and it should: a failed continuity proof
means nothing in the convoy was established.

## What Convoy does not use

**Writability.** The docs state it is undergoing third-party testing and audits and that details
will follow once it is released on Creditcoin testnet. Convoy is read-only: Creditcoin contracts
verifying Ethereum transactions, nothing sent back. The `deliver` path extends naturally to
writability when it ships, since batching a shared outbox has the same economics, but nothing here
depends on an unreleased feature.

**Mainnet.** Everything is deployed against CC3 testnet with Ethereum Sepolia as the source chain
(`chainKey` 1, which is not the EVM chain id 11155111).

## Addresses and environments

| thing | value |
| --- | --- |
| Creditcoin CC3 testnet RPC | `https://rpc.cc3-testnet.creditcoin.network` (chain id 102031) |
| Proof builder | `https://prover.cc3-testnet.creditcoin.network` |
| BlockProver precompile | `0x0000000000000000000000000000000000000FD2` |
| ChainInfo precompile | `0x0000000000000000000000000000000000000fd3` |
| Source chain | Ethereum Sepolia, `chainKey` 1 |

Deployed Convoy addresses are written to `deployments.json` by the deploy scripts.
