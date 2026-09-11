// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// §4.3. The owner's approval *is* the signature — there is no second confirmation, which is
/// exactly what the pending screen's consequence callout tells them.
contract Roster_ApprovePending_Test is RosterTestBase {
    uint256 internal constant OVER_CAP = 120 * USD;
    uint256 internal requestId;

    function setUp() public override {
        super.setUp();
        requestId = _hold(pricer, OVER_CAP);
    }

    function test_ReleasesTheFundsToTheAgentsWallet() public {
        vm.prank(owner);
        roster.approvePending(requestId);

        assertEq(usdc.balanceOf(pricer), OVER_CAP);
        assertEq(_balance(), TREASURY - OVER_CAP, "drawn from the shared balance");
    }

    /// The approval overrides the cap for this one payment, but the spend still counts against
    /// the period — otherwise the cap would mean nothing after the first approval. This is the
    /// figure the pending screen shows as "monthly cap after".
    function test_ChargesThePeriodEvenThoughItWasOverCap() public {
        vm.prank(owner);
        roster.approvePending(requestId);

        assertEq(_agent(pricer).periodSpend, OVER_CAP);
    }

    /// Approving can legitimately push period spend past the period cap. That is the owner's
    /// decision, and the arithmetic must not break on the next spend attempt.
    function test_CanPushPeriodSpendPastThePeriodCap() public {
        uint256 second = _hold(pricer, PRICER_PER_PERIOD + 50 * USD);

        vm.prank(owner);
        roster.approvePending(second);

        assertGt(_agent(pricer).periodSpend, PRICER_PER_PERIOD);

        (bool executed,) = _spend(pricer, 1);
        assertFalse(executed, "still over the period cap, and no revert");
    }

    function test_ClosesTheRequest() public {
        vm.prank(owner);
        roster.approvePending(requestId);

        assertFalse(roster.getPendingRequest(requestId).open);
    }

    /// Approval fires SpendExecuted as well as PendingApproved (§4.3's diagram). That is exactly
    /// why the backend sends the Claude session event itself instead of inferring it from the
    /// stream — §4.2's ordinary path fires SpendExecuted too. Cause before effect, so a feed
    /// built by replaying logs reads in the right order.
    function test_EmitsPendingApprovedThenSpendExecuted() public {
        vm.expectEmit(true, true, false, true, address(roster));
        emit IRoster.PendingApproved(requestId, pricer, OVER_CAP);
        vm.expectEmit(true, true, false, true, address(roster));
        emit IRoster.SpendExecuted(pricer, payee, OVER_CAP, MEMO);

        vm.prank(owner);
        roster.approvePending(requestId);
    }

    /// Approving one request leaves every other one open and unfunded.
    function test_LeavesOtherOpenRequestsAlone() public {
        uint256 other = _hold(concierge, CONCIERGE_PER_TX + 1);

        vm.prank(owner);
        roster.approvePending(requestId);

        assertTrue(roster.getPendingRequest(other).open);
        assertEq(usdc.balanceOf(concierge), 0);
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_AlreadyApproved() public {
        vm.startPrank(owner);
        roster.approvePending(requestId);

        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.approvePending(requestId);
        vm.stopPrank();
    }

    function test_RevertWhen_TheRequestIdIsUnknown() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.RequestNotOpen.selector);
        roster.approvePending(999);
    }

    /// Revocation has to beat an outstanding approval, or the kill switch has a hole in it: an
    /// agent revoked with a request already in flight could still be paid.
    function test_RevertWhen_TheAgentIsRevoked() public {
        vm.startPrank(owner);
        roster.revokeAgent(pricer);

        vm.expectRevert(IRoster.AgentNotActive.selector);
        roster.approvePending(requestId);
        vm.stopPrank();

        assertEq(usdc.balanceOf(pricer), 0, "no funds escape a revoked agent");
    }

    /// The request survives the failed approval, so the owner can add money and approve again.
    function test_RevertWhen_TheBalanceNoLongerCoversIt_AndTheRequestStaysOpen() public {
        vm.startPrank(owner);
        roster.withdrawTreasury(owner, TREASURY - OVER_CAP + 1);

        vm.expectRevert(IRoster.InsufficientBalance.selector);
        roster.approvePending(requestId);
        vm.stopPrank();

        assertTrue(roster.getPendingRequest(requestId).open, "still waiting for the owner");

        usdc.mint(address(roster), 1);
        vm.prank(owner);
        roster.approvePending(requestId);
        assertEq(usdc.balanceOf(pricer), OVER_CAP);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.approvePending(requestId);
    }

    /// Notably including the agent that raised it — no self-approval.
    function test_RevertWhen_TheRequestingAgentApprovesItsOwn() public {
        vm.prank(pricer);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.approvePending(requestId);
    }
}
