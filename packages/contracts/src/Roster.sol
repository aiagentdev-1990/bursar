// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRoster} from "./IRoster.sol";

/// @title Roster — the allowance contract
/// @notice One Roster is one owner's team of agents. It is the single enforcement point for
///         every spend limit in the system: no cap check anywhere else in the stack is load
///         bearing (CLAUDE.md, "Non-negotiables"). Deployed as a minimal-proxy clone by
///         RosterFactory, so it is initialized rather than constructed.
///
///         The contract is also the treasury. USDC arrives at this address (§4.6), the owner
///         earmarks it per agent with `fundAgent`, and `executeSpend` releases it to the agent's
///         own wallet at the point of use — never ahead of time — so the agent holds nothing
///         standing. See DECISIONS.md 2026-09-08.
contract Roster is IRoster {
    using SafeERC20 for IERC20;

    /// @inheritdoc IRoster
    /// @dev Fixed rather than per-agent: the dashboard says "Monthly cap" and "September cap"
    ///      throughout, and the UI must not imply a boundary the contract isn't enforcing.
    ///      DECISIONS.md 2026-09-09.
    uint256 public constant PERIOD_LENGTH = 30 days;

    /// @notice Arc's USDC predeploy (0x3600…0000) in production. Immutable lives in the
    ///         implementation's code, which every clone delegatecalls into, so all clones share
    ///         it correctly.
    IERC20 public immutable USDC;

    /// @inheritdoc IRoster
    address public owner;

    /// @inheritdoc IRoster
    /// @dev The sum of every agent's earmarkedBalance. Guards against earmarking the same USDC
    ///      to two agents, which would let the second spend fail at transfer time instead of at
    ///      the point the owner made the mistake.
    uint256 public totalEarmarked;

    uint256 public nextRequestId;

    /// @dev One struct per agent address. Isolation (§4.4) is a property of this layout — no
    ///      function in this contract iterates it, and none may be added that does.
    mapping(address => AgentInfo) private _agents;
    mapping(uint256 => PendingRequest) private _requests;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Agent identity is a plain address: msg.sender must be the registered wallet. ERC-8004
    ///      was evaluated and deliberately not integrated — see DECISIONS.md 2026-09-11.
    modifier onlyAgent() {
        AgentInfo storage agent = _agents[msg.sender];
        if (!agent.registered) revert NotAgent();
        if (!agent.active) revert AgentNotActive();
        _;
    }

    /// @dev Constructs the implementation only. Clones never run this, which is why `owner` is
    ///      set here to a non-zero sentinel: an implementation left initializable is an unowned
    ///      contract anyone can claim.
    constructor(address usdc) {
        if (usdc == address(0)) revert ZeroAddress();
        USDC = IERC20(usdc);
        owner = address(this);
    }

    // ─── lifecycle ────────────────────────────────────────────────────────────

    /// @inheritdoc IRoster
    function initialize(address owner_) external {
        if (owner != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit RosterInitialized(owner_);
    }

    // ─── owner actions ────────────────────────────────────────────────────────

    /// @inheritdoc IRoster
    function hireAgent(address agent, uint256 perTxCap, uint256 perPeriodCap, string calldata role) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        if (perTxCap == 0 || perPeriodCap == 0) revert ZeroCap();

        AgentInfo storage info = _agents[agent];
        if (info.registered) revert AgentAlreadyRegistered();

        info.perTxCap = perTxCap;
        info.perPeriodCap = perPeriodCap;
        info.periodStart = block.timestamp;
        info.role = role;
        info.registered = true;
        info.active = true;

        emit AgentRegistered(agent, perTxCap, perPeriodCap, role);
    }

    /// @inheritdoc IRoster
    function fundAgent(address agent, uint256 amount) external onlyOwner {
        AgentInfo storage info = _agents[agent];
        if (!info.registered) revert UnknownAgent();

        // Moves no tokens — the USDC is already here. This only allocates it, and only as far as
        // the balance actually stretches.
        uint256 earmarked = totalEarmarked + amount;
        if (USDC.balanceOf(address(this)) < earmarked) revert InsufficientTreasury();

        info.earmarkedBalance += amount;
        totalEarmarked = earmarked;

        emit AllowanceFunded(agent, amount);
    }

    /// @inheritdoc IRoster
    function defundAgent(address agent, uint256 amount) external onlyOwner {
        AgentInfo storage info = _agents[agent];
        if (!info.registered) revert UnknownAgent();
        if (info.earmarkedBalance < amount) revert InsufficientEarmarkedBalance();

        // Mirror of fundAgent: no tokens move, the allocation is just released back into the
        // unallocated pool. Deliberately allowed for a revoked agent — that is the case it
        // exists for.
        info.earmarkedBalance -= amount;
        totalEarmarked -= amount;

        emit AllowanceDefunded(agent, amount);
    }

    /// @inheritdoc IRoster
    function withdrawTreasury(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();

        // Only what no agent is entitled to. An agent's earmark is a promise this function
        // cannot break, which is what keeps `balance >= totalEarmarked` an invariant.
        uint256 unallocated = USDC.balanceOf(address(this)) - totalEarmarked;
        if (unallocated < amount) revert InsufficientTreasury();

        USDC.safeTransfer(to, amount);

        emit TreasuryWithdrawn(to, amount);
    }

    /// @inheritdoc IRoster
    function updateCaps(address agent, uint256 newPerTxCap, uint256 newPerPeriodCap) external onlyOwner {
        AgentInfo storage info = _agents[agent];
        if (!info.registered) revert UnknownAgent();
        if (newPerTxCap == 0 || newPerPeriodCap == 0) revert ZeroCap();

        info.perTxCap = newPerTxCap;
        info.perPeriodCap = newPerPeriodCap;

        emit CapsUpdated(agent, newPerTxCap, newPerPeriodCap);
    }

    /// @inheritdoc IRoster
    function revokeAgent(address agent) external onlyOwner {
        AgentInfo storage info = _agents[agent];
        if (!info.registered) revert UnknownAgent();

        // One field, one agent's struct. Nothing else is read or written.
        info.active = false;

        emit AgentRevoked(agent);
    }

    /// @inheritdoc IRoster
    function approvePending(uint256 requestId) external onlyOwner {
        PendingRequest storage request = _requests[requestId];
        if (!request.open) revert RequestNotOpen();

        AgentInfo storage info = _agents[request.agent];
        // Revocation has to beat an outstanding approval, or the kill switch has a hole in it.
        if (!info.active) revert AgentNotActive();

        request.open = false;

        // The approval is the override, so the caps are deliberately not re-checked here — that
        // is the whole point of the pending path. The spend still rolls the period and charges
        // the counter, so the cap keeps meaning something afterwards. This is what the pending
        // screen's "MONTHLY CAP AFTER" figure is showing.
        // Approval first, then the spend it caused — the activity feed is built by replaying
        // these logs in order, and the cause should not appear after its effect.
        emit PendingApproved(requestId, request.agent, request.amount);

        _rollPeriod(info);
        _release(info, request.agent, request.payee, request.amount, request.memo);
    }

    /// @inheritdoc IRoster
    function rejectPending(uint256 requestId) external onlyOwner {
        PendingRequest storage request = _requests[requestId];
        if (!request.open) revert RequestNotOpen();

        request.open = false;

        emit PendingRejected(requestId, request.agent);
    }

    // ─── agent actions ────────────────────────────────────────────────────────

    /// @inheritdoc IRoster
    function executeSpend(uint256 amount, address payee, bytes calldata memo)
        external
        onlyAgent
        returns (bool executed, uint256 requestId)
    {
        AgentInfo storage info = _agents[msg.sender];

        // Lazy reset: the boundary is computed here, on the agent's own call. There is no
        // maintenance function and nothing to keep alive between periods.
        _rollPeriod(info);

        // Both caps, inclusive at the boundary. Over either one holds; it is never dropped and
        // never forced through (R6).
        if (amount > info.perTxCap || info.periodSpend + amount > info.perPeriodCap) {
            requestId = ++nextRequestId;
            _requests[requestId] =
                PendingRequest({agent: msg.sender, payee: payee, amount: amount, memo: memo, open: true});

            emit PaymentPending(requestId, msg.sender, payee, amount, memo);
            return (false, requestId);
        }

        _release(info, msg.sender, payee, amount, memo);
        return (true, 0);
    }

    // ─── internals ────────────────────────────────────────────────────────────

    /// @dev The lazy reset as a pure computation, so there is exactly one implementation of it.
    ///      `_rollPeriod` writes the result; `getAgent` applies it to a memory copy. Two separate
    ///      implementations of period arithmetic — one that enforces and one that displays — is
    ///      precisely the disagreement this contract exists to prevent.
    ///
    ///      Advances by whole periods, so the cadence stays anchored to the hire date instead of
    ///      drifting to whenever the agent next happens to spend. An agent that goes quiet for
    ///      three months does not get a fresh period starting the moment it wakes up.
    function _rolled(uint256 periodStart, uint256 periodSpend) private view returns (uint256, uint256) {
        uint256 elapsed = block.timestamp - periodStart;
        if (elapsed < PERIOD_LENGTH) return (periodStart, periodSpend);

        unchecked {
            return (periodStart + (elapsed / PERIOD_LENGTH) * PERIOD_LENGTH, 0);
        }
    }

    function _rollPeriod(AgentInfo storage info) private {
        (uint256 periodStart, uint256 periodSpend) = _rolled(info.periodStart, info.periodSpend);
        if (periodStart == info.periodStart) return;

        info.periodStart = periodStart;
        info.periodSpend = periodSpend;
    }

    /// @dev The one place funds leave this contract. Charging the period and debiting the
    ///      earmark happen before the transfer, so a reentrant token cannot see stale state.
    function _release(AgentInfo storage info, address agent, address payee, uint256 amount, bytes memory memo) private {
        if (info.earmarkedBalance < amount) revert InsufficientEarmarkedBalance();

        info.periodSpend += amount;
        info.earmarkedBalance -= amount;
        totalEarmarked -= amount;

        // Released to the agent's own wallet, which signs the x402 payment itself (§4.2).
        USDC.safeTransfer(agent, amount);

        emit SpendExecuted(agent, payee, amount, memo);
    }

    // ─── views ────────────────────────────────────────────────────────────────

    /// @inheritdoc IRoster
    function getAgent(address agent) external view returns (AgentInfo memory info) {
        info = _agents[agent];
        if (!info.registered) return info;

        // Apply the same reset `executeSpend` would, so a caller sees the period the contract
        // will actually enforce rather than the one it last wrote. Without this, an agent that
        // crossed a boundary without spending reads as fully spent — the dashboard draws an
        // exhausted budget bar for an agent that can spend, and the pending screen's
        // "monthly cap after" figure is wrong by a whole period.
        (info.periodStart, info.periodSpend) = _rolled(info.periodStart, info.periodSpend);
    }

    /// @inheritdoc IRoster
    function getPendingRequest(uint256 requestId) external view returns (PendingRequest memory) {
        return _requests[requestId];
    }
}
