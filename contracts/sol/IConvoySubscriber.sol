// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ConvoyTypes} from "./ConvoyTypes.sol";

/// @title IConvoySubscriber
/// @notice Implemented by any dApp that wants Convoy to push proven source-chain facts to it.
/// @dev Convoy calls {onAttestedFact} with a bounded gas stipend and swallows reverts, so a broken
///      subscriber can never stall the convoy for everyone else. Implementations MUST reject any
///      caller other than the router they trust.
interface IConvoySubscriber {
    function onAttestedFact(ConvoyTypes.Fact calldata fact) external;
}
