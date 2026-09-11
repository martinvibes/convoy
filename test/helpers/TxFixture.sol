// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title TxFixture
/// @notice Builds `encodedTransaction` payloads in the exact shape EvmV1Decoder expects.
/// @dev The payload is `abi.encode(uint8 txType, bytes[] chunks)` where chunk 0 carries the common
///      fields, chunk 1 the type-specific fields, and chunk 2 (for types 0..2) the receipt.
///      Building these locally means the decode path under test is the real Gluwa library rather
///      than a stub, so a change in its layout breaks the suite instead of passing silently.
library TxFixture {
    struct LogTuple {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    struct AccessListEntryBytes32 {
        address account;
        bytes32[] storageKeys;
    }

    function encode(uint8 txType, uint8 receiptStatus, LogTuple[] memory logs)
        internal
        pure
        returns (bytes memory)
    {
        bytes[] memory chunks = new bytes[](3);

        chunks[0] = abi.encode(
            uint64(7), uint64(120_000), address(0xA11CE), false, address(0xB0B), uint256(0), bytes("")
        );

        chunks[1] = abi.encode(
            uint64(11155111),
            uint128(1 gwei),
            uint128(2 gwei),
            new AccessListEntryBytes32[](0),
            uint8(0),
            bytes32(0),
            bytes32(0)
        );

        chunks[2] = abi.encode(receiptStatus, uint64(90_000), logs, bytes(""));

        return abi.encode(txType, chunks);
    }

    function logs1(address emitter, bytes32[] memory topics, bytes memory data)
        internal
        pure
        returns (LogTuple[] memory out)
    {
        out = new LogTuple[](1);
        out[0] = LogTuple({address_: emitter, topics: topics, data: data});
    }

    function topics2(bytes32 t0, bytes32 t1) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](2);
        t[0] = t0;
        t[1] = t1;
    }

    function topics3(bytes32 t0, bytes32 t1, bytes32 t2) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](3);
        t[0] = t0;
        t[1] = t1;
        t[2] = t2;
    }
}
