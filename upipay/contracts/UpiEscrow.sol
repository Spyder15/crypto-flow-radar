// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Payer locks USDC; an LP pays the merchant in fiat off-chain; an attestor signs
/// proof of that payout and the LP is released the USDC. No proof in time => payer refunded.
contract UpiEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Accepted, Released, Refunded, Proven, Disputed }

    struct Order {
        address payer;
        address lp;
        uint256 amount;       // USDC units (6 decimals)
        uint256 inrPaise;     // fiat amount the merchant must receive
        bytes32 upiHash;      // keccak256 of the merchant UPI id; the id itself stays off-chain
        uint64 acceptedAt;
        Status status;
        uint64 provenAt;
        bytes32 utrHash;
        uint256 lockedStake;  // LP collateral locked while this order is in flight
    }

    IERC20 public immutable usdc;
    address public immutable attestor;
    address public immutable arbiter;     // resolves disputes
    uint64 public immutable payWindow;     // seconds an LP has to pay after accepting
    uint64 public immutable disputeWindow; // seconds the payer can dispute after proof
    uint256 public immutable stakeBps;     // collateral an LP must lock per order, in basis points of the order amount

    mapping(address => uint256) public stake; // free (unlocked) LP collateral

    uint256 public nextId = 1;
    mapping(uint256 => Order) public orders;

    event OrderCreated(uint256 indexed id, address indexed payer, uint256 amount, uint256 inrPaise, bytes32 upiHash);
    event OrderAccepted(uint256 indexed id, address indexed lp);
    event OrderReleased(uint256 indexed id, address indexed lp, bytes32 utrHash);
    event OrderProven(uint256 indexed id, bytes32 utrHash);
    event OrderDisputed(uint256 indexed id);
    event OrderRefunded(uint256 indexed id);
    event StakeChanged(address indexed lp, uint256 free);
    event Slashed(uint256 indexed id, address indexed lp, uint256 amount);

    error BadState();
    error NotAuthorized();
    error BadProof();
    error TooEarly();
    error InsufficientStake();

    constructor(IERC20 _usdc, address _attestor, address _arbiter, uint64 _payWindow, uint64 _disputeWindow, uint256 _stakeBps) {
        usdc = _usdc;
        attestor = _attestor;
        arbiter = _arbiter;
        payWindow = _payWindow;
        disputeWindow = _disputeWindow;
        stakeBps = _stakeBps;
    }

    function depositStake(uint256 amount) external nonReentrant {
        stake[msg.sender] += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit StakeChanged(msg.sender, stake[msg.sender]);
    }

    function withdrawStake(uint256 amount) external nonReentrant {
        if (stake[msg.sender] < amount) revert InsufficientStake();
        stake[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit StakeChanged(msg.sender, stake[msg.sender]);
    }

    function createOrder(uint256 amount, uint256 inrPaise, bytes32 upiHash) external nonReentrant returns (uint256 id) {
        require(amount > 0 && inrPaise > 0, "zero");
        id = nextId++;
        orders[id] = Order(msg.sender, address(0), amount, inrPaise, upiHash, 0, Status.Open, 0, bytes32(0), 0);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit OrderCreated(id, msg.sender, amount, inrPaise, upiHash);
    }

    function acceptOrder(uint256 id) external {
        Order storage o = orders[id];
        if (o.status != Status.Open) revert BadState();
        uint256 lock = (o.amount * stakeBps) / 10_000;
        if (stake[msg.sender] < lock) revert InsufficientStake();
        stake[msg.sender] -= lock;
        o.lockedStake = lock;
        o.lp = msg.sender;
        o.acceptedAt = uint64(block.timestamp);
        o.status = Status.Accepted;
        emit OrderAccepted(id, msg.sender);
    }

    /// Attestor signs (chainid, escrow, id, lp, inrPaise, utrHash) once the fiat payout is verified.
    /// Funds are not paid yet: the payer gets a dispute window first.
    function submitProof(uint256 id, bytes32 utrHash, bytes calldata sig) external {
        Order storage o = orders[id];
        if (o.status != Status.Accepted) revert BadState();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(this), id, o.lp, o.inrPaise, utrHash))
        );
        if (ECDSA.recover(digest, sig) != attestor) revert BadProof();
        o.status = Status.Proven;
        o.provenAt = uint64(block.timestamp);
        o.utrHash = utrHash;
        emit OrderProven(id, utrHash);
    }

    /// Payer confirms the merchant got the money: pay the LP immediately.
    function confirm(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (msg.sender != o.payer) revert NotAuthorized();
        if (o.status != Status.Proven) revert BadState();
        _payLp(id, o);
    }

    /// Anyone can finalize once the dispute window has passed without a dispute.
    function claim(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.status != Status.Proven) revert BadState();
        if (block.timestamp < o.provenAt + disputeWindow) revert TooEarly();
        _payLp(id, o);
    }

    function dispute(uint256 id) external {
        Order storage o = orders[id];
        if (msg.sender != o.payer) revert NotAuthorized();
        if (o.status != Status.Proven) revert BadState();
        if (block.timestamp >= o.provenAt + disputeWindow) revert TooEarly();
        o.status = Status.Disputed;
        emit OrderDisputed(id);
    }

    function resolve(uint256 id, bool payLp) external nonReentrant {
        if (msg.sender != arbiter) revert NotAuthorized();
        Order storage o = orders[id];
        if (o.status != Status.Disputed) revert BadState();
        if (payLp) _payLp(id, o);
        else {
            o.status = Status.Refunded;
            _slash(id, o);
            usdc.safeTransfer(o.payer, o.amount);
            emit OrderRefunded(id);
        }
    }

    /// A failed LP forfeits its collateral to the payer as compensation.
    function _slash(uint256 id, Order storage o) private {
        uint256 cut = o.lockedStake;
        if (cut == 0) return;
        o.lockedStake = 0;
        usdc.safeTransfer(o.payer, cut);
        emit Slashed(id, o.lp, cut);
    }

    function _payLp(uint256 id, Order storage o) private {
        o.status = Status.Released;
        stake[o.lp] += o.lockedStake;
        o.lockedStake = 0;
        usdc.safeTransfer(o.lp, o.amount);
        emit OrderReleased(id, o.lp, o.utrHash);
    }

    /// Payer can cancel an unaccepted order any time, or reclaim once the LP missed the pay window.
    function refund(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (msg.sender != o.payer) revert NotAuthorized();
        if (o.status == Status.Accepted) {
            if (block.timestamp < o.acceptedAt + payWindow) revert TooEarly();
        } else if (o.status != Status.Open) {
            revert BadState();
        }
        o.status = Status.Refunded;
        _slash(id, o);
        usdc.safeTransfer(o.payer, o.amount);
        emit OrderRefunded(id);
    }
}
