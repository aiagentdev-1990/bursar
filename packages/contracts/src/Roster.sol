// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {IRoster} from "./IRoster.sol";

/// @title Roster — the allowance contract
/// @notice One Roster is one owner's team of agents. It is the single enforcement point for
///         every spend limit in the system: no cap check anywhere else in the stack is load
///         bearing (CLAUDE.md, "Non-negotiables"). Deployed as a minimal-proxy clone by
///         RosterFactory, so it is initialized rather than constructed.
///
///         The contract is also the treasury: one shared balance every agent spends from, like a
///         company account behind a set of expense cards. USDC arrives at this address (§4.6) and
///         `executeSpend` releases it to the agent's own wallet at the point of use — never ahead
///         of time — so the agent holds nothing standing. The caps are each agent's limit; the
///         balance is the one pool. See DECISIONS.md 2026-09-08 and 2026-09-11.
///
///         An agent can ask for a release two ways: `executeSpend`, sent from its own wallet, or
///         `executeSpendFor`, which it signs and anyone relays. The relayed path exists because
///         gas on Arc is USDC — a gas float in the agent's wallet is money it can spend without
///         asking this contract. With a relayer paying gas, the agent holds nothing at all.
///         Both paths run the same cap check. DECISIONS.md 2026-09-11.
contract Roster is IRoster, EIP712, Nonces {
    using SafeERC20 for IERC20;

    /// @inheritdoc IRoster
    /// @dev Fixed rather than per-agent: the dashboard says "Monthly cap" and "September cap"
    ///      throughout, and the UI must not imply a boundary the contract isn't enforcing.
    ///      DECISIONS.md 2026-09-09.
    uint256 public constant PERIOD_LENGTH = 30 days;

    /// @notice What an agent signs for `executeSpendFor`. `memo` is hashed, per EIP-712's rule
    ///         for dynamic `bytes`. The nonce is not a parameter of the call: the contract uses
    ///         the agent's current one, so a signature is good exactly once.
    bytes32 public constant SPEND_TYPEHASH =
        keccak256("Spend(address agent,uint256 amount,address payee,bytes memo,uint256 nonce,uint256 deadline)");

    /// @notice Arc's USDC predeploy (0x3600…0000) in production. Immutable lives in the
    ///         implementation's code, which every clone delegatecalls into, so all clones share
    ///         it correctly.
    IERC20 public immutable USDC;

    /// @inheritdoc IRoster
    address public owner;

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
        _activeAgent(msg.sender);
        _;
    }

    /// @dev Constructs the implementation only. Clones never run this, which is why `owner` is
    ///      set here to a non-zero sentinel: an implementation left initializable is an unowned
    ///      contract anyone can claim.
    ///
    ///      The EIP-712 name and version live in the implementation's immutables and are shared
    ///      by every clone. The domain separator is not: OpenZeppelin's EIP712 rebuilds it
    ///      whenever `address(this)` is not the address it was cached for, so each clone signs
    ///      under its own address. That is what stops a spend signed for one team being replayed
    ///      against another team the same agent happens to be on.
    constructor(address usdc) EIP712("Roster", "1") {
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
    /// @dev Unbounded by anything but the balance: no agent is owed a share of it. A cap is
    ///      permission to spend, not a claim on funds, so withdrawing everything simply means the
    ///      next in-cap spend reverts `InsufficientBalance` until the owner adds more.
    function withdrawTreasury(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (USDC.balanceOf(address(this)) < amount) revert InsufficientBalance();

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
        return _spend(_agents[msg.sender], msg.sender, amount, payee, memo);
    }

    /// @inheritdoc IRoster
    /// @dev Permissionless on `msg.sender` by design — the signature is the authorization, and a
    ///      relayer can only submit what the agent signed. Front-running a relayed spend changes
    ///      nothing but who paid the gas: the funds still go to the agent's own wallet.
    ///
    ///      Revocation is checked before the signature, so an intent signed before `revokeAgent`
    ///      is dead the moment the revoke lands. The kill switch has no pre-signed hole.
    function executeSpendFor(
        address agent,
        uint256 amount,
        address payee,
        bytes calldata memo,
        uint256 deadline,
        bytes calldata signature
    ) external returns (bool, uint256) {
        AgentInfo storage info = _activeAgent(agent);
        if (block.timestamp > deadline) revert SignatureExpired();

        _checkSignature(agent, _spendDigest(agent, amount, payee, memo, deadline), signature);

        return _spend(info, agent, amount, payee, memo);
    }

    // ─── internals ────────────────────────────────────────────────────────────

    /// @dev Consumes the agent's nonce. It increments before the signature is checked, but a bad
    ///      signature reverts the whole call, increment included, so it costs the agent nothing.
    function _spendDigest(address agent, uint256 amount, address payee, bytes calldata memo, uint256 deadline)
        private
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(SPEND_TYPEHASH, agent, amount, payee, keccak256(memo), _useNonce(agent), deadline))
        );
    }

    /// @dev `tryRecover` rather than `recover`, so every bad signature — malformed, high-s,
    ///      wrong signer — surfaces as the one custom error the API maps.
    function _checkSignature(address agent, bytes32 digest, bytes calldata signature) private pure {
        (address signer, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, signature);
        if (error != ECDSA.RecoverError.NoError || signer != agent) revert InvalidSignature();
    }

    function _activeAgent(address agent) private view returns (AgentInfo storage info) {
        info = _agents[agent];
        if (!info.registered) revert NotAgent();
        if (!info.active) revert AgentNotActive();
    }

    /// @dev The cap check, shared by both ways of asking. One implementation, so the relayed path
    ///      cannot enforce anything the direct path does not.
    function _spend(AgentInfo storage info, address agent, uint256 amount, address payee, bytes calldata memo)
        private
        returns (bool executed, uint256 requestId)
    {
        // Lazy reset: the boundary is computed here, on the agent's own call. There is no
        // maintenance function and nothing to keep alive between periods.
        _rollPeriod(info);

        // Both caps, inclusive at the boundary. Over either one holds; it is never dropped and
        // never forced through (R6).
        if (amount > info.perTxCap || info.periodSpend + amount > info.perPeriodCap) {
            requestId = ++nextRequestId;
            _requests[requestId] = PendingRequest({agent: agent, payee: payee, amount: amount, memo: memo, open: true});

            emit PaymentPending(requestId, agent, payee, amount, memo);
            return (false, requestId);
        }

        _release(info, agent, payee, amount, memo);
        return (true, 0);
    }

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

    /// @dev The one place agent funds leave this contract. Checked explicitly rather than left to
    ///      the token's own revert, so an empty balance surfaces as one error the API and the
    ///      skills can name. Charging the period happens before the transfer, so a reentrant
    ///      token cannot see stale state.
    function _release(AgentInfo storage info, address agent, address payee, uint256 amount, bytes memory memo) private {
        if (USDC.balanceOf(address(this)) < amount) revert InsufficientBalance();

        info.periodSpend += amount;

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

    /// @inheritdoc IRoster
    /// @dev A separate per-agent mapping rather than a field on AgentInfo, so `getAgent`'s return
    ///      shape — which the skills decode by hand — does not change.
    function nonces(address agent) public view override(IRoster, Nonces) returns (uint256) {
        return super.nonces(agent);
    }
}
