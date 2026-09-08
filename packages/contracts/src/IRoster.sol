// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRoster — allowance enforcement for a roster of AI agents
/// @notice The single enforcement point for every spend limit in the system.
///         See docs/TECH-DESIGN.md §4 and §5. Do not add functions that aren't in §5.
interface IRoster {
    // ─── types ────────────────────────────────────────────────────────────────

    struct AgentInfo {
        uint256 perTxCap;          // max USDC (6dp base units) per single spend
        uint256 perPeriodCap;      // max USDC cumulative within one period
        uint256 periodSpend;       // spent so far in the current period
        uint256 periodStart;       // unix ts the current period began
        uint256 periodLength;      // seconds; period resets lazily inside executeSpend
        uint256 earmarkedBalance;  // USDC held by the contract for this agent
        string  role;              // dashboard label only — no enforcement depends on it
        bool    active;            // false after revokeAgent; all executeSpend calls revert
    }

    struct PendingRequest {
        address agent;
        address payee;
        uint256 amount;
        bytes   memo;
        bool    open;
    }

    // ─── events (the dashboard reads these via Blockscout, §4.5) ──────────────

    event AgentRegistered(address indexed agent, uint256 perTxCap, uint256 perPeriodCap, string role);
    event AllowanceFunded(address indexed agent, uint256 amount);
    event SpendExecuted(address indexed agent, address indexed payee, uint256 amount, bytes memo);
    event PaymentPending(uint256 indexed requestId, address indexed agent, address indexed payee, uint256 amount, bytes memo);
    event PendingApproved(uint256 indexed requestId, address indexed agent, uint256 amount);
    event PendingRejected(uint256 indexed requestId, address indexed agent);
    event CapsUpdated(address indexed agent, uint256 newPerTxCap, uint256 newPerPeriodCap);
    event AgentRevoked(address indexed agent);
    event FundsSwept(address indexed agent, uint256 amount);

    // ─── errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotAgent();
    error AgentNotActive();
    error AgentAlreadyRegistered();
    error UnknownAgent();
    error InsufficientEarmarkedBalance();
    error RequestNotOpen();

    // ─── owner actions ────────────────────────────────────────────────────────

    /// @notice §4.1 — register an agent's wallet, both caps, and its role label.
    function hireAgent(address agent, uint256 perTxCap, uint256 perPeriodCap, string calldata role) external;

    /// @notice §4.6 — deposit USDC into an agent's earmarked balance. Initial hire and payroll both call this.
    function fundAgent(address agent, uint256 amount) external;

    /// @notice §4.3 — release a held request's funds to the agent's wallet.
    function approvePending(uint256 requestId) external;

    /// @notice §4.3 — close a held request with no funds moved.
    function rejectPending(uint256 requestId) external;

    /// @notice §4.4 — kill switch. Touches ONLY this agent's record. Never loop over agents here.
    function revokeAgent(address agent) external;

    /// @notice R8's "reduce" half — adjust caps without a revoke/re-hire.
    function updateCaps(address agent, uint256 newPerTxCap, uint256 newPerPeriodCap) external;

    // ─── agent actions ────────────────────────────────────────────────────────

    /// @notice §4.2/§4.3 — the core call. Lazily resets the period counter if the boundary has
    ///         passed, then checks both caps. In cap: transfers to the agent's wallet, returns
    ///         (true, 0). Over cap: opens a pending request, moves nothing, returns (false, requestId).
    function executeSpend(uint256 amount, address payee, bytes calldata memo)
        external
        returns (bool executed, uint256 requestId);

    /// @notice §4.2/§4.4 — return USDC sitting in the agent's wallet to its earmarked balance,
    ///         restoring it against the period cap. Callable by the owner or by the agent itself.
    function sweepUnspent(address agent) external;

    // ─── views ────────────────────────────────────────────────────────────────

    function getAgent(address agent) external view returns (AgentInfo memory);
    function getPendingRequest(uint256 requestId) external view returns (PendingRequest memory);
}
