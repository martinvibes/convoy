// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title RelayerBond
/// @notice Supply side of Convoy: anyone may relay, but only against a slashable CTC bond.
/// @dev Relaying is permissionless because a relayer cannot forge a proof — the precompile settles
///      that. The bond is not there to secure the data. It is there to price two things the proof
///      cannot rule out: censoring a paying subscriber, and spamming the router with batches that
///      deliver nothing. Withdrawals pass through a cooldown so a misbehaving relayer cannot exit
///      ahead of a slash.
contract RelayerBond {
    struct Bond {
        uint128 amount;
        uint64 unbondingAt; // 0 == not unbonding
        uint128 unbondingAmount;
    }

    address public immutable ARBITER;
    uint128 public immutable MIN_BOND;
    uint64 public constant UNBONDING_PERIOD = 3 days;

    mapping(address => Bond) public bonds;
    uint256 public slashPool;

    event Bonded(address indexed relayer, uint128 amount, uint128 total);
    event UnbondStarted(address indexed relayer, uint128 amount, uint64 availableAt);
    event Unbonded(address indexed relayer, uint128 amount);
    event Slashed(address indexed relayer, uint128 amount, string reason);

    error NotArbiter();
    error BelowMinimum();
    error NothingUnbonding();
    error StillCooling();
    error TransferFailed();
    error InsufficientBond();

    constructor(address arbiter, uint128 minBond) {
        ARBITER = arbiter == address(0) ? msg.sender : arbiter;
        MIN_BOND = minBond;
    }

    function isBonded(address relayer) public view returns (bool) {
        return bonds[relayer].amount >= MIN_BOND;
    }

    function bondUp() external payable {
        Bond storage b = bonds[msg.sender];
        b.amount += uint128(msg.value);
        if (b.amount < MIN_BOND) revert BelowMinimum();
        emit Bonded(msg.sender, uint128(msg.value), b.amount);
    }

    function startUnbond(uint128 amount) external {
        Bond storage b = bonds[msg.sender];
        if (b.amount < amount) revert InsufficientBond();
        b.amount -= amount;
        b.unbondingAmount += amount;
        b.unbondingAt = uint64(block.timestamp) + UNBONDING_PERIOD;
        emit UnbondStarted(msg.sender, amount, b.unbondingAt);
    }

    function finishUnbond() external {
        Bond storage b = bonds[msg.sender];
        if (b.unbondingAmount == 0) revert NothingUnbonding();
        if (block.timestamp < b.unbondingAt) revert StillCooling();
        uint128 amount = b.unbondingAmount;
        b.unbondingAmount = 0;
        b.unbondingAt = 0;
        emit Unbonded(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Slash a relayer's bond, including anything still cooling down.
    function slash(address relayer, uint128 amount, string calldata reason) external {
        if (msg.sender != ARBITER) revert NotArbiter();
        Bond storage b = bonds[relayer];
        uint128 take = amount;
        uint128 fromActive = b.amount >= take ? take : b.amount;
        b.amount -= fromActive;
        take -= fromActive;
        if (take > 0) {
            uint128 fromCooling = b.unbondingAmount >= take ? take : b.unbondingAmount;
            b.unbondingAmount -= fromCooling;
            take -= fromCooling;
        }
        uint128 slashed = amount - take;
        slashPool += slashed;
        emit Slashed(relayer, slashed, reason);
    }
}
