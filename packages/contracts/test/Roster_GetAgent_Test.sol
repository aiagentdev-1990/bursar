// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// The dashboard's live-state read. History comes from Blockscout (§4.5); everything that has to
/// agree with what the contract will actually enforce comes from here.
contract Roster_GetAgent_Test is RosterTestBase {
    function test_ReturnsEveryFieldForARegisteredAgent() public view {
        IRoster.AgentInfo memory info = _agent(pricer);

        assertEq(info.perTxCap, PRICER_PER_TX);
        assertEq(info.perPeriodCap, PRICER_PER_PERIOD);
        assertEq(info.periodSpend, 0);
        assertEq(info.earmarkedBalance, EARMARK);
        assertEq(info.role, "Comparable-listing research");
        assertGt(info.periodStart, 0);
        assertTrue(info.registered);
        assertTrue(info.active);
    }

    /// An unknown address reads as an empty struct rather than reverting, so the dashboard can
    /// ask about anything without special-casing.
    function test_ReturnsAnEmptyStructForAnUnknownAddress() public view {
        IRoster.AgentInfo memory info = _agent(stranger);

        assertEq(info.perTxCap, 0);
        assertEq(info.perPeriodCap, 0);
        assertEq(info.periodStart, 0);
        assertFalse(info.registered);
        assertFalse(info.active);
    }

    /// The pair that tells a revoked agent from one that was never hired.
    function test_DistinguishesRevokedFromUnknown() public {
        vm.prank(owner);
        roster.revokeAgent(pricer);

        assertTrue(_agent(pricer).registered);
        assertFalse(_agent(pricer).active);

        assertFalse(_agent(stranger).registered);
        assertFalse(_agent(stranger).active);
    }

    function test_ReflectsSpendImmediately() public {
        _spend(pricer, PRICER_PER_TX);

        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX);
        assertEq(_agent(pricer).earmarkedBalance, EARMARK - PRICER_PER_TX);
    }

    /// The view reports the period the contract would enforce right now, not the one it last
    /// wrote. Without this the dashboard draws an exhausted budget bar for an agent that can
    /// spend, and the pending screen's "monthly cap after" is wrong by a whole period.
    function test_ReportsTheRolledPeriodAfterABoundary() public {
        _spend(pricer, PRICER_PER_TX);
        uint256 periodStart = _agent(pricer).periodStart;

        vm.warp(periodStart + roster.PERIOD_LENGTH() + 1);

        assertEq(_agent(pricer).periodSpend, 0, "the new period is empty");
        assertEq(_agent(pricer).periodStart, periodStart + roster.PERIOD_LENGTH());
    }

    /// And what it reports is exactly what the next spend does — one implementation of the reset,
    /// used by both the enforcement and the display.
    function test_TheRolledViewMatchesWhatTheNextSpendActuallyWrites() public {
        _spend(pricer, PRICER_PER_TX);
        vm.warp(_agent(pricer).periodStart + roster.PERIOD_LENGTH());

        IRoster.AgentInfo memory predicted = _agent(pricer);

        _spend(pricer, PRICER_PER_TX);

        assertEq(_agent(pricer).periodStart, predicted.periodStart, "same boundary");
        assertEq(_agent(pricer).periodSpend, predicted.periodSpend + PRICER_PER_TX);
    }

    /// Reading is still free of side effects — the roll is computed on a memory copy, so two
    /// reads either side of a spend differ only by the spend.
    function test_ReadingDoesNotAdvanceAnything() public {
        vm.warp(_agent(pricer).periodStart + roster.PERIOD_LENGTH() + 5 days);

        IRoster.AgentInfo memory first = _agent(pricer);
        IRoster.AgentInfo memory second = _agent(pricer);

        assertEq(first.periodStart, second.periodStart);
        assertEq(first.periodSpend, second.periodSpend);
    }

    /// An unregistered address has `periodStart` zero, which would otherwise roll to an absurd
    /// value. The empty struct is returned untouched.
    function test_DoesNotRollAnUnregisteredAddress() public {
        vm.warp(block.timestamp + 3650 days);

        IRoster.AgentInfo memory info = _agent(stranger);
        assertEq(info.periodStart, 0);
        assertEq(info.periodSpend, 0);
    }
}
