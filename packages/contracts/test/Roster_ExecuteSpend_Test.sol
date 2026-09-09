// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// §4.2 and §4.3 — the core call, and the two places a bug breaks the product's central claim:
/// cap math, and the lazy period reset (CLAUDE.md, "Testing bar").
contract Roster_ExecuteSpend_Test is RosterTestBase {
    // ─── the per-transaction cap ──────────────────────────────────────────────

    /// The boundary is inclusive.
    function test_ExactlyAtThePerTxCapExecutes() public {
        (bool executed, uint256 requestId) = _spend(pricer, PRICER_PER_TX);

        assertTrue(executed, "spend at the cap must execute");
        assertEq(requestId, 0, "an executed spend opens no request");
        assertEq(usdc.balanceOf(pricer), PRICER_PER_TX, "funds land in the agent's own wallet");
        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX);
        assertEq(_agent(pricer).earmarkedBalance, EARMARK - PRICER_PER_TX);
    }

    /// One base unit over — the smallest overage USDC can express — holds instead of executing.
    function test_OneBaseUnitOverThePerTxCapGoesPending() public {
        (bool executed, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        assertFalse(executed, "one base unit over the cap must not execute");
        assertEq(requestId, 1);
        assertEq(usdc.balanceOf(pricer), 0, "a pending request moves no funds");
        assertEq(_agent(pricer).periodSpend, 0, "a pending request does not consume budget");
        assertEq(_agent(pricer).earmarkedBalance, EARMARK);
    }

    // ─── the per-period cap ───────────────────────────────────────────────────

    function test_ExactlyAtThePerPeriodCapExecutes() public {
        vm.prank(owner);
        roster.updateCaps(pricer, PRICER_PER_PERIOD, PRICER_PER_PERIOD);

        (bool executed,) = _spend(pricer, PRICER_PER_PERIOD);
        assertTrue(executed, "the period boundary is inclusive too");
        assertEq(_agent(pricer).periodSpend, PRICER_PER_PERIOD);
    }

    /// Every spend here is individually under the per-transaction cap. The one that crosses the
    /// period cap still holds.
    function test_CumulativeSpendCrossingThePerPeriodCapGoesPending() public {
        _exhaustPeriod(pricer, PRICER_PER_TX, PRICER_PER_PERIOD);
        assertEq(_agent(pricer).periodSpend, PRICER_PER_PERIOD, "period cap reached exactly");

        (bool crossed, uint256 requestId) = _spend(pricer, 1);

        assertFalse(crossed, "the spend that crosses the period cap must hold");
        assertEq(requestId, 1);
        assertEq(_agent(pricer).periodSpend, PRICER_PER_PERIOD, "a held spend adds nothing");
    }

    // ─── the lazy period reset ────────────────────────────────────────────────

    /// No keeper, no maintenance call, no `resetPeriod`. The only call after the boundary is the
    /// agent's own spend.
    function test_FirstSpendAfterTheBoundaryPassesWithAZeroedCounter() public {
        uint256 hiredAt = _agent(pricer).periodStart;

        _exhaustPeriod(pricer, PRICER_PER_TX, PRICER_PER_PERIOD);
        (bool blocked,) = _spend(pricer, 1);
        assertFalse(blocked, "the period cap is exhausted before the boundary");

        vm.warp(hiredAt + roster.PERIOD_LENGTH());

        (bool executed,) = _spend(pricer, PRICER_PER_TX);

        assertTrue(executed, "the first spend of a new period must pass");
        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX, "counter zeroed, then charged");
        assertEq(_agent(pricer).periodStart, hiredAt + roster.PERIOD_LENGTH());
    }

    /// One second before the boundary is still the old period.
    function test_TheLastSecondOfAPeriodStillCountsAgainstIt() public {
        uint256 hiredAt = _agent(pricer).periodStart;
        _exhaustPeriod(pricer, PRICER_PER_TX, PRICER_PER_PERIOD);

        vm.warp(hiredAt + roster.PERIOD_LENGTH() - 1);

        (bool executed,) = _spend(pricer, 1);
        assertFalse(executed, "the period has not rolled yet");
    }

    /// A period that lapses unused still advances on its original cadence, rather than
    /// re-anchoring to whenever the agent next happens to spend.
    function test_PeriodStartAdvancesByWholePeriodsAcrossASkippedGap() public {
        uint256 hiredAt = _agent(pricer).periodStart;
        uint256 period = roster.PERIOD_LENGTH();

        vm.warp(hiredAt + period * 3 + 5 days);
        _spend(pricer, PRICER_PER_TX);

        assertEq(
            _agent(pricer).periodStart,
            hiredAt + period * 3,
            "periodStart advances by whole periods, not to the moment of the spend"
        );
    }

    /// The reset is per-agent. One agent crossing its boundary does not roll anyone else's.
    function test_ResettingOneAgentsPeriodLeavesAnothersAlone() public {
        _spend(concierge, CONCIERGE_PER_TX);
        uint256 conciergeStart = _agent(concierge).periodStart;
        uint256 conciergeSpend = _agent(concierge).periodSpend;

        vm.warp(block.timestamp + roster.PERIOD_LENGTH());
        _spend(pricer, PRICER_PER_TX);

        assertEq(_agent(concierge).periodStart, conciergeStart, "untouched until it spends");
        assertEq(_agent(concierge).periodSpend, conciergeSpend);
    }

    // ─── funds and accounting ─────────────────────────────────────────────────

    /// Over-cap is decided before funding is: an unfunded agent still gets a held request rather
    /// than a revert, so the owner sees what it was trying to do.
    function test_AnOverCapSpendHoldsEvenWithNothingEarmarked() public {
        vm.prank(owner);
        roster.hireAgent(stranger, 1 * USD, 5 * USD, "Unfunded");

        (bool executed, uint256 requestId) = _spend(stranger, 100 * USD);
        assertFalse(executed);
        assertEq(requestId, 1);
    }

    function test_DrawsDownTheTreasuryAndTotalEarmarked() public {
        assertEq(roster.totalEarmarked(), EARMARK * 2);

        _spend(pricer, PRICER_PER_TX);

        assertEq(roster.totalEarmarked(), EARMARK * 2 - PRICER_PER_TX);
        assertEq(usdc.balanceOf(address(roster)), TREASURY - PRICER_PER_TX);
    }

    // ─── events (the dashboard's only data source, §4.5) ──────────────────────

    function test_EmitsSpendExecutedOnTheInCapPath() public {
        vm.expectEmit(true, true, false, true, address(roster));
        emit IRoster.SpendExecuted(pricer, payee, PRICER_PER_TX, MEMO);
        _spend(pricer, PRICER_PER_TX);
    }

    function test_EmitsPaymentPendingOnTheOverCapPath() public {
        vm.expectEmit(true, true, true, true, address(roster));
        emit IRoster.PaymentPending(1, pricer, payee, PRICER_PER_TX + 1, MEMO);
        _spend(pricer, PRICER_PER_TX + 1);
    }

    /// Request ids are unique across the roster, not per agent — the owner approves by id.
    function test_RequestIdsIncrementAcrossTheWholeRoster() public {
        assertEq(_hold(pricer, PRICER_PER_TX + 1), 1);
        assertEq(_hold(concierge, CONCIERGE_PER_TX + 1), 2);
        assertEq(_hold(pricer, PRICER_PER_TX + 2), 3);
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_TheEarmarkCannotCoverAnInCapSpend() public {
        vm.prank(owner);
        roster.hireAgent(stranger, 100 * USD, 500 * USD, "Unfunded");

        vm.prank(stranger);
        vm.expectRevert(IRoster.InsufficientEarmarkedBalance.selector);
        roster.executeSpend(1 * USD, payee, MEMO);
    }

    function test_RevertWhen_TheCallerIsNotRegistered() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotAgent.selector);
        roster.executeSpend(1, payee, MEMO);
    }

    function test_RevertWhen_TheAgentIsRevoked() public {
        vm.prank(owner);
        roster.revokeAgent(pricer);

        vm.prank(pricer);
        vm.expectRevert(IRoster.AgentNotActive.selector);
        roster.executeSpend(1 * USD, payee, MEMO);
    }

    /// The owner has no privileged path into this function — it is the agent's, and only the
    /// agent's. No owner signature appears anywhere in §4.2.
    function test_RevertWhen_TheOwnerSpendsOnAnAgentsBehalf() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.NotAgent.selector);
        roster.executeSpend(1 * USD, payee, MEMO);
    }

    // ─── fuzz ─────────────────────────────────────────────────────────────────

    /// The cap decision is a pure function of the two caps and the running total. Fuzz it rather
    /// than trusting the hand-picked boundaries above.
    function testFuzz_ExecutesIfAndOnlyIfBothCapsAreSatisfied(uint256 first, uint256 second) public {
        first = bound(first, 1, PRICER_PER_TX);
        second = bound(second, 1, PRICER_PER_TX * 2);

        (bool firstExecuted,) = _spend(pricer, first);
        assertTrue(firstExecuted, "a spend within both caps always executes");

        (bool secondExecuted,) = _spend(pricer, second);
        bool shouldExecute = second <= PRICER_PER_TX && first + second <= PRICER_PER_PERIOD;

        assertEq(secondExecuted, shouldExecute, "execution tracks the caps exactly");
        assertEq(_agent(pricer).periodSpend, shouldExecute ? first + second : first);
    }

    /// However far the clock jumps, the period start stays on the cadence set at hire.
    function testFuzz_PeriodStartStaysOnCadence(uint256 elapsed) public {
        uint256 hiredAt = _agent(pricer).periodStart;
        uint256 period = roster.PERIOD_LENGTH();
        elapsed = bound(elapsed, 0, 3650 days);

        vm.warp(hiredAt + elapsed);
        _spend(pricer, 1);

        assertEq(_agent(pricer).periodStart, hiredAt + (elapsed / period) * period);
    }
}
