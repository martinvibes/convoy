// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ConvoyTypes} from "../ConvoyTypes.sol";
import {ConvoySubscriberBase} from "./ConvoySubscriberBase.sol";

/// @title PassportSubscriber
/// @notice Demo dApp #1: a portable credit passport fed by proved Ethereum repayments.
/// @dev Stands in for the most common shape in the Creditcoin ecosystem. Note what is NOT here:
///      no precompile call, no proof handling, no receipt-status check, no off-chain worker. This
///      contract is ~40 lines because Convoy already did that work, once, for every subscriber.
contract PassportSubscriber is ConvoySubscriberBase {
    /// keccak256("RepaymentMade(address,bytes32,uint256,bool)")
    bytes32 public constant REPAYMENT_TOPIC = 0x9d32b77467a95d9787e2862ce44bcd59deab91327a76e402fd9cad653690b3c0;

    struct Passport {
        uint32 repayments;
        uint32 onTimeRepayments;
        uint128 totalRepaid;
        uint16 score; // 0..1000
    }

    mapping(address => Passport) public passports;

    event PassportUpdated(address indexed borrower, uint16 score, uint32 repayments, bytes32 factId);

    constructor(address router) ConvoySubscriberBase(router) {}

    function _handle(ConvoyTypes.Fact calldata fact) internal override {
        // topics: [sig, borrower, loanId] — data: (uint256 amount, bool onTime)
        if (fact.topics.length < 3) return;

        address borrower = address(uint160(uint256(fact.topics[1])));
        (uint256 amount, bool onTime) = abi.decode(fact.data, (uint256, bool));

        Passport storage p = passports[borrower];
        p.repayments += 1;
        if (onTime) p.onTimeRepayments += 1;
        p.totalRepaid += uint128(amount);
        p.score = _score(p);

        emit PassportUpdated(borrower, p.score, p.repayments, fact.factId);
    }

    /// @dev Deliberately simple and fully on-chain: reputation that a lender cannot reproduce from
    ///      public inputs is not reputation, it is a rating agency.
    function _score(Passport storage p) private view returns (uint16) {
        if (p.repayments == 0) return 0;
        uint256 punctuality = (uint256(p.onTimeRepayments) * 700) / p.repayments;
        uint256 depth = p.repayments >= 30 ? 300 : (uint256(p.repayments) * 300) / 30;
        return uint16(punctuality + depth);
    }
}
