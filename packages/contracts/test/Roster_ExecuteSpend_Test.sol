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
        assertEq(_balance(), TREASURY - PRICER_PER_TX, "drawn from the shared balance");
    }

    /// One base unit over — the smallest overage USDC can express — holds instead of executing.
    function test_OneBaseUnitOverThePerTxCapGoesPending() public {
        (bool executed, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);

        assertFalse(executed, "one base unit over the cap must not execute");
        assertEq(requestId, 1);
        assertEq(usdc.balanceOf(pricer), 0, "a pending request moves no funds");
        assertEq(_agent(pricer).periodSpend, 0, "a pending request does not consume budget");
        assertEq(_balance(), TREASURY);
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

    /// Periods are anchored per agent, to its own hire — not to a roster-wide clock. An agent
    /// crossing its boundary does not roll one hired later, whose boundary has not arrived.
    function test_PeriodsAreAnchoredPerAgentNotGlobally() public {
        uint256 period = roster.PERIOD_LENGTH();
        uint256 pricerStart = _agent(pricer).periodStart;

        // Hire a third agent ten days in, so the two boundaries differ.
        vm.warp(pricerStart + 10 days);
        vm.prank(owner);
        roster.hireAgent(stranger, 10 * USD, 100 * USD, "Later hire");
        uint256 strangerStart = _agent(stranger).periodStart;

        _spend(pricer, PRICER_PER_TX);
        _spend(stranger, 5 * USD);

        // Cross pricer's boundary, but not the later hire's.
        vm.warp(pricerStart + period);

        assertEq(_agent(pricer).periodSpend, 0, "pricer's period has rolled");
        assertEq(_agent(pricer).periodStart, pricerStart + period);
        assertEq(_agent(stranger).periodSpend, 5 * USD, "the later hire's has not");
        assertEq(_agent(stranger).periodStart, strangerStart);
    }

    // ─── the shared balance ───────────────────────────────────────────────────

    /// A newly hired agent can spend at once — its caps are its whole setup. There is no funding
    /// step between hiring and the first purchase.
    function test_ANewHireSpendsFromTheBalanceWithNoFundingStep() public {
        vm.prank(owner);
        roster.hireAgent(stranger, 10 * USD, 100 * USD, "Later hire");

        (bool executed,) = _spend(stranger, 10 * USD);

        assertTrue(executed);
        assertEq(usdc.balanceOf(stranger), 10 * USD);
    }

    function test_EveryAgentDrawsFromTheSameBalance() public {
        _spend(pricer, PRICER_PER_TX);
        _spend(concierge, CONCIERGE_PER_TX);

        assertEq(_balance(), TREASURY - PRICER_PER_TX - CONCIERGE_PER_TX);
    }

    /// USDC that arrives is spendable immediately, by any agent within its caps.
    function test_ADepositIsSpendableAtOnce() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, TREASURY);

        usdc.mint(address(roster), CONCIERGE_PER_TX);

        (bool executed,) = _spend(concierge, CONCIERGE_PER_TX);
        assertTrue(executed);
        assertEq(_balance(), 0);
    }

    /// The trade-off of one pool, stated as a test: the caps bound each agent, but the balance is
    /// shared, so agents together can spend it down. What stops any one agent draining it is its
    /// own monthly cap — pricer's here is well under the balance.
    function test_TheBalanceIsFirstComeFirstServed() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, TREASURY - PRICER_PER_TX);

        (bool executed,) = _spend(pricer, PRICER_PER_TX);
        assertTrue(executed);

        vm.prank(concierge);
        vm.expectRevert(IRoster.InsufficientBalance.selector);
        roster.executeSpend(1, payee, MEMO);
    }

    /// Over-cap is decided before the balance is: a held request moves nothing, so it opens even
    /// when the Roster is empty, and the owner still sees what the agent was trying to do.
    function test_AnOverCapSpendHoldsEvenWithAnEmptyBalance() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, TREASURY);

        (bool executed, uint256 requestId) = _spend(pricer, PRICER_PER_TX + 1);
        assertFalse(executed);
        assertEq(requestId, 1);
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

    /// Within both caps but more than the Roster holds: refused outright, not held. There is
    /// nothing for the owner to approve — only money to add — and the reverted call charges the
    /// period nothing.
    function test_RevertWhen_TheBalanceCannotCoverAnInCapSpend() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, TREASURY - PRICER_PER_TX + 1);

        vm.prank(pricer);
        vm.expectRevert(IRoster.InsufficientBalance.selector);
        roster.executeSpend(PRICER_PER_TX, payee, MEMO);

        assertEq(_agent(pricer).periodSpend, 0, "a refused spend charges nothing");
        assertEq(roster.nextRequestId(), 0, "and opens no request");
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
