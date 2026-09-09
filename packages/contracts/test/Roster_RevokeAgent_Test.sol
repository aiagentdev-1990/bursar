// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// §4.4, the kill switch. Isolation is a property of the storage layout — one struct per agent
/// address — not of application logic. Nothing here may loop over agents, and nothing does.
contract Roster_RevokeAgent_Test is RosterTestBase {
    function test_ClearsTheActiveFlag() public {
        vm.prank(owner);
        roster.revokeAgent(pricer);

        assertFalse(_agent(pricer).active);
    }

    /// A revoked agent is not an unknown one. `registered` is never cleared, so the two stay
    /// distinguishable — that is what lets `UnknownAgent` mean something.
    function test_LeavesTheAgentRegistered() public {
        vm.prank(owner);
        roster.revokeAgent(pricer);

        assertTrue(_agent(pricer).registered);
    }

    function test_EmitsAgentRevoked() public {
        vm.expectEmit(true, false, false, false, address(roster));
        emit IRoster.AgentRevoked(pricer);

        vm.prank(owner);
        roster.revokeAgent(pricer);
    }

    /// The isolation beat from the demo, and the one easiest to fumble live: a revoked agent and
    /// a working one in the same block, with no warp between them.
    function test_ASecondAgentSpendsInTheSameBlock() public {
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

    /// Isolation is a storage-layout property, so assert the whole neighbouring struct field by
    /// field. A test that only checked `active` would miss a stray write anywhere else.
    function test_TouchesOnlyThatAgentsRecord() public {
        IRoster.AgentInfo memory before = _agent(concierge);

        vm.prank(owner);
        roster.revokeAgent(pricer);

        IRoster.AgentInfo memory untouched = _agent(concierge);
        assertEq(untouched.perTxCap, before.perTxCap);
        assertEq(untouched.perPeriodCap, before.perPeriodCap);
        assertEq(untouched.periodSpend, before.periodSpend);
        assertEq(untouched.periodStart, before.periodStart);
        assertEq(untouched.earmarkedBalance, before.earmarkedBalance);
        assertEq(untouched.role, before.role);
        assertTrue(untouched.registered);
        assertTrue(untouched.active, "the other agent keeps working");
    }

    /// Revocation does not touch money. It stops future spends; it does not claw back what has
    /// already been released, and it does not release the earmark either. `sweepUnspent` was
    /// removed, so nothing reclaims stranded USDC — see DECISIONS.md 2026-09-09.
    function test_DoesNotMoveOrReleaseFunds() public {
        _spend(pricer, PRICER_PER_TX);
        uint256 agentBalance = usdc.balanceOf(pricer);
        uint256 earmark = _agent(pricer).earmarkedBalance;
        uint256 total = roster.totalEarmarked();

        vm.prank(owner);
        roster.revokeAgent(pricer);

        assertEq(usdc.balanceOf(pricer), agentBalance, "already-released funds stay put");
        assertEq(_agent(pricer).earmarkedBalance, earmark, "the earmark is untouched");
        assertEq(roster.totalEarmarked(), total);
    }

    /// Revoking twice is a no-op rather than a revert — an owner hitting the kill switch again
    /// under pressure should not be shown an error.
    function test_IsIdempotent() public {
        vm.startPrank(owner);
        roster.revokeAgent(pricer);
        roster.revokeAgent(pricer);
        vm.stopPrank();

        assertFalse(_agent(pricer).active);
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_ARevokedAgentAttemptsToSpend() public {
        vm.prank(owner);
        roster.revokeAgent(pricer);

        vm.prank(pricer);
        vm.expectRevert(IRoster.AgentNotActive.selector);
        roster.executeSpend(1 * USD, payee, MEMO);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.revokeAgent(pricer);
    }

    /// Not even the agent itself — this is the owner's control, not a resignation.
    function test_RevertWhen_TheAgentRevokesItself() public {
        vm.prank(pricer);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.revokeAgent(pricer);
    }

    function test_RevertWhen_TheAgentIsUnknown() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.UnknownAgent.selector);
        roster.revokeAgent(stranger);
    }
}
