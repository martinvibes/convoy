// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title ConvoyTypes
/// @notice Shared value types for the Convoy proof-delivery layer.
library ConvoyTypes {
    /// @notice A single source-chain log that Convoy has proven and is handing to a subscriber.
    /// @dev Emitted facts are only ever constructed inside {ConvoyRouter} after the block-prover
    ///      precompile has verified inclusion AND the receipt status has been checked. A subscriber
    ///      that receives a Fact does not need to re-verify anything.
    struct Fact {
        bytes32 factId; // keccak(queryId, logIndex) — unique per delivered log
        bytes32 queryId; // stable id of the proved source transaction
        uint64 chainKey; // Creditcoin-internal source chain id (1 == Ethereum Sepolia on CC3 testnet)
        uint64 blockHeight; // source chain block containing the transaction
        uint64 txIndex; // index of the transaction within that block
        uint32 logIndex; // index of this log within the transaction receipt
        address emitter; // source-chain contract that emitted the log
        bytes32[] topics; // raw log topics; topics[0] is the event signature
        bytes data; // raw non-indexed log data
    }

    /// @notice Route key under which subscribers register interest.
    /// @dev A route is the triple (source chain, emitting contract, event signature). Convoy fans a
    ///      Fact out to every active subscription registered under its route.
    function routeKey(uint64 chainKey, address emitter, bytes32 topic0) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(chainKey, emitter, topic0));
    }
}
