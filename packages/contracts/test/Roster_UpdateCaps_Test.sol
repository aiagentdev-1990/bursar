// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// R8's "reduce" half — adjusting an allowance without a revoke and re-hire.
contract Roster_UpdateCaps_Test is RosterTestBase {
    function test_ReplacesBothCaps() public {
        vm.prank(owner);
        roster.updateCaps(pricer, 1 * USD, 5 * USD);

        assertEq(_agent(pricer).perTxCap, 1 * USD);
        assertEq(_agent(pricer).perPeriodCap, 5 * USD);
    }

    function test_EmitsCapsUpdated() public {
        vm.expectEmit(true, false, false, true, address(roster));
        emit IRoster.CapsUpdated(pricer, 1 * USD, 5 * USD);

        vm.prank(owner);
        roster.updateCaps(pricer, 1 * USD, 5 * USD);
    }

    /// There is no grace period. A reduced cap binds on the next transaction.
    function test_AReducedCapBindsOnTheVeryNextSpend() public {
        vm.prank(owner);
        roster.updateCaps(pricer, 1 * USD, 5 * USD);

        (bool executed,) = _spend(pricer, 2 * USD);
        assertFalse(executed, "the reduced cap binds immediately");
    }

    function test_ARaisedCapAlsoTakesEffectImmediately() public {
        (bool blocked,) = _spend(pricer, PRICER_PER_TX + 1);
        assertFalse(blocked);

        vm.prank(owner);
        roster.updateCaps(pricer, PRICER_PER_TX * 2, PRICER_PER_PERIOD);

        (bool executed,) = _spend(pricer, PRICER_PER_TX + 1);
        assertTrue(executed);
    }

    /// Reducing the period cap below what is already spent must not underflow or claw back; it
    /// just means nothing more clears this period.
    function test_ReducingThePeriodCapBelowSpendLocksOutFurtherSpending() public {
        _spend(pricer, PRICER_PER_TX);

        vm.prank(owner);
        roster.updateCaps(pricer, PRICER_PER_TX, PRICER_PER_TX / 2);

        (bool executed,) = _spend(pricer, 1);
        assertFalse(executed, "already over the new period cap");
        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX, "nothing is clawed back");
    }

    /// Changing caps does not reset the period counter — that would be a way to launder the cap.
    function test_DoesNotResetThePeriod() public {
        _spend(pricer, PRICER_PER_TX);
        uint256 periodStart = _agent(pricer).periodStart;

        vm.prank(owner);
        roster.updateCaps(pricer, PRICER_PER_TX * 10, PRICER_PER_PERIOD * 10);

        assertEq(_agent(pricer).periodSpend, PRICER_PER_TX, "spend so far still counts");
        assertEq(_agent(pricer).periodStart, periodStart);
    }

    function test_LeavesEveryOtherAgentAlone() public {
        IRoster.AgentInfo memory before = _agent(concierge);

        vm.prank(owner);
        roster.updateCaps(pricer, 1 * USD, 5 * USD);

        assertEq(_agent(concierge).perTxCap, before.perTxCap);
        assertEq(_agent(concierge).perPeriodCap, before.perPeriodCap);
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.updateCaps(pricer, 1, 1);
    }

    function test_RevertWhen_TheAgentIsUnknown() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.UnknownAgent.selector);
        roster.updateCaps(stranger, 1, 1);
    }

    /// Zero is not "reduce to nothing" — that is what revokeAgent is for, and it says so.
    function test_RevertWhen_EitherCapIsZero() public {
        vm.startPrank(owner);
        vm.expectRevert(IRoster.ZeroCap.selector);
        roster.updateCaps(pricer, 0, PRICER_PER_PERIOD);

        vm.expectRevert(IRoster.ZeroCap.selector);
        roster.updateCaps(pricer, PRICER_PER_TX, 0);
        vm.stopPrank();
    }
}
