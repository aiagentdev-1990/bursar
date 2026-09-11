// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IRoster — allowance enforcement for a roster of AI agents
/// @notice The single enforcement point for every spend limit in the system.
///         See docs/TECH-DESIGN.md §4 and §5. Do not add functions that aren't in §5.
///
///         One Roster is one owner's team. Rosters are deployed as minimal-proxy clones by
///         RosterFactory, so a Roster is initialized rather than constructed.
interface IRoster {
    // ─── types ────────────────────────────────────────────────────────────────

    struct AgentInfo {
        uint256 perTxCap; // max USDC (6dp base units) per single spend
        uint256 perPeriodCap; // max USDC cumulative within one period
        uint256 periodSpend; // spent so far in the current period
        uint256 periodStart; // unix ts the current period began
        string role; // dashboard label only — no enforcement depends on it
        bool registered; // true after hireAgent; never cleared, so a revoked agent
        // is still distinguishable from one that never existed
        bool active; // false after revokeAgent; all executeSpend calls revert
    }

    struct PendingRequest {
        address agent;
        address payee;
        uint256 amount;
        bytes memo;
        bool open;
    }

    // ─── events (the dashboard reads these via Blockscout, §4.5) ──────────────

    event RosterInitialized(address indexed owner);
    event AgentRegistered(address indexed agent, uint256 perTxCap, uint256 perPeriodCap, string role);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event SpendExecuted(address indexed agent, address indexed payee, uint256 amount, bytes memo);
    event PaymentPending(
        uint256 indexed requestId, address indexed agent, address indexed payee, uint256 amount, bytes memo
    );
    event PendingApproved(uint256 indexed requestId, address indexed agent, uint256 amount);
    event PendingRejected(uint256 indexed requestId, address indexed agent);
    event CapsUpdated(address indexed agent, uint256 newPerTxCap, uint256 newPerPeriodCap);
    event AgentRevoked(address indexed agent);

    // ─── errors ───────────────────────────────────────────────────────────────

    error NotOwner();
    error NotAgent();
    error AgentNotActive();
    error AgentAlreadyRegistered();
    error UnknownAgent();
    error RequestNotOpen();
    error AlreadyInitialized();
    error ZeroAddress();
    error ZeroCap();
    /// @notice The Roster holds less USDC than this spend, approval or withdrawal needs. Caps say
    ///         how much an agent may spend; the balance says how much there is to spend.
    error InsufficientBalance();
    /// @notice executeSpendFor: the agent's signed deadline has passed.
    error SignatureExpired();
    /// @notice executeSpendFor: the signature is malformed, already used, for another Roster, or
    ///         not the agent's.
    error InvalidSignature();

    // ─── lifecycle ────────────────────────────────────────────────────────────

    /// @notice Called once by RosterFactory immediately after the clone is deployed. Replaces a
    ///         constructor, which a minimal proxy cannot run.
    function initialize(address owner) external;

    // ─── owner actions ────────────────────────────────────────────────────────

    /// @notice §4.1 — register an agent's wallet, both caps, and its role label.
    function hireAgent(address agent, uint256 perTxCap, uint256 perPeriodCap, string calldata role) external;

    /// @notice Moves USDC out of the Roster. There is no deposit function: §4.6's funding is any
    ///         USDC transfer to this address, and every agent spends from that one balance.
    function withdrawTreasury(address to, uint256 amount) external;

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
    ///         passed, then checks both caps. In cap: transfers to the agent's wallet from the
    ///         Roster's balance, returns (true, 0), or reverts `InsufficientBalance` if the balance
    ///         is short. Over cap: opens a pending request, moves nothing, returns (false, requestId).
    function executeSpend(uint256 amount, address payee, bytes calldata memo)
        external
        returns (bool executed, uint256 requestId);

    /// @notice `executeSpend`, signed by the agent and submitted by anyone — so the agent needs no
    ///         gas, and therefore holds no USDC. Same caps, same pending path, same events; the
    ///         funds still go to the agent's own wallet, never to the caller.
    ///
    ///         The agent signs EIP-712 `Spend(agent, amount, payee, memo, nonce, deadline)` under
    ///         domain `{name: "Roster", version: "1", chainId, verifyingContract: this Roster}`,
    ///         with `nonce = nonces(agent)`. Each signature works once, on one Roster, until
    ///         `deadline`, and never after the agent is revoked.
    function executeSpendFor(
        address agent,
        uint256 amount,
        address payee,
        bytes calldata memo,
        uint256 deadline,
        bytes calldata signature
    ) external returns (bool executed, uint256 requestId);

    // ─── views ────────────────────────────────────────────────────────────────

    function owner() external view returns (address);
    /// @notice Fixed for every agent on every Roster. See DECISIONS.md 2026-09-09.
    function PERIOD_LENGTH() external view returns (uint256);
    /// @notice Caps, role, active status, current period spend.
    /// @dev Reports the period the contract would enforce *right now*: if the boundary has
    ///      passed since the agent last spent, `periodSpend` reads zero and `periodStart` reads
    ///      the rolled value, exactly as the next `executeSpend` would set them.
    function getAgent(address agent) external view returns (AgentInfo memory);
    function getPendingRequest(uint256 requestId) external view returns (PendingRequest memory);
    /// @notice The nonce the agent's next `executeSpendFor` signature must carry. Direct
    ///         `executeSpend` calls do not consume it.
    function nonces(address agent) external view returns (uint256);
}
