// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

/// @notice Stand-in for the block-prover precompile at 0x0FD2, etched into place by the tests.
/// @dev The real precompile is native Rust and cannot run under forge. The mock keeps the parts the
///      router depends on: the two verifyAndEmit overloads and a deterministic calculateTxIndex.
///      Slot 0 is a fail switch the tests flip with vm.store.
contract MockVerifier is INativeQueryVerifier {
    uint256 private _failMode; // slot 0: 1 == reject everything

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata
    ) external returns (bool) {
        if (_failMode == 1) return false;
        emit TransactionVerified(chainKey, height, _index(merkleProof));
        return true;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata
    ) external returns (bool) {
        if (_failMode == 1) return false;
        for (uint256 i; i < heights.length; ++i) {
            emit TransactionVerified(chainKey, heights[i], _index(merkleProofs[i]));
        }
        return true;
    }

    function verify(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        return _failMode != 1;
    }

    function verify(uint64, uint64[] calldata, bytes[] calldata, MerkleProof[] calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        return _failMode != 1;
    }

    function calculateTxIndex(MerkleProof calldata merkleProof) external pure returns (uint64) {
        return _index(merkleProof);
    }

    /// @dev Derived from the Merkle root so a test can pin a transaction index by choosing a root.
    function _index(MerkleProof calldata p) private pure returns (uint64) {
        return uint64(uint256(p.root) & 0xffff);
    }
}
