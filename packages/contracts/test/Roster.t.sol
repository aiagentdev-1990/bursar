// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Roster} from "../src/Roster.sol";
import {RosterFactory} from "../src/RosterFactory.sol";
import {IRoster} from "../src/IRoster.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Cap math and the lazy period reset in `executeSpend` are the two places a bug breaks the
/// product's central claim (CLAUDE.md, "Testing bar"). Everything else in this file exists to
/// keep those two honest.
contract RosterTest is Test {
    MockUSDC internal usdc;
    RosterFactory internal factory;
    Roster internal roster;

    address internal owner = makeAddr("owner");
    address internal pricer = makeAddr("pricer");
    address internal concierge = makeAddr("concierge");
    address internal payee = makeAddr("chrono24");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant USD = 1e6; // USDC is 6 decimals

    // Mockup figures, so the tests and the dashboard describe the same roster.
    uint256 internal constant PRICER_PER_TX = 10 * USD;
    uint256 internal constant PRICER_PER_PERIOD = 400 * USD;
    uint256 internal constant CONCIERGE_PER_TX = 25 * USD;
    uint256 internal constant CONCIERGE_PER_PERIOD = 150 * USD;

    bytes internal constant MEMO = bytes("Comparable sold-listing pull");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new RosterFactory(address(usdc));
        roster = Roster(factory.createRoster(owner));

        vm.startPrank(owner);
        roster.hireAgent(pricer, PRICER_PER_TX, PRICER_PER_PERIOD, "Comparable-listing research");
        roster.hireAgent(concierge, CONCIERGE_PER_TX, CONCIERGE_PER_PERIOD, "Buyer questions and offers");
        vm.stopPrank();

        // Funding arrives at the Roster address first (§4.6), then the owner earmarks it.
        usdc.mint(address(roster), 10_000 * USD);
        vm.startPrank(owner);
        roster.fundAgent(pricer, 1_000 * USD);
        roster.fundAgent(concierge, 1_000 * USD);
        vm.stopPrank();
    }

    function _spend(address agent, uint256 amount) internal returns (bool executed, uint256 requestId) {
        vm.prank(agent);
        return roster.executeSpend(amount, payee, MEMO);
    }

    // ─── the testing bar ──────────────────────────────────────────────────────

    /// Exactly at the per-transaction cap passes. The boundary is inclusive.
    function test_SpendExactlyAtPerTxCap_Executes() public {
        (bool executed, uint256 requestId) = _spend(pricer, PRICER_PER_TX);

        assertTrue(executed, "spend at the cap must execute");
        assertEq(requestId, 0, "an executed spend opens no request");
        assertEq(usdc.balanceOf(pricer), PRICER_PER_TX, "funds land in the agent's own wallet");
        assertEq(roster.getAgent(pricer).periodSpend, PRICER_PER_TX);
        assertEq(roster.getAgent(pricer).earmarkedBalance, 1_000 * USD - PRICER_PER_TX);
    }

    /// One base unit over — the smallest overage USDC can express — goes pending, not through.
    function test_SpendOneBaseUnitOverPerTxCap_GoesPending() public {
        (bool executed, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        assertFalse(executed, "one base unit over the cap must not execute");
        assertEq(requestId, 1);
        assertEq(usdc.balanceOf(pricer), 0, "a pending request moves no funds");
        assertEq(roster.getAgent(pricer).periodSpend, 0, "a pending request does not consume budget");
        assertEq(roster.getAgent(pricer).earmarkedBalance, 1_000 * USD);

        IRoster.PendingRequest memory request = roster.getPendingRequest(requestId);
        assertTrue(request.open);
        assertEq(request.agent, pricer);
        assertEq(request.payee, payee);
        assertEq(request.amount, PRICER_PER_TX + 1);
    }

    /// Each spend is individually under the per-transaction cap; the one that crosses the
    /// per-period cap still holds.
    function test_CumulativeSpendCrossingPerPeriodCap_GoesPending() public {
        // 40 × $10 = $400, exactly the period cap.
        for (uint256 i = 0; i < 40; i++) {
            (bool executed,) = _spend(pricer, PRICER_PER_TX);
            assertTrue(executed, "in-cap spend must execute");
        }
        assertEq(roster.getAgent(pricer).periodSpend, PRICER_PER_PERIOD, "period cap reached exactly");

        // The next base unit crosses it, even though it is far under the per-transaction cap.
        (bool crossed, uint256 requestId) = _spend(pricer, 1);
        assertFalse(crossed, "the spend that crosses the period cap must hold");
        assertEq(requestId, 1);
        assertEq(roster.getAgent(pricer).periodSpend, PRICER_PER_PERIOD, "held spend adds nothing");
    }

    /// The reset is lazy: no keeper, no maintenance call, nothing but the agent's own spend.
    function test_SpendAfterPeriodBoundary_PassesWithZeroedCounter() public {
        uint256 hiredAt = roster.getAgent(pricer).periodStart;

        for (uint256 i = 0; i < 40; i++) {
            _spend(pricer, PRICER_PER_TX);
        }
        (bool blocked,) = _spend(pricer, 1);
        assertFalse(blocked, "period cap is exhausted before the boundary");

        vm.warp(hiredAt + roster.PERIOD_LENGTH());

        // The only call made after the warp is the spend itself.
        (bool executed,) = _spend(pricer, PRICER_PER_TX);

        assertTrue(executed, "the first spend of a new period must pass");
        assertEq(roster.getAgent(pricer).periodSpend, PRICER_PER_TX, "counter zeroed, then charged");
        assertEq(roster.getAgent(pricer).periodStart, hiredAt + roster.PERIOD_LENGTH());
    }

    /// Revocation is isolated. The second agent spends in the same block, with no warp between.
    function test_RevokedAgentReverts_AndSecondAgentSucceedsInSameBlock() public {
        uint256 blockAtRevoke = block.number;

        vm.prank(owner);
        roster.revokeAgent(pricer);

        vm.prank(pricer);
        vm.expectRevert(IRoster.AgentNotActive.selector);
        roster.executeSpend(1 * USD, payee, MEMO);

        (bool executed,) = _spend(concierge, CONCIERGE_PER_TX);

        assertTrue(executed, "revoking one agent must not touch another");
        assertEq(block.number, blockAtRevoke, "both outcomes in the same block");
        assertEq(usdc.balanceOf(concierge), CONCIERGE_PER_TX);
    }

    // ─── cap math, the rest of it ─────────────────────────────────────────────

    function test_SpendExactlyAtPerPeriodCap_Executes() public {
        vm.prank(owner);
        roster.updateCaps(pricer, PRICER_PER_PERIOD, PRICER_PER_PERIOD);

        (bool executed,) = _spend(pricer, PRICER_PER_PERIOD);
        assertTrue(executed, "the period boundary is inclusive too");
        assertEq(roster.getAgent(pricer).periodSpend, PRICER_PER_PERIOD);
    }

    /// A period that lapses entirely unused still advances on its original cadence, rather than
    /// re-anchoring to whenever the agent next happens to spend.
    function test_PeriodBoundaryStaysOnCadenceAcrossSkippedPeriods() public {
        uint256 hiredAt = roster.getAgent(pricer).periodStart;
        uint256 period = roster.PERIOD_LENGTH();

        vm.warp(hiredAt + period * 3 + 5 days);
        _spend(pricer, PRICER_PER_TX);

        assertEq(
            roster.getAgent(pricer).periodStart,
            hiredAt + period * 3,
            "periodStart advances by whole periods, not to the moment of the spend"
        );
    }

    function test_SpendBelowCapButAboveEarmarkedBalance_Reverts() public {
        vm.prank(owner);
        roster.hireAgent(stranger, 100 * USD, 500 * USD, "Unfunded");

        vm.prank(stranger);
        vm.expectRevert(IRoster.InsufficientEarmarkedBalance.selector);
        roster.executeSpend(1 * USD, payee, MEMO);
    }

    // ─── pending approval (§4.3) ──────────────────────────────────────────────

    function test_ApprovePending_ReleasesFundsAndChargesThePeriod() public {
        (, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        vm.prank(owner);
        roster.approvePending(requestId);

        assertEq(usdc.balanceOf(pricer), PRICER_PER_TX + 1, "approval releases the funds");
        assertEq(
            roster.getAgent(pricer).periodSpend,
            PRICER_PER_TX + 1,
            "an approved over-cap spend still counts against the period cap"
        );
        assertFalse(roster.getPendingRequest(requestId).open, "request is closed");
    }

    function test_RejectPending_MovesNothing() public {
        (, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        vm.prank(owner);
        roster.rejectPending(requestId);

        assertEq(usdc.balanceOf(pricer), 0);
        assertEq(roster.getAgent(pricer).periodSpend, 0);
        assertEq(roster.getAgent(pricer).earmarkedBalance, 1_000 * USD);
        assertFalse(roster.getPendingRequest(requestId).open);
    }

    function test_PendingCannotBeSettledTwice() public {
        (, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        vm.startPrank(owner);
        roster.approvePending(requestId);
        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.approvePending(requestId);
        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.rejectPending(requestId);
        vm.stopPrank();
    }

    /// Revocation has to beat an outstanding approval, or the kill switch has a hole in it.
    function test_ApprovePending_RevertsForRevokedAgent() public {
        (, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        vm.startPrank(owner);
        roster.revokeAgent(pricer);
        vm.expectRevert(IRoster.AgentNotActive.selector);
        roster.approvePending(requestId);
        vm.stopPrank();

        assertEq(usdc.balanceOf(pricer), 0, "no funds escape a revoked agent");
    }

    // ─── isolation (§4.4) ─────────────────────────────────────────────────────

    /// Isolation is a storage-layout property. Assert the whole neighbouring struct, field by
    /// field — a test that only checks `active` would miss a stray write anywhere else.
    function test_RevokeAgent_TouchesOnlyThatAgentsRecord() public {
        IRoster.AgentInfo memory before = roster.getAgent(concierge);

        vm.prank(owner);
        roster.revokeAgent(pricer);

        IRoster.AgentInfo memory untouched = roster.getAgent(concierge);
        assertEq(untouched.perTxCap, before.perTxCap);
        assertEq(untouched.perPeriodCap, before.perPeriodCap);
        assertEq(untouched.periodSpend, before.periodSpend);
        assertEq(untouched.periodStart, before.periodStart);
        assertEq(untouched.earmarkedBalance, before.earmarkedBalance);
        assertEq(untouched.role, before.role);
        assertTrue(untouched.registered);
        assertTrue(untouched.active, "the other agent keeps working");

        assertFalse(roster.getAgent(pricer).active);
        assertTrue(roster.getAgent(pricer).registered, "a revoked agent is not an unknown one");
    }

    function test_UpdateCaps_TakesEffectImmediatelyAndInIsolation() public {
        IRoster.AgentInfo memory before = roster.getAgent(concierge);

        vm.prank(owner);
        roster.updateCaps(pricer, 1 * USD, 5 * USD);

        (bool executed,) = _spend(pricer, 2 * USD);
        assertFalse(executed, "the reduced cap binds on the very next spend");

        assertEq(roster.getAgent(concierge).perTxCap, before.perTxCap, "other caps untouched");
        assertEq(roster.getAgent(concierge).perPeriodCap, before.perPeriodCap);
    }

    function test_FundAgent_EarmarksAreIsolated() public {
        uint256 before = roster.getAgent(concierge).earmarkedBalance;

        vm.prank(owner);
        roster.fundAgent(pricer, 500 * USD);

        assertEq(roster.getAgent(pricer).earmarkedBalance, 1_500 * USD);
        assertEq(roster.getAgent(concierge).earmarkedBalance, before);
    }

    /// The treasury cannot be earmarked twice over.
    function test_FundAgent_RevertsWhenTreasuryCannotCoverEveryEarmark() public {
        // 10_000 minted, 2_000 already earmarked.
        vm.startPrank(owner);
        roster.fundAgent(pricer, 8_000 * USD);
        assertEq(roster.totalEarmarked(), 10_000 * USD);

        vm.expectRevert(IRoster.InsufficientTreasury.selector);
        roster.fundAgent(concierge, 1);
        vm.stopPrank();
    }

    function test_TotalEarmarkedFallsAsFundsAreReleased() public {
        assertEq(roster.totalEarmarked(), 2_000 * USD);

        _spend(pricer, PRICER_PER_TX);

        assertEq(roster.totalEarmarked(), 2_000 * USD - PRICER_PER_TX);
        assertEq(usdc.balanceOf(address(roster)), 10_000 * USD - PRICER_PER_TX);
    }

    // ─── access control ───────────────────────────────────────────────────────

    function test_OnlyOwnerCanHireFundApproveRevokeAndUpdateCaps() public {
        (, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        vm.startPrank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.hireAgent(stranger, 1, 1, "x");
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.fundAgent(pricer, 1);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.approvePending(requestId);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.rejectPending(requestId);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.revokeAgent(pricer);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.updateCaps(pricer, 1, 1);
        vm.stopPrank();
    }

    function test_UnregisteredCallerCannotSpend() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotAgent.selector);
        roster.executeSpend(1, payee, MEMO);
    }

    function test_CannotHireTheSameAgentTwice() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.AgentAlreadyRegistered.selector);
        roster.hireAgent(pricer, 1 * USD, 2 * USD, "duplicate");
    }

    function test_CannotHireWithZeroCaps() public {
        vm.startPrank(owner);
        vm.expectRevert(IRoster.ZeroCap.selector);
        roster.hireAgent(stranger, 0, 100 * USD, "no per-tx cap");
        vm.expectRevert(IRoster.ZeroCap.selector);
        roster.hireAgent(stranger, 10 * USD, 0, "no period cap");
        vm.stopPrank();
    }

    function test_OwnerActionsRevertForUnknownAgent() public {
        vm.startPrank(owner);
        vm.expectRevert(IRoster.UnknownAgent.selector);
        roster.revokeAgent(stranger);
        vm.expectRevert(IRoster.UnknownAgent.selector);
        roster.fundAgent(stranger, 1);
        vm.expectRevert(IRoster.UnknownAgent.selector);
        roster.updateCaps(stranger, 1, 1);
        vm.stopPrank();
    }

    // ─── clone lifecycle ──────────────────────────────────────────────────────

    function test_InitializeCannotBeCalledTwice() public {
        vm.expectRevert(IRoster.AlreadyInitialized.selector);
        roster.initialize(stranger);
    }

    /// An uninitialized implementation is an unowned contract. Lock it at construction.
    function test_ImplementationCannotBeInitialized() public {
        Roster implementation = Roster(factory.implementation());

        vm.expectRevert(IRoster.AlreadyInitialized.selector);
        implementation.initialize(stranger);
    }

    // ─── events (the dashboard's only data source, §4.5) ──────────────────────

    function test_EmitsSpendExecuted() public {
        vm.expectEmit(true, true, false, true, address(roster));
        emit IRoster.SpendExecuted(pricer, payee, PRICER_PER_TX, MEMO);
        _spend(pricer, PRICER_PER_TX);
    }

    function test_EmitsPaymentPending() public {
        vm.expectEmit(true, true, true, true, address(roster));
        emit IRoster.PaymentPending(1, pricer, payee, PRICER_PER_TX + 1, MEMO);
        _spend(pricer, PRICER_PER_TX + 1);
    }

    /// Approval fires SpendExecuted as well as PendingApproved (§4.3's diagram). That is exactly
    /// why the backend sends the Claude session event itself instead of inferring it from the
    /// event stream — §4.2's ordinary path fires SpendExecuted too.
    function test_ApproveEmitsBothPendingApprovedAndSpendExecuted() public {
        (, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        vm.expectEmit(true, true, false, true, address(roster));
        emit IRoster.PendingApproved(requestId, pricer, PRICER_PER_TX + 1);
        vm.expectEmit(true, true, false, true, address(roster));
        emit IRoster.SpendExecuted(pricer, payee, PRICER_PER_TX + 1, MEMO);

        vm.prank(owner);
        roster.approvePending(requestId);
    }

    // ─── fuzz ─────────────────────────────────────────────────────────────────

    /// The cap decision is a pure function of the two caps and the running total. Fuzz it rather
    /// than trusting the hand-picked boundaries above.
    function testFuzz_SpendExecutesIfAndOnlyIfBothCapsAreSatisfied(uint256 first, uint256 second) public {
        first = bound(first, 1, PRICER_PER_TX);
        second = bound(second, 1, PRICER_PER_TX * 2);

        (bool firstExecuted,) = _spend(pricer, first);
        assertTrue(firstExecuted, "a spend within both caps always executes");

        (bool secondExecuted,) = _spend(pricer, second);
        bool shouldExecute = second <= PRICER_PER_TX && first + second <= PRICER_PER_PERIOD;

        assertEq(secondExecuted, shouldExecute, "execution tracks the caps exactly");
        assertEq(roster.getAgent(pricer).periodSpend, shouldExecute ? first + second : first);
    }
}
