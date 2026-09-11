// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Roster} from "../src/Roster.sol";
import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// The relayed path: the agent signs, a relayer submits and pays the gas. Everything the
/// testing bar demands of `executeSpend` has to hold here too, plus the three things a signature
/// adds — replay, expiry, and cross-Roster domain separation.
contract Roster_ExecuteSpendFor_Test is RosterTestBase {
    /// Whoever submits. Never an agent, never the owner — the call must not care who it is.
    address internal relayer = makeAddr("relayer");

    uint256 internal pricerKey;
    uint256 internal conciergeKey;

    /// Written out here rather than read from the contract, so a typo in the contract's typehash
    /// or domain fails these tests instead of being signed against.
    bytes32 internal constant SPEND_TYPEHASH =
        keccak256("Spend(address agent,uint256 amount,address payee,bytes memo,uint256 nonce,uint256 deadline)");
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function setUp() public override {
        super.setUp();
        // The fixture's agents are `makeAddr(name)`, which is `makeAddrAndKey(name)` — so their
        // keys are recoverable without changing the shared fixture.
        address derived;
        (derived, pricerKey) = makeAddrAndKey("pricer");
        assertEq(derived, pricer);
        (derived, conciergeKey) = makeAddrAndKey("concierge");
        assertEq(derived, concierge);
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /// The signed struct, as a struct — eight loose parameters overflow the legacy code
    /// generator's stack.
    struct Spend {
        address agent;
        uint256 amount;
        address payee;
        bytes memo;
        uint256 nonce;
        uint256 deadline;
    }

    function _domain(Roster target) internal view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Roster"), keccak256("1"), block.chainid, address(target)));
    }

    function _sign(uint256 key, Roster target, Spend memory s) internal view returns (bytes memory) {
        bytes32 structHash =
            keccak256(abi.encode(SPEND_TYPEHASH, s.agent, s.amount, s.payee, keccak256(s.memo), s.nonce, s.deadline));
        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", _domain(target), structHash)));
        return abi.encodePacked(r, sig, v);
    }

    /// The agent signs a spend at its current nonce, valid for an hour.
    function _signed(uint256 key, address agent, uint256 amount) internal view returns (bytes memory, uint256) {
        uint256 deadline = block.timestamp + 1 hours;
        return (_sign(key, roster, Spend(agent, amount, payee, MEMO, roster.nonces(agent), deadline)), deadline);
    }

    function _relay(address agent, uint256 amount, uint256 deadline, bytes memory signature)
        internal
        returns (bool executed, uint256 requestId)
    {
        vm.prank(relayer);
        return roster.executeSpendFor(agent, amount, payee, MEMO, deadline, signature);
    }

    // ─── the point of it ──────────────────────────────────────────────────────

    /// The agent holds nothing and sends nothing. It ends up with exactly the released amount —
    /// no float to spend outside the cap.
    function test_ARelayedInCapSpendExecutesWithTheAgentHoldingNothingBeforehand() public {
        assertEq(usdc.balanceOf(pricer), 0, "the agent starts with no USDC at all");
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, PRICER_PER_TX);

        vm.expectEmit(address(roster));
        emit IRoster.SpendExecuted(pricer, payee, PRICER_PER_TX, MEMO);
        (bool executed, uint256 requestId) = _relay(pricer, PRICER_PER_TX, deadline, signature);

        assertTrue(executed);
        assertEq(requestId, 0);
        assertEq(usdc.balanceOf(pricer), PRICER_PER_TX, "released to the agent, exactly");
        assertEq(usdc.balanceOf(relayer), 0, "the relayer never receives funds");
        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX);
        assertEq(_balance(), TREASURY - PRICER_PER_TX, "drawn from the shared balance");
        assertEq(roster.nonces(pricer), 1);
    }

    /// The relay simulates before it sends, so this is the error an agent sees when its owner's
    /// balance is empty. The reverted call leaves the signature unused.
    function test_RevertWhen_TheBalanceCannotCoverIt_AndTheNonceIsNotConsumed() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, TREASURY);

        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, PRICER_PER_TX);

        vm.expectRevert(IRoster.InsufficientBalance.selector);
        _relay(pricer, PRICER_PER_TX, deadline, signature);

        assertEq(roster.nonces(pricer), 0);
    }

    // ─── the same caps as executeSpend ────────────────────────────────────────

    function test_ExactlyAtThePerTxCapExecutes() public {
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, PRICER_PER_TX);
        (bool executed,) = _relay(pricer, PRICER_PER_TX, deadline, signature);
        assertTrue(executed, "the boundary is inclusive on the relayed path too");
    }

    /// The held request belongs to the agent, not the relayer — the owner approves a release to
    /// the agent's wallet. A signature spent on a held request is spent: resubmitting it must not
    /// open a second request.
    function test_OneBaseUnitOverThePerTxCapGoesPendingAndConsumesTheNonce() public {
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, PRICER_PER_TX + 1);

        (bool executed, uint256 requestId) = _relay(pricer, PRICER_PER_TX + 1, deadline, signature);

        assertFalse(executed);
        assertEq(requestId, 1);
        assertEq(roster.getPendingRequest(1).agent, pricer, "held for the agent, not the relayer");
        assertEq(usdc.balanceOf(pricer), 0, "a pending request moves no funds");
        assertEq(roster.nonces(pricer), 1);

        vm.expectRevert(IRoster.InvalidSignature.selector);
        _relay(pricer, PRICER_PER_TX + 1, deadline, signature);
    }

    function test_CumulativeSpendCrossingThePerPeriodCapGoesPending() public {
        _exhaustPeriod(pricer, PRICER_PER_TX, PRICER_PER_PERIOD);

        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, 1);
        (bool executed,) = _relay(pricer, 1, deadline, signature);

        assertFalse(executed, "the relayed spend that crosses the period cap must hold");
    }

    /// No maintenance call on this path either — the relayed spend itself rolls the period.
    function test_ARelayedSpendAfterTheBoundaryPassesWithAZeroedCounter() public {
        uint256 hiredAt = _agent(pricer).periodStart;
        _exhaustPeriod(pricer, PRICER_PER_TX, PRICER_PER_PERIOD);

        vm.warp(hiredAt + roster.PERIOD_LENGTH());
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, PRICER_PER_TX);
        (bool executed,) = _relay(pricer, PRICER_PER_TX, deadline, signature);

        assertTrue(executed);
        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX, "counter zeroed, then charged");
    }

    // ─── revocation and isolation (§4.4) ──────────────────────────────────────

    /// An intent signed before the revoke is dead after it — and a second agent's relayed spend
    /// in the same block goes through untouched.
    function test_RevertWhen_TheAgentIsRevoked_AndAnotherAgentsRelayedSpendInTheSameBlockSucceeds() public {
        (bytes memory pricerSig, uint256 deadline) = _signed(pricerKey, pricer, PRICER_PER_TX);
        (bytes memory conciergeSig,) = _signed(conciergeKey, concierge, CONCIERGE_PER_TX);

        vm.prank(owner);
        roster.revokeAgent(pricer);

        vm.expectRevert(IRoster.AgentNotActive.selector);
        _relay(pricer, PRICER_PER_TX, deadline, pricerSig);

        (bool executed,) = _relay(concierge, CONCIERGE_PER_TX, deadline, conciergeSig);
        assertTrue(executed, "revoking one agent must not affect another");
        assertEq(usdc.balanceOf(concierge), CONCIERGE_PER_TX);
    }

    function test_RevertWhen_TheAgentIsNotRegistered() public {
        (address outsider, uint256 outsiderKey) = makeAddrAndKey("outsider");
        (bytes memory signature, uint256 deadline) = _signed(outsiderKey, outsider, 1);

        vm.expectRevert(IRoster.NotAgent.selector);
        _relay(outsider, 1, deadline, signature);
    }

    // ─── what a signature adds ────────────────────────────────────────────────

    function test_RevertWhen_TheSignatureIsReplayed() public {
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, 1);
        _relay(pricer, 1, deadline, signature);

        vm.expectRevert(IRoster.InvalidSignature.selector);
        _relay(pricer, 1, deadline, signature);
    }

    function test_TheDeadlineSecondItselfIsStillValid() public {
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, 1);
        vm.warp(deadline);

        (bool executed,) = _relay(pricer, 1, deadline, signature);
        assertTrue(executed);
    }

    function test_RevertWhen_TheDeadlineHasPassed() public {
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, 1);
        vm.warp(deadline + 1);

        vm.expectRevert(IRoster.SignatureExpired.selector);
        _relay(pricer, 1, deadline, signature);
    }

    /// One agent cannot spend another's allowance by signing for it.
    function test_RevertWhen_AnotherAgentSigns() public {
        (bytes memory signature, uint256 deadline) = _signed(conciergeKey, pricer, 1);

        vm.expectRevert(IRoster.InvalidSignature.selector);
        _relay(pricer, 1, deadline, signature);
        assertEq(roster.nonces(pricer), 0, "a rejected signature consumes nothing");
    }

    /// A relayer can submit what the agent signed and nothing else — not a larger amount, not a
    /// different payee, not a different memo.
    function test_RevertWhen_TheRelayerAltersAnySignedField() public {
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, 1);

        vm.startPrank(relayer);
        vm.expectRevert(IRoster.InvalidSignature.selector);
        roster.executeSpendFor(pricer, 2, payee, MEMO, deadline, signature);

        vm.expectRevert(IRoster.InvalidSignature.selector);
        roster.executeSpendFor(pricer, 1, stranger, MEMO, deadline, signature);

        vm.expectRevert(IRoster.InvalidSignature.selector);
        roster.executeSpendFor(pricer, 1, payee, bytes("something else"), deadline, signature);

        vm.expectRevert(IRoster.InvalidSignature.selector);
        roster.executeSpendFor(pricer, 1, payee, MEMO, deadline + 1, signature);
        vm.stopPrank();
    }

    /// The same agent on two teams, both at nonce 0. Only the domain — each clone's own address —
    /// stops a spend signed for one team draining the other.
    function test_RevertWhen_TheSignatureWasForAnotherRoster() public {
        Roster other = Roster(factory.createRoster(owner));
        vm.prank(owner);
        other.hireAgent(pricer, PRICER_PER_TX, PRICER_PER_PERIOD, "Comparable-listing research");
        usdc.mint(address(other), TREASURY);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory forOther = _sign(pricerKey, other, Spend(pricer, 1, payee, MEMO, 0, deadline));

        vm.expectRevert(IRoster.InvalidSignature.selector);
        _relay(pricer, 1, deadline, forOther);

        vm.prank(relayer);
        (bool executed,) = other.executeSpendFor(pricer, 1, payee, MEMO, deadline, forOther);
        assertTrue(executed, "and it is valid on the Roster it was signed for");
    }

    function test_RevertWhen_TheSignatureIsMalformed() public {
        vm.expectRevert(IRoster.InvalidSignature.selector);
        _relay(pricer, 1, block.timestamp + 1 hours, hex"deadbeef");
    }

    /// Clients read the domain rather than hardcoding it. It has to name the clone, not the
    /// shared implementation every clone delegatecalls into.
    function test_TheSigningDomainIsThisRostersOwn() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            roster.eip712Domain();

        assertEq(name, "Roster");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(roster));
    }

    /// The two paths are independent: an agent that sends its own `executeSpend` does not
    /// invalidate a signature it has outstanding.
    function test_ADirectSpendDoesNotConsumeTheNonce() public {
        (bytes memory signature, uint256 deadline) = _signed(pricerKey, pricer, 1);
        _spend(pricer, 1);
        assertEq(roster.nonces(pricer), 0);

        (bool executed,) = _relay(pricer, 1, deadline, signature);
        assertTrue(executed);
    }
}
