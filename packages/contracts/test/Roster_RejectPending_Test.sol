// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// §4.3's other half. R6: a held payment is never silently dropped and never force-executed —
/// rejection is an explicit close that moves nothing.
contract Roster_RejectPending_Test is RosterTestBase {
    uint256 internal constant OVER_CAP = 120 * USD;
    uint256 internal requestId;

    function setUp() public override {
        super.setUp();
        requestId = _hold(pricer, OVER_CAP);
    }

    function test_MovesNoFundsAndChargesNothing() public {
        vm.prank(owner);
        roster.rejectPending(requestId);

        assertEq(usdc.balanceOf(pricer), 0);
        assertEq(_agent(pricer).periodSpend, 0);
        assertEq(_balance(), TREASURY);
    }

    function test_ClosesTheRequest() public {
        vm.prank(owner);
        roster.rejectPending(requestId);

        assertFalse(roster.getPendingRequest(requestId).open);
    }

    function test_EmitsPendingRejected() public {
        vm.expectEmit(true, true, false, false, address(roster));
        emit IRoster.PendingRejected(requestId, pricer);

        vm.prank(owner);
        roster.rejectPending(requestId);
    }

    /// Rejection does not disable the agent. It declined one payment, not the hire.
    function test_TheAgentKeepsWorkingAfterwards() public {
        vm.prank(owner);
        roster.rejectPending(requestId);

        (bool executed,) = _spend(pricer, PRICER_PER_TX);
        assertTrue(executed, "a rejected request is not a revocation");
    }

    /// A revoked agent's outstanding request can still be closed out — unlike approval this
    /// releases nothing, so there is no reason to stop the owner tidying up.
    function test_ClosesARevokedAgentsOutstandingRequest() public {
        vm.startPrank(owner);
        roster.revokeAgent(pricer);
        roster.rejectPending(requestId);
        vm.stopPrank();

        assertFalse(roster.getPendingRequest(requestId).open);
        assertEq(usdc.balanceOf(pricer), 0);
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_AlreadyRejected() public {
        vm.startPrank(owner);
        roster.rejectPending(requestId);

        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.rejectPending(requestId);
        vm.stopPrank();
    }

    function test_RevertWhen_ApprovingAfterRejection() public {
        vm.startPrank(owner);
        roster.rejectPending(requestId);

        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.approvePending(requestId);
        vm.stopPrank();

        assertEq(usdc.balanceOf(pricer), 0);
    }

    function test_RevertWhen_RejectingAfterApproval() public {
        vm.startPrank(owner);
        roster.approvePending(requestId);

        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.rejectPending(requestId);
        vm.stopPrank();
    }

    function test_RevertWhen_TheRequestIdIsUnknown() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.rejectPending(999);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.rejectPending(requestId);
    }
}
