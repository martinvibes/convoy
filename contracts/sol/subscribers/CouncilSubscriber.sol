// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ConvoyTypes} from "../ConvoyTypes.sol";
import {ConvoySubscriberBase} from "./ConvoySubscriberBase.sol";

interface IConvoyRouterView {
    function wasAcceptedBy(bytes32 factId, address subscriber) external view returns (bool);
}

/// @title CouncilSubscriber
/// @notice Demo dApp #3: an autonomous treasury whose agents may only reason over facts that
///         arrived through Convoy, and may only move money with a quorum over one of those facts.
///
/// @dev The design rule is the familiar one — agents are untrusted components inside a
///      cryptographic harness, only attested facts may enter, only a quorum over an attested fact
///      may authorise execution. What changes here is where the harness sits.
///
///      A council that runs its own ingest is only as honest as whoever operates that ingest: the
///      same party runs the agents and the proof pipeline, so "the agent only saw attested facts"
///      rests on the operator's word about what it fed in. Convoy splits the two. Facts reach this
///      contract from a bonded third-party relayer through a router this contract does not control,
///      and the very same fact is delivered in the same Creditcoin transaction to unrelated
///      subscribers on the same route. To feed this council something the world did not see, an
///      operator would have to defeat the precompile, which is not possible, or suppress delivery
///      to every co-subscriber on that route, which is a public event.
///
///      {propose} enforces the boundary literally: a proposal must cite a factId that
///      {ConvoyRouter.wasAcceptedBy} confirms this contract accepted. A proposal over an
///      unattested fact is not rejected at vote time. It cannot be constructed.
contract CouncilSubscriber is ConvoySubscriberBase {
    /// keccak256("TreasurySignal(bytes32,uint8,int256)")
    bytes32 public constant SIGNAL_TOPIC = 0x3cef1de2f52f3aa3b4c83598c9eb791c9ade7404ae4add0371262aa287d1ec28;

    uint16 public constant LOCK_BPS = 6500; // execute immediately
    uint16 public constant OVERRIDE_BPS = 5000; // execute after timelock
    uint64 public constant OVERRIDE_DELAY = 6 hours;

    enum Status {
        None,
        Open,
        Locked,
        Timelocked,
        Advisory,
        Executed
    }

    struct FactRecord {
        bool seen;
        uint64 blockHeight;
        uint8 kind;
        int256 value;
    }

    struct Proposal {
        bytes32 factId;
        address to;
        uint128 amount;
        uint64 executableAt;
        uint32 supportWeight;
        uint32 againstWeight;
        Status status;
        string rationale;
    }

    address public immutable CHAIR;
    mapping(address => uint32) public weightOf;
    uint32 public totalWeight;

    mapping(bytes32 => FactRecord) public facts;
    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event SignalIngested(bytes32 indexed factId, uint8 kind, int256 value, uint64 blockHeight);
    event Proposed(uint256 indexed id, bytes32 indexed factId, address to, uint128 amount);
    event Voted(uint256 indexed id, address indexed member, bool support, uint32 weight);
    event Finalized(uint256 indexed id, Status status, uint16 agreementBps, uint64 executableAt);
    event Executed(uint256 indexed id, address to, uint128 amount);

    error NotChair();
    error NotMember();
    error FactNotAttested();
    error AlreadyVoted();
    error NotOpen();
    error NotExecutable();
    error TooEarly();
    error TransferFailed();

    constructor(address router, address chair) ConvoySubscriberBase(router) {
        CHAIR = chair == address(0) ? msg.sender : chair;
    }

    receive() external payable {}

    function setMember(address member, uint32 weight) external {
        if (msg.sender != CHAIR) revert NotChair();
        totalWeight = totalWeight - weightOf[member] + weight;
        weightOf[member] = weight;
    }

    /// @dev Ingest. This is the only door into the council, and the router is the only key.
    function _handle(ConvoyTypes.Fact calldata fact) internal override {
        // topics: [sig, signalId] — data: (uint8 kind, int256 value)
        if (fact.topics.length < 2) return;
        (uint8 kind, int256 value) = abi.decode(fact.data, (uint8, int256));

        facts[fact.factId] = FactRecord({seen: true, blockHeight: fact.blockHeight, kind: kind, value: value});

        emit SignalIngested(fact.factId, kind, value, fact.blockHeight);
    }

    /// @notice Open a proposal over one attested fact.
    /// @dev Two independent checks, on purpose. `facts[].seen` is this contract's own record of
    ///      having handled the fact; `wasAcceptedBy` is the router's record of having delivered it.
    ///      Either alone could be faked by a bug in one contract. Both together cannot be faked by
    ///      a bug in either.
    function propose(bytes32 factId, address to, uint128 amount, string calldata rationale)
        external
        returns (uint256 id)
    {
        if (weightOf[msg.sender] == 0) revert NotMember();
        if (!facts[factId].seen) revert FactNotAttested();
        if (!IConvoyRouterView(ROUTER).wasAcceptedBy(factId, address(this))) revert FactNotAttested();

        id = _proposals.length;
        _proposals.push(
            Proposal({
                factId: factId,
                to: to,
                amount: amount,
                executableAt: 0,
                supportWeight: 0,
                againstWeight: 0,
                status: Status.Open,
                rationale: rationale
            })
        );
        emit Proposed(id, factId, to, amount);
    }

    function vote(uint256 id, bool support) external {
        uint32 w = weightOf[msg.sender];
        if (w == 0) revert NotMember();
        Proposal storage p = _proposals[id];
        if (p.status != Status.Open) revert NotOpen();
        if (hasVoted[id][msg.sender]) revert AlreadyVoted();

        hasVoted[id][msg.sender] = true;
        if (support) p.supportWeight += w;
        else p.againstWeight += w;

        emit Voted(id, msg.sender, support, w);
    }

    /// @notice Close voting and place the proposal in a band.
    function finalize(uint256 id) external returns (Status) {
        Proposal storage p = _proposals[id];
        if (p.status != Status.Open) revert NotOpen();

        uint16 agreement = totalWeight == 0 ? 0 : uint16((uint256(p.supportWeight) * 10_000) / totalWeight);

        if (agreement >= LOCK_BPS) {
            p.status = Status.Locked;
            p.executableAt = uint64(block.timestamp);
        } else if (agreement >= OVERRIDE_BPS) {
            p.status = Status.Timelocked;
            p.executableAt = uint64(block.timestamp) + OVERRIDE_DELAY;
        } else {
            p.status = Status.Advisory;
        }

        emit Finalized(id, p.status, agreement, p.executableAt);
        return p.status;
    }

    function execute(uint256 id) external {
        Proposal storage p = _proposals[id];
        if (p.status != Status.Locked && p.status != Status.Timelocked) revert NotExecutable();
        if (block.timestamp < p.executableAt) revert TooEarly();

        p.status = Status.Executed;
        emit Executed(id, p.to, p.amount);

        (bool ok,) = p.to.call{value: p.amount}("");
        if (!ok) revert TransferFailed();
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return _proposals[id];
    }
}
