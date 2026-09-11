// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ConvoyTypes} from "./ConvoyTypes.sol";

/// @title SubscriptionRegistry
/// @notice Demand side of Convoy: dApps register the source-chain events they want delivered and
///         prepay CTC for delivery.
/// @dev Money is held here, never in the router. Relayers are paid with a pull pattern: the router
///      credits `owed` during delivery and the relayer calls {claim} later. That keeps the delivery
///      path free of external CTC transfers, so one hostile payee cannot grief a whole convoy.
contract SubscriptionRegistry {
    struct Subscription {
        address owner; // may fund, pause, and withdraw
        address callback; // contract implementing IConvoySubscriber
        uint64 chainKey;
        address emitter; // source-chain contract to listen to
        bytes32 topic0; // event signature to listen for
        uint96 feePerDelivery; // CTC paid to the relayer per delivered fact
        uint96 balance; // prepaid CTC
        uint32 callbackGasLimit; // gas stipend for onAttestedFact
        bool active;
    }

    address public immutable ROUTER_ADMIN;
    address public router;

    mapping(bytes32 => Subscription) private _subs;
    mapping(bytes32 => bytes32[]) private _route; // routeKey => subscription ids
    mapping(address => uint256) public owed; // relayer => claimable CTC

    uint32 public constant MIN_CALLBACK_GAS = 30_000;
    uint32 public constant MAX_CALLBACK_GAS = 2_000_000;

    event Subscribed(
        bytes32 indexed subId, bytes32 indexed routeKey, address indexed owner, address callback, uint96 feePerDelivery
    );
    event Deposited(bytes32 indexed subId, uint96 amount, uint96 newBalance);
    event Withdrawn(bytes32 indexed subId, uint96 amount, uint96 newBalance);
    event ActiveSet(bytes32 indexed subId, bool active);
    event FeeSet(bytes32 indexed subId, uint96 feePerDelivery);
    event Charged(bytes32 indexed subId, address indexed relayer, uint96 fee, uint96 newBalance);
    event Claimed(address indexed relayer, uint256 amount);
    event RouterSet(address indexed router);

    error NotOwner();
    error NotRouter();
    error NotAdmin();
    error BadCallback();
    error BadGasLimit();
    error AlreadySubscribed();
    error UnknownSubscription();
    error InsufficientBalance();
    error TransferFailed();
    error RouterAlreadySet();

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    constructor(address admin) {
        ROUTER_ADMIN = admin == address(0) ? msg.sender : admin;
    }

    /// @notice Wire the registry to its router. One-shot, so subscribers can audit the binding.
    function setRouter(address router_) external {
        if (msg.sender != ROUTER_ADMIN) revert NotAdmin();
        if (router != address(0)) revert RouterAlreadySet();
        if (router_ == address(0)) revert BadCallback();
        router = router_;
        emit RouterSet(router_);
    }

    function subscriptionId(address owner, address callback, uint64 chainKey, address emitter, bytes32 topic0)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(owner, callback, chainKey, emitter, topic0));
    }

    /// @notice Register interest in one (chain, emitter, event) route and prepay for deliveries.
    function subscribe(
        address callback,
        uint64 chainKey,
        address emitter,
        bytes32 topic0,
        uint96 feePerDelivery,
        uint32 callbackGasLimit
    ) external payable returns (bytes32 subId) {
        if (callback == address(0) || emitter == address(0)) revert BadCallback();
        if (callbackGasLimit < MIN_CALLBACK_GAS || callbackGasLimit > MAX_CALLBACK_GAS) revert BadGasLimit();

        subId = subscriptionId(msg.sender, callback, chainKey, emitter, topic0);
        if (_subs[subId].callback != address(0)) revert AlreadySubscribed();

        _subs[subId] = Subscription({
            owner: msg.sender,
            callback: callback,
            chainKey: chainKey,
            emitter: emitter,
            topic0: topic0,
            feePerDelivery: feePerDelivery,
            balance: uint96(msg.value),
            callbackGasLimit: callbackGasLimit,
            active: true
        });

        bytes32 rKey = ConvoyTypes.routeKey(chainKey, emitter, topic0);
        _route[rKey].push(subId);

        emit Subscribed(subId, rKey, msg.sender, callback, feePerDelivery);
    }

    function deposit(bytes32 subId) external payable {
        Subscription storage s = _subs[subId];
        if (s.callback == address(0)) revert UnknownSubscription();
        s.balance += uint96(msg.value);
        emit Deposited(subId, uint96(msg.value), s.balance);
    }

    function withdraw(bytes32 subId, uint96 amount) external {
        Subscription storage s = _subs[subId];
        if (s.owner != msg.sender) revert NotOwner();
        if (s.balance < amount) revert InsufficientBalance();
        s.balance -= amount;
        emit Withdrawn(subId, amount, s.balance);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function setActive(bytes32 subId, bool active) external {
        Subscription storage s = _subs[subId];
        if (s.owner != msg.sender) revert NotOwner();
        s.active = active;
        emit ActiveSet(subId, active);
    }

    function setFee(bytes32 subId, uint96 feePerDelivery) external {
        Subscription storage s = _subs[subId];
        if (s.owner != msg.sender) revert NotOwner();
        s.feePerDelivery = feePerDelivery;
        emit FeeSet(subId, feePerDelivery);
    }

    /// @notice Debit a subscription for one delivery and credit the relayer.
    /// @dev Called by the router mid-batch. Returns false instead of reverting when the subscription
    ///      cannot pay, so an underfunded dApp is simply skipped rather than reverting the convoy.
    function chargeFor(bytes32 subId, address relayer) external onlyRouter returns (bool) {
        Subscription storage s = _subs[subId];
        uint96 fee = s.feePerDelivery;
        if (s.balance < fee) return false;
        unchecked {
            s.balance -= fee;
        }
        if (fee > 0) {
            owed[relayer] += fee;
            emit Charged(subId, relayer, fee, s.balance);
        }
        return true;
    }

    function claim() external {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert InsufficientBalance();
        owed[msg.sender] = 0;
        emit Claimed(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function subscriptionsFor(bytes32 rKey) external view returns (bytes32[] memory) {
        return _route[rKey];
    }

    function routeLength(bytes32 rKey) external view returns (uint256) {
        return _route[rKey].length;
    }

    function get(bytes32 subId) external view returns (Subscription memory) {
        return _subs[subId];
    }
}
