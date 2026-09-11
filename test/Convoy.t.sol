// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {INativeQueryVerifier} from
    "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";

import {ConvoyRouter} from "../contracts/sol/ConvoyRouter.sol";
import {SubscriptionRegistry} from "../contracts/sol/SubscriptionRegistry.sol";
import {RelayerBond} from "../contracts/sol/RelayerBond.sol";
import {ConvoyTypes} from "../contracts/sol/ConvoyTypes.sol";
import {PassportSubscriber} from "../contracts/sol/subscribers/PassportSubscriber.sol";
import {EscrowSubscriber} from "../contracts/sol/subscribers/EscrowSubscriber.sol";
import {CouncilSubscriber} from "../contracts/sol/subscribers/CouncilSubscriber.sol";

import {MockVerifier} from "./mocks/MockVerifier.sol";
import {TxFixture} from "./helpers/TxFixture.sol";

/// @notice A subscriber that always reverts, to prove one bad passenger cannot strand the convoy.
contract HostileSubscriber {
    function onAttestedFact(ConvoyTypes.Fact calldata) external pure {
        revert("hostile");
    }
}

contract ConvoyTest is Test {
    address constant PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    uint64 constant CHAIN_KEY = 1; // Ethereum Sepolia on CC3 testnet
    address constant EMITTER = address(0xE111111111111111111111111111111111111111);

    bytes32 constant REPAYMENT_TOPIC = keccak256("RepaymentMade(address,bytes32,uint256,bool)");
    bytes32 constant DELIVERY_TOPIC = keccak256("DeliveryAccepted(bytes32,address,uint256)");
    bytes32 constant SIGNAL_TOPIC = keccak256("TreasurySignal(bytes32,uint8,int256)");

    bytes32 constant FACT_DELIVERED = keccak256("FactDelivered(bytes32,bytes32,address,bool,uint64,uint64)");
    bytes32 constant QUERY_SKIPPED = keccak256("QuerySkipped(bytes32,uint8,uint64,uint64)");

    uint96 constant FEE = 0.001 ether;
    uint128 constant MIN_BOND = 1 ether;

    SubscriptionRegistry registry;
    RelayerBond bond;
    ConvoyRouter router;
    PassportSubscriber passport;
    EscrowSubscriber escrow;
    CouncilSubscriber council;

    bytes32 subPassport;
    bytes32 subEscrow;
    bytes32 subCouncil;

    address relayer = makeAddr("relayer");
    address borrower = makeAddr("borrower");
    address payee = makeAddr("payee");
    address agentA = makeAddr("agentA");
    address agentB = makeAddr("agentB");
    address agentC = makeAddr("agentC");

    function setUp() public {
        vm.etch(PRECOMPILE, address(new MockVerifier()).code);

        registry = new SubscriptionRegistry(address(this));
        bond = new RelayerBond(address(this), MIN_BOND);
        router = new ConvoyRouter(address(registry), address(bond));
        registry.setRouter(address(router));

        passport = new PassportSubscriber(address(router));
        escrow = new EscrowSubscriber(address(router));
        council = new CouncilSubscriber(address(router), address(this));

        subPassport = registry.subscribe{value: 1 ether}(
            address(passport), CHAIN_KEY, EMITTER, REPAYMENT_TOPIC, FEE, 300_000
        );
        subEscrow = registry.subscribe{value: 1 ether}(
            address(escrow), CHAIN_KEY, EMITTER, DELIVERY_TOPIC, FEE, 300_000
        );
        subCouncil = registry.subscribe{value: 1 ether}(
            address(council), CHAIN_KEY, EMITTER, SIGNAL_TOPIC, FEE, 300_000
        );

        vm.deal(relayer, 10 ether);
        vm.prank(relayer);
        bond.bondUp{value: MIN_BOND}();

        council.setMember(agentA, 40);
        council.setMember(agentB, 35);
        council.setMember(agentC, 25);
        vm.deal(address(council), 10 ether);
    }

    // --- fixtures ---

    function _merkle(uint16 txIndex) internal pure returns (INativeQueryVerifier.MerkleProof memory p) {
        INativeQueryVerifier.MerkleProofEntry[] memory sib = new INativeQueryVerifier.MerkleProofEntry[](3);
        for (uint256 i; i < 3; ++i) {
            sib[i] = INativeQueryVerifier.MerkleProofEntry({hash: keccak256(abi.encode(txIndex, i)), isLeft: i % 2 == 0});
        }
        p = INativeQueryVerifier.MerkleProof({root: bytes32(uint256(txIndex)), siblings: sib});
    }

    function _continuity(uint256 hashCount)
        internal
        pure
        returns (INativeQueryVerifier.ContinuityProof memory c)
    {
        bytes32[] memory roots = new bytes32[](hashCount);
        for (uint256 i; i < hashCount; ++i) {
            roots[i] = keccak256(abi.encode("root", i));
        }
        c = INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: keccak256("lower"), roots: roots});
    }

    function _repaymentTx(address who, bytes32 loanId, uint256 amount, bool onTime, uint8 status)
        internal
        pure
        returns (bytes memory)
    {
        return TxFixture.encode(
            2,
            status,
            TxFixture.logs1(
                EMITTER,
                TxFixture.topics3(REPAYMENT_TOPIC, bytes32(uint256(uint160(who))), loanId),
                abi.encode(amount, onTime)
            )
        );
    }

    function _deliveryTx(bytes32 orderId, address buyer, uint256 amount) internal pure returns (bytes memory) {
        return TxFixture.encode(
            2,
            1,
            TxFixture.logs1(
                EMITTER,
                TxFixture.topics3(DELIVERY_TOPIC, orderId, bytes32(uint256(uint160(buyer)))),
                abi.encode(amount)
            )
        );
    }

    function _signalTx(bytes32 signalId, uint8 kind, int256 value) internal pure returns (bytes memory) {
        return TxFixture.encode(
            2,
            1,
            TxFixture.logs1(
                EMITTER, TxFixture.topics2(SIGNAL_TOPIC, signalId), abi.encode(kind, value)
            )
        );
    }

    // --- tests ---

    /// One continuity proof carries three transactions belonging to three unrelated dApps.
    /// This is the whole thesis in one call.
    function test_oneConvoyServesThreeUnrelatedDapps() public {
        escrow.fund{value: 2 ether}(bytes32("order-1"), payee);

        uint64[] memory heights = new uint64[](3);
        heights[0] = 1000;
        heights[1] = 1005;
        heights[2] = 1010;

        bytes[] memory txs = new bytes[](3);
        txs[0] = _repaymentTx(borrower, bytes32("loan-1"), 500 ether, true, 1);
        txs[1] = _deliveryTx(bytes32("order-1"), payee, 2 ether);
        txs[2] = _signalTx(bytes32("sig-1"), 1, -250);

        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](3);
        proofs[0] = _merkle(1);
        proofs[1] = _merkle(2);
        proofs[2] = _merkle(3);

        uint256 payeeBefore = payee.balance;

        vm.prank(relayer);
        uint256 facts = router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(1000));

        assertEq(facts, 3, "three facts delivered under one continuity proof");

        (uint32 reps,, uint128 totalRepaid, uint16 score) = passport.passports(borrower);
        assertEq(reps, 1);
        assertEq(totalRepaid, 500 ether);
        assertGt(score, 0);

        assertEq(payee.balance - payeeBefore, 2 ether, "escrow released");

        (bool seen,, uint8 kind, int256 value) = council.facts(
            router.factId(router.queryId(CHAIN_KEY, 1010, 3), 0)
        );
        assertTrue(seen);
        assertEq(kind, 1);
        assertEq(value, -250);

        assertEq(router.totalContinuityHashes(), 1000, "one continuity proof, not three");
        assertEq(router.totalQueriesVerified(), 3);
    }

    /// Inclusion is not success. A reverted source transaction is provable and must never be
    /// delivered as fact.
    function test_failedSourceTransactionIsSkipped() public {
        uint64[] memory heights = new uint64[](1);
        heights[0] = 2000;
        bytes[] memory txs = new bytes[](1);
        txs[0] = _repaymentTx(borrower, bytes32("loan-x"), 999 ether, true, 0); // receipt status 0
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = _merkle(4);

        vm.prank(relayer);
        uint256 facts = router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));

        assertEq(facts, 0, "nothing delivered from a failed transaction");
        (uint32 reps,,,) = passport.passports(borrower);
        assertEq(reps, 0, "passport untouched");
    }

    /// Anyone auditing a delivery has to be able to get back to the Ethereum transaction it came
    /// from, and the router never sees a source transaction hash. The source height and index are
    /// the only way back, so both the delivery and the refusal have to carry them.
    function test_eventsCarryTheSourceLocation() public {
        uint64[] memory heights = new uint64[](2);
        heights[0] = 4100;
        heights[1] = 4101;
        bytes[] memory txs = new bytes[](2);
        txs[0] = _repaymentTx(borrower, bytes32("loan-here"), 7 ether, true, 1);
        txs[1] = _repaymentTx(borrower, bytes32("loan-gone"), 7 ether, true, 0); // reverted at source
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = _merkle(57);
        proofs[1] = _merkle(58);

        vm.recordLogs();
        vm.prank(relayer);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawFact;
        bool sawRefusal;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == FACT_DELIVERED) {
                (, uint64 h, uint64 ix) = abi.decode(logs[i].data, (bool, uint64, uint64));
                assertEq(h, 4100, "delivered fact reports its source height");
                assertEq(ix, 57, "delivered fact reports its source index");
                sawFact = true;
            } else if (logs[i].topics[0] == QUERY_SKIPPED) {
                (uint8 reason, uint64 h, uint64 ix) = abi.decode(logs[i].data, (uint8, uint64, uint64));
                assertEq(reason, 2, "refused because the source transaction failed");
                assertEq(h, 4101, "refusal reports its source height");
                assertEq(ix, 58, "refusal reports its source index");
                sawRefusal = true;
            }
        }
        assertTrue(sawFact, "a fact was delivered");
        assertTrue(sawRefusal, "a refusal was reported");
    }

    /// A duplicate costs its own slot and nothing else.
    function test_duplicateIsSkippedWithoutRevertingTheConvoy() public {
        uint64[] memory heights = new uint64[](2);
        heights[0] = 3000;
        heights[1] = 3000;
        bytes[] memory txs = new bytes[](2);
        txs[0] = _repaymentTx(borrower, bytes32("loan-d"), 100 ether, true, 1);
        txs[1] = txs[0];
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = _merkle(9);
        proofs[1] = _merkle(9); // same index => same queryId

        vm.prank(relayer);
        uint256 facts = router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));

        assertEq(facts, 1, "second copy skipped, first still delivered");
        (uint32 reps,,,) = passport.passports(borrower);
        assertEq(reps, 1);
    }

    /// A subscriber that reverts burns only its own slot.
    function test_hostileSubscriberDoesNotStallTheConvoy() public {
        HostileSubscriber hostile = new HostileSubscriber();
        registry.subscribe{value: 1 ether}(
            address(hostile), CHAIN_KEY, EMITTER, REPAYMENT_TOPIC, FEE, 300_000
        );

        uint64[] memory heights = new uint64[](1);
        heights[0] = 4000;
        bytes[] memory txs = new bytes[](1);
        txs[0] = _repaymentTx(borrower, bytes32("loan-h"), 42 ether, true, 1);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = _merkle(11);

        vm.prank(relayer);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));

        (uint32 reps,,,) = passport.passports(borrower);
        assertEq(reps, 1, "healthy subscriber still served");
    }

    function test_unbondedRelayerRejected() public {
        uint64[] memory heights = new uint64[](1);
        heights[0] = 5000;
        bytes[] memory txs = new bytes[](1);
        txs[0] = _repaymentTx(borrower, bytes32("l"), 1 ether, true, 1);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = _merkle(12);

        vm.expectRevert(ConvoyRouter.NotBonded.selector);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));
    }

    function test_batchRangeIsEnforced() public {
        uint64[] memory heights = new uint64[](2);
        heights[0] = 1;
        heights[1] = 1002; // > MAX_BATCH_RANGE apart
        bytes[] memory txs = new bytes[](2);
        txs[0] = _repaymentTx(borrower, bytes32("a"), 1 ether, true, 1);
        txs[1] = _repaymentTx(borrower, bytes32("b"), 1 ether, true, 1);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](2);
        proofs[0] = _merkle(20);
        proofs[1] = _merkle(21);

        vm.prank(relayer);
        vm.expectRevert(ConvoyRouter.BatchRangeExceeded.selector);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));
    }

    function test_batchSizeIsCapped() public {
        uint64[] memory heights = new uint64[](11);
        bytes[] memory txs = new bytes[](11);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](11);
        for (uint256 i; i < 11; ++i) {
            heights[i] = uint64(6000 + i);
            txs[i] = _repaymentTx(borrower, bytes32(i), 1 ether, true, 1);
            proofs[i] = _merkle(uint16(30 + i));
        }

        vm.prank(relayer);
        vm.expectRevert(ConvoyRouter.BatchTooLarge.selector);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));
    }

    // --- council ---

    function test_councilCannotProposeOverAFactItNeverReceived() public {
        vm.prank(agentA);
        vm.expectRevert(CouncilSubscriber.FactNotAttested.selector);
        council.propose(keccak256("invented"), payee, 1 ether, "trust me");
    }

    function test_councilExecutesOnQuorumOverAnAttestedFact() public {
        uint64[] memory heights = new uint64[](1);
        heights[0] = 7000;
        bytes[] memory txs = new bytes[](1);
        txs[0] = _signalTx(bytes32("sig-9"), 2, 1500);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = _merkle(40);

        vm.prank(relayer);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));

        bytes32 fId = router.factId(router.queryId(CHAIN_KEY, 7000, 40), 0);
        assertTrue(router.wasAcceptedBy(fId, address(council)));

        vm.prank(agentA);
        uint256 id = council.propose(fId, payee, 1 ether, "signal supports de-risking");

        vm.prank(agentA);
        council.vote(id, true);
        vm.prank(agentB);
        council.vote(id, true); // 75 of 100 weight => above LOCK_BPS

        CouncilSubscriber.Status status = council.finalize(id);
        assertEq(uint8(status), uint8(CouncilSubscriber.Status.Locked));

        uint256 before = payee.balance;
        council.execute(id);
        assertEq(payee.balance - before, 1 ether);
    }

    function test_councilBelowThresholdIsAdvisoryOnly() public {
        uint64[] memory heights = new uint64[](1);
        heights[0] = 7100;
        bytes[] memory txs = new bytes[](1);
        txs[0] = _signalTx(bytes32("sig-10"), 2, -900);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = _merkle(41);

        vm.prank(relayer);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));

        bytes32 fId = router.factId(router.queryId(CHAIN_KEY, 7100, 41), 0);
        vm.prank(agentA);
        uint256 id = council.propose(fId, payee, 1 ether, "thin evidence");

        vm.prank(agentC);
        council.vote(id, true); // 25 of 100 => advisory

        council.finalize(id);
        vm.expectRevert(CouncilSubscriber.NotExecutable.selector);
        council.execute(id);
    }

    // --- economics ---

    function test_relayerIsPaidPerDeliveredFact() public {
        uint64[] memory heights = new uint64[](1);
        heights[0] = 8000;
        bytes[] memory txs = new bytes[](1);
        txs[0] = _repaymentTx(borrower, bytes32("l8"), 5 ether, true, 1);
        INativeQueryVerifier.MerkleProof[] memory proofs = new INativeQueryVerifier.MerkleProof[](1);
        proofs[0] = _merkle(50);

        vm.prank(relayer);
        router.deliver(CHAIN_KEY, heights, txs, proofs, _continuity(10));

        assertEq(registry.owed(relayer), FEE);

        uint256 before = relayer.balance;
        vm.prank(relayer);
        registry.claim();
        assertEq(relayer.balance - before, FEE);
    }
}
