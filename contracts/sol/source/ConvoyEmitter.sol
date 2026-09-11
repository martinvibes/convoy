// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title ConvoyEmitter
/// @notice Source-chain contract deployed to Ethereum Sepolia. Emits the events the demo
///         subscribers care about.
/// @dev Deliberately one contract emitting several distinct, unambiguous events, per the Attestcoin
///      guidance: a single emitter per dApp, purpose-built event names, and every field the
///      Creditcoin side needs carried in the event itself. In the demo this one contract stands in
///      for what would be three unrelated protocols in production — the point being that Convoy
///      batches across them either way, because it batches on block proximity, not on ownership.
contract ConvoyEmitter {
    /// @notice A borrower repaid a loan. Consumed by the credit passport.
    event RepaymentMade(address indexed borrower, bytes32 indexed loanId, uint256 amount, bool onTime);

    /// @notice A buyer signed off on delivery. Consumed by the escrow.
    event DeliveryAccepted(bytes32 indexed orderId, address indexed buyer, uint256 amount);

    /// @notice A market or treasury observation. Consumed by the council.
    event TreasurySignal(bytes32 indexed signalId, uint8 kind, int256 value);

    uint256 public nonce;

    function repay(bytes32 loanId, uint256 amount, bool onTime) external {
        nonce++;
        emit RepaymentMade(msg.sender, loanId, amount, onTime);
    }

    function acceptDelivery(bytes32 orderId, uint256 amount) external {
        nonce++;
        emit DeliveryAccepted(orderId, msg.sender, amount);
    }

    function signal(bytes32 signalId, uint8 kind, int256 value) external {
        nonce++;
        emit TreasurySignal(signalId, kind, value);
    }

    /// @notice Emit all three in one transaction. Used to show a single proved transaction fanning
    ///         out to three unrelated subscribers.
    function emitAll(bytes32 id, uint256 amount, int256 value) external {
        nonce++;
        emit RepaymentMade(msg.sender, id, amount, true);
        emit DeliveryAccepted(id, msg.sender, amount);
        emit TreasurySignal(id, 1, value);
    }

    /// @notice Always reverts. The transaction is still mined, still included in a Sepolia block,
    ///         and still fully provable by the precompile — inclusion is not success. Convoy's
    ///         receipt-status gate must skip it with SKIP_SOURCE_TX_FAILED rather than treating the
    ///         attempt as a repayment. Used as the live negative case in the demo.
    function repayThenRevert(bytes32 loanId, uint256 amount) external {
        nonce++;
        emit RepaymentMade(msg.sender, loanId, amount, true);
        revert("ConvoyEmitter: deliberate revert");
    }
}
