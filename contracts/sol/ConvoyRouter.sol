// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {ConvoyTypes} from "./ConvoyTypes.sol";
import {IConvoySubscriber} from "./IConvoySubscriber.sol";
import {SubscriptionRegistry} from "./SubscriptionRegistry.sol";
import {RelayerBond} from "./RelayerBond.sol";

/// @title ConvoyRouter
/// @notice The Attestcoin Smart Contract at the centre of Convoy: one continuity proof, many
///         transactions, many unrelated dApps.
///
/// @dev Why this contract exists.
///
/// `ASCBase.execute` — the base contract the Attestcoin examples hand every dApp — verifies exactly
/// one source transaction per call and carries a full continuity proof to do it. On-chain
/// verification cost is dominated by that continuity proof: roughly
/// `2.3e-5 + 2.9e-7 * continuityHashCount` CTC, where the hash count is ~10 for a transaction
/// proven minutes after finality and ~1000 once the attestations covering it have been compacted
/// into sparse checkpoints.
///
/// The precompile has always exposed a batch overload that verifies up to `MAX_BATCH_SIZE`
/// transactions under a single shared continuity proof, provided they fall within
/// `MAX_BATCH_RANGE` blocks of each other. `ASCBase` never calls it, and in practice a single dApp
/// could not fill a batch anyway: one application rarely emits ten of its own events inside a
/// 1000-block window. Batching is only reachable by pooling demand across applications that have
/// nothing to do with each other.
///
/// That pooling is the whole product. Convoy is the shared rail, and the amortised continuity proof
/// is why sharing it is cheaper than going alone.
///
/// Convoy also closes a documented footgun. The block-prover precompile proves that a transaction
/// was *included*; it does not check whether that transaction *succeeded*. Every ASC is expected to
/// check the receipt status itself. Convoy checks it once, centrally, and a subscriber that
/// receives a {ConvoyTypes.Fact} is holding a log from a transaction that was both proven and
/// successful.
contract ConvoyRouter {
    using ConvoyTypes for uint64;

    /// @notice Precompile limits, mirrored so callers get a clean revert instead of a native one.
    uint256 public constant MAX_BATCH_SIZE = 10;
    uint256 public constant MAX_BATCH_RANGE = 1000;

    /// @notice Skip reasons surfaced in {QuerySkipped}.
    uint8 public constant SKIP_DUPLICATE = 1;
    uint8 public constant SKIP_SOURCE_TX_FAILED = 2;
    uint8 public constant SKIP_BAD_TX_TYPE = 3;

    INativeQueryVerifier public immutable VERIFIER;
    SubscriptionRegistry public immutable REGISTRY;
    RelayerBond public immutable BOND;

    /// @notice Proved source transactions, keyed by (chainKey, height, txIndex).
    mapping(bytes32 => bool) public processedQueries;
    /// @notice Every log Convoy has ever handed out, keyed by (queryId, logIndex).
    mapping(bytes32 => bool) public deliveredFacts;
    /// @notice factId => subscriber => the subscriber actually accepted this fact.
    mapping(bytes32 => mapping(address => bool)) private _acceptedBy;

    /// @notice Running totals. Convoy's economic claim is measurable, so it is measured on-chain.
    uint256 public totalBatches;
    uint256 public totalQueriesVerified;
    uint256 public totalContinuityHashes;
    uint256 public totalFactsDelivered;

    event ConvoyDelivered(
        address indexed relayer, uint64 indexed chainKey, uint256 queries, uint256 facts, uint256 continuityHashes
    );
    event QuerySkipped(bytes32 indexed queryId, uint8 reason, uint64 height, uint64 txIndex);
    event FactDelivered(
        bytes32 indexed factId,
        bytes32 indexed subId,
        address indexed callback,
        bool accepted,
        uint64 height,
        uint64 txIndex
    );

    error NotBonded();
    error EmptyBatch();
    error BatchTooLarge();
    error LengthMismatch();
    error BatchRangeExceeded();
    error VerificationFailed();

    constructor(address registry, address bond) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        REGISTRY = SubscriptionRegistry(registry);
        BOND = RelayerBond(bond);
    }

    modifier onlyBondedRelayer() {
        if (!BOND.isBonded(msg.sender)) revert NotBonded();
        _;
    }

    /// @notice Deliver a convoy: up to {MAX_BATCH_SIZE} proved transactions under ONE continuity
    ///         proof, fanned out to every subscription registered for their events.
    /// @dev Per-item failures never revert the batch. A duplicate query, a failed source
    ///      transaction, an underfunded subscriber or a reverting callback each cost only their own
    ///      slot. A shared rail where one bad passenger strands everyone else is not a shared rail.
    function deliver(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external onlyBondedRelayer returns (uint256 facts) {
        uint256 n = heights.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH_SIZE) revert BatchTooLarge();
        if (encodedTransactions.length != n || merkleProofs.length != n) revert LengthMismatch();
        _requireWithinRange(heights);

        // The entire economic argument for Convoy is this single call: one continuity proof
        // amortised across n transactions belonging to n unrelated applications.
        if (!VERIFIER.verifyAndEmit(chainKey, heights, encodedTransactions, merkleProofs, sharedContinuityProof)) {
            revert VerificationFailed();
        }

        for (uint256 i; i < n; ++i) {
            facts += _process(chainKey, heights[i], encodedTransactions[i], merkleProofs[i]);
        }

        uint256 hashes = sharedContinuityProof.roots.length;
        totalBatches += 1;
        totalQueriesVerified += n;
        totalContinuityHashes += hashes;
        totalFactsDelivered += facts;

        emit ConvoyDelivered(msg.sender, chainKey, n, facts, hashes);
    }

    /// @notice Baseline path: one transaction, its own continuity proof. Mirrors `ASCBase.execute`.
    /// @dev Kept deliberately, and used by the benchmark. The saving Convoy claims is the measured
    ///      difference between this function and {deliver} over the same set of transactions, so
    ///      both paths must run identical downstream work on the same contract.
    function deliverSingle(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external onlyBondedRelayer returns (uint256 facts) {
        if (!VERIFIER.verifyAndEmit(chainKey, height, encodedTransaction, merkleProof, continuityProof)) {
            revert VerificationFailed();
        }

        facts = _process(chainKey, height, encodedTransaction, merkleProof);

        uint256 hashes = continuityProof.roots.length;
        totalBatches += 1;
        totalQueriesVerified += 1;
        totalContinuityHashes += hashes;
        totalFactsDelivered += facts;

        emit ConvoyDelivered(msg.sender, chainKey, 1, facts, hashes);
    }

    /// @notice Did `subscriber` accept `factId` from this router?
    /// @dev The hook downstream policy contracts use to make "I acted only on attested facts" a
    ///      checkable claim rather than a promise.
    function wasAcceptedBy(bytes32 fId, address subscriber) external view returns (bool) {
        return _acceptedBy[fId][subscriber];
    }

    function queryId(uint64 chainKey, uint64 height, uint64 txIndex) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(chainKey, height, txIndex));
    }

    function factId(bytes32 qId, uint32 logIndex) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(qId, logIndex));
    }

    // --- internals ---

    function _requireWithinRange(uint64[] calldata heights) private pure {
        uint64 lo = heights[0];
        uint64 hi = heights[0];
        for (uint256 i = 1; i < heights.length; ++i) {
            uint64 h = heights[i];
            if (h < lo) lo = h;
            if (h > hi) hi = h;
        }
        if (hi - lo > MAX_BATCH_RANGE) revert BatchRangeExceeded();
    }

    /// @dev Decode one already-verified transaction and fan its logs out. Returns facts delivered.
    function _process(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof
    ) private returns (uint256 facts) {
        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        bytes32 qId = queryId(chainKey, height, txIndex);

        if (processedQueries[qId]) {
            emit QuerySkipped(qId, SKIP_DUPLICATE, height, txIndex);
            return 0;
        }
        processedQueries[qId] = true;

        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) {
            emit QuerySkipped(qId, SKIP_BAD_TX_TYPE, height, txIndex);
            return 0;
        }

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);

        // The precompile proves inclusion, not success. A reverted source transaction is a real
        // transaction in a real block, and without this check it would be delivered as fact.
        if (receipt.receiptStatus != 1) {
            emit QuerySkipped(qId, SKIP_SOURCE_TX_FAILED, height, txIndex);
            return 0;
        }

        uint256 logCount = receipt.receiptLogs.length;
        for (uint256 j; j < logCount; ++j) {
            EvmV1Decoder.LogEntry memory log = receipt.receiptLogs[j];
            if (log.topics.length == 0) continue;
            facts += _fanout(_buildFact(qId, chainKey, height, txIndex, uint32(j), log));
        }
    }

    function _buildFact(
        bytes32 qId,
        uint64 chainKey,
        uint64 height,
        uint64 txIndex,
        uint32 logIndex,
        EvmV1Decoder.LogEntry memory log
    ) private pure returns (ConvoyTypes.Fact memory fact) {
        fact = ConvoyTypes.Fact({
            factId: factId(qId, logIndex),
            queryId: qId,
            chainKey: chainKey,
            blockHeight: height,
            txIndex: txIndex,
            logIndex: logIndex,
            emitter: log.address_,
            topics: log.topics,
            data: log.data
        });
    }

    /// @dev Push one fact to every active subscription on its route.
    function _fanout(ConvoyTypes.Fact memory fact) private returns (uint256 delivered) {
        bytes32 rKey = ConvoyTypes.routeKey(fact.chainKey, fact.emitter, fact.topics[0]);
        bytes32[] memory ids = REGISTRY.subscriptionsFor(rKey);
        uint256 len = ids.length;
        if (len == 0) return 0;

        deliveredFacts[fact.factId] = true;

        for (uint256 k; k < len; ++k) {
            SubscriptionRegistry.Subscription memory s = REGISTRY.get(ids[k]);
            if (!s.active) continue;

            // Charge before the callback: the relayer has already paid the gas to get here, so a
            // subscriber cannot dodge the fee by reverting on purpose.
            if (!REGISTRY.chargeFor(ids[k], msg.sender)) continue;

            bool accepted;
            try IConvoySubscriber(s.callback).onAttestedFact{gas: s.callbackGasLimit}(fact) {
                accepted = true;
                _acceptedBy[fact.factId][s.callback] = true;
            } catch {
                accepted = false;
            }

            unchecked {
                ++delivered;
            }
            emit FactDelivered(
                fact.factId, ids[k], s.callback, accepted, fact.blockHeight, fact.txIndex
            );
        }
    }
}
