// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// The counterpart to `fundAgent`. Without it, an earmark was a one-way door: revoking a funded
/// agent stranded its remaining budget permanently, which made the kill switch cost real money.
contract Roster_DefundAgent_Test is RosterTestBase {
    function test_ReturnsTheEarmarkToTheUnallocatedPool() public {
        vm.prank(owner);
        roster.defundAgent(pricer, 400 * USD);

        assertEq(_agent(pricer).earmarkedBalance, EARMARK - 400 * USD);
        assertEq(roster.totalEarmarked(), EARMARK * 2 - 400 * USD);
    }

    /// Mirror of fundAgent: an allocation change, not a transfer.
    function test_MovesNoTokens() public {
        uint256 before = usdc.balanceOf(address(roster));

        vm.prank(owner);
        roster.defundAgent(pricer, 400 * USD);

        assertEq(usdc.balanceOf(address(roster)), before);
    }

    function test_EmitsAllowanceDefunded() public {
        vm.expectEmit(true, false, false, true, address(roster));
        emit IRoster.AllowanceDefunded(pricer, 400 * USD);

        vm.prank(owner);
        roster.defundAgent(pricer, 400 * USD);
    }

    /// The finding this function exists for: a revoked agent's budget is recoverable.
    function test_RecoversARevokedAgentsStrandedBudget() public {
        vm.startPrank(owner);
        roster.revokeAgent(pricer);
        roster.defundAgent(pricer, EARMARK);
        vm.stopPrank();

        assertEq(_agent(pricer).earmarkedBalance, 0);
        assertEq(roster.totalEarmarked(), EARMARK, "only the other agent's earmark remains");
    }

    /// And once recovered, it is genuinely reusable by someone else.
    function test_TheRecoveredBudgetCanBeEarmarkedToAnotherAgent() public {
        vm.startPrank(owner);
        roster.fundAgent(pricer, TREASURY - EARMARK * 2); // fully allocate the treasury
        roster.revokeAgent(pricer);

        uint256 stranded = _agent(pricer).earmarkedBalance;
        roster.defundAgent(pricer, stranded);
        roster.fundAgent(concierge, stranded);
        vm.stopPrank();

        assertEq(_agent(concierge).earmarkedBalance, EARMARK + stranded);
        assertEq(roster.totalEarmarked(), TREASURY);
    }

    function test_DefundingEverythingLeavesTheAgentRegisteredAndActive() public {
        vm.prank(owner);
        roster.defundAgent(pricer, EARMARK);

        assertTrue(_agent(pricer).registered);
        assertTrue(_agent(pricer).active, "defunding is not revocation");
        assertEq(_agent(pricer).earmarkedBalance, 0);
    }

    /// It touches the balance, not the caps or the period — it is not a way to launder spend.
    function test_DoesNotTouchCapsOrThePeriod() public {
        _spend(pricer, PRICER_PER_TX);
        IRoster.AgentInfo memory before = _agent(pricer);

        vm.prank(owner);
        roster.defundAgent(pricer, 100 * USD);

        IRoster.AgentInfo memory after_ = _agent(pricer);
        assertEq(after_.perTxCap, before.perTxCap);
        assertEq(after_.perPeriodCap, before.perPeriodCap);
        assertEq(after_.periodSpend, before.periodSpend);
        assertEq(after_.periodStart, before.periodStart);
    }

    function test_LeavesEveryOtherAgentAlone() public {
        uint256 before = _agent(concierge).earmarkedBalance;

        vm.prank(owner);
        roster.defundAgent(pricer, 400 * USD);

        assertEq(_agent(concierge).earmarkedBalance, before);
    }

    /// A defunded agent cannot spend what it no longer has.
    function test_RevertWhen_ADefundedAgentSpendsBeyondWhatIsLeft() public {
        vm.prank(owner);
        roster.defundAgent(pricer, EARMARK);

        vm.prank(pricer);
        vm.expectRevert(IRoster.InsufficientEarmarkedBalance.selector);
        roster.executeSpend(1 * USD, payee, MEMO);
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_DefundingMoreThanIsEarmarked() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.InsufficientEarmarkedBalance.selector);
        roster.defundAgent(pricer, EARMARK + 1);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.defundAgent(pricer, 1);
    }

    /// Not even the agent can hand its own budget back — every allocation change is the owner's.
    function test_RevertWhen_TheAgentDefundsItself() public {
        vm.prank(pricer);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.defundAgent(pricer, 1);
    }

    function test_RevertWhen_TheAgentIsUnknown() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.UnknownAgent.selector);
        roster.defundAgent(stranger, 1);
    }
}
