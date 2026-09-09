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

    /// The view does not roll the period — only `executeSpend` does. So a stale `periodSpend`
    /// after a boundary is expected, and the budget bar it draws is a hint, not the enforcement.
    function test_DoesNotRollThePeriodItself() public {
        _spend(pricer, PRICER_PER_TX);
        uint256 periodStart = _agent(pricer).periodStart;

        vm.warp(periodStart + roster.PERIOD_LENGTH() + 1);

        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX, "the view is passive");
        assertEq(_agent(pricer).periodStart, periodStart);
    }
}
