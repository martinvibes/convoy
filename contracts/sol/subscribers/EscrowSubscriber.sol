// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ConvoyTypes} from "../ConvoyTypes.sol";
import {ConvoySubscriberBase} from "./ConvoySubscriberBase.sol";

/// @title EscrowSubscriber
/// @notice Demo dApp #2: CTC escrow on Creditcoin released by a proved Ethereum acceptance receipt.
/// @dev Unrelated to the passport in every way except one: its events land in the same Sepolia
///      blocks, which is the only thing batching actually requires.
contract EscrowSubscriber is ConvoySubscriberBase {
    /// keccak256("DeliveryAccepted(bytes32,address,uint256)")
    bytes32 public constant DELIVERY_TOPIC = 0x9ae8cefce9639618f668b2e2ba8529363833629b8056db557ea68972ae2abc7d;

    struct Order {
        address payer;
        address payee;
        uint128 amount;
        bool funded;
        bool released;
    }

    mapping(bytes32 => Order) public orders;

    event OrderFunded(bytes32 indexed orderId, address indexed payee, uint128 amount);
    event OrderReleased(bytes32 indexed orderId, address indexed payee, uint128 amount, bytes32 factId);

    error AlreadyFunded();
    error TransferFailed();

    constructor(address router) ConvoySubscriberBase(router) {}

    function fund(bytes32 orderId, address payee) external payable {
        Order storage o = orders[orderId];
        if (o.funded) revert AlreadyFunded();
        o.payer = msg.sender;
        o.payee = payee;
        o.amount = uint128(msg.value);
        o.funded = true;
        emit OrderFunded(orderId, payee, o.amount);
    }

    function _handle(ConvoyTypes.Fact calldata fact) internal override {
        // topics: [sig, orderId, buyer] — data: (uint256 amount)
        if (fact.topics.length < 3) return;

        bytes32 orderId = fact.topics[1];
        Order storage o = orders[orderId];
        if (!o.funded || o.released) return;

        o.released = true;
        uint128 amount = o.amount;
        emit OrderReleased(orderId, o.payee, amount, fact.factId);

        (bool ok,) = o.payee.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
