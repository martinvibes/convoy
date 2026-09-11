// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ConvoyTypes} from "../ConvoyTypes.sol";
import {IConvoySubscriber} from "../IConvoySubscriber.sol";

/// @title ConvoySubscriberBase
/// @notice Minimal base for a dApp consuming Convoy facts.
/// @dev The only trust assumption a subscriber makes is the router address. Everything else —
///      inclusion proof, continuity proof, receipt status, replay — is already settled upstream by
///      the time {onAttestedFact} runs. Subscribers hold no oracle logic of their own, which is the
///      point: there is one place to audit instead of one per dApp.
abstract contract ConvoySubscriberBase is IConvoySubscriber {
    address public immutable ROUTER;

    error OnlyRouter();

    constructor(address router) {
        ROUTER = router;
    }

    modifier onlyRouter() {
        if (msg.sender != ROUTER) revert OnlyRouter();
        _;
    }

    function onAttestedFact(ConvoyTypes.Fact calldata fact) external onlyRouter {
        _handle(fact);
    }

    function _handle(ConvoyTypes.Fact calldata fact) internal virtual;
}
