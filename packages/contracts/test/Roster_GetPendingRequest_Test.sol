// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// What the pending-approval screen renders: amount, payee, purpose, and who asked.
contract Roster_GetPendingRequest_Test is RosterTestBase {
    uint256 internal constant OVER_CAP = 120 * USD;

    function test_ReturnsTheHeldRequest() public {
        uint256 requestId = _hold(pricer, OVER_CAP);

        IRoster.PendingRequest memory request = roster.getPendingRequest(requestId);
        assertEq(request.agent, pricer);
        assertEq(request.payee, payee);
        assertEq(request.amount, OVER_CAP);
        assertEq(request.memo, MEMO);
        assertTrue(request.open);
    }

    /// An unknown id reads as an empty, closed request — `open` false is what callers branch on.
    function test_ReturnsAnEmptyClosedRequestForAnUnknownId() public view {
        IRoster.PendingRequest memory request = roster.getPendingRequest(999);

        assertEq(request.agent, address(0));
        assertEq(request.amount, 0);
        assertFalse(request.open);
    }

    /// A settled request is readable forever — the details survive so the activity log can show
    /// what was approved, not just that something was.
    function test_KeepsTheDetailsAfterApproval() public {
        uint256 requestId = _hold(pricer, OVER_CAP);

        vm.prank(owner);
        roster.approvePending(requestId);

        IRoster.PendingRequest memory request = roster.getPendingRequest(requestId);
        assertFalse(request.open);
        assertEq(request.agent, pricer);
        assertEq(request.amount, OVER_CAP);
        assertEq(request.memo, MEMO);
    }

    function test_KeepsTheDetailsAfterRejection() public {
        uint256 requestId = _hold(pricer, OVER_CAP);

        vm.prank(owner);
        roster.rejectPending(requestId);

        IRoster.PendingRequest memory request = roster.getPendingRequest(requestId);
        assertFalse(request.open);
        assertEq(request.amount, OVER_CAP);
    }

    /// Requests from different agents stay distinct under their own ids.
    function test_TracksRequestsFromDifferentAgentsSeparately() public {
        uint256 first = _hold(pricer, OVER_CAP);
        uint256 second = _hold(concierge, CONCIERGE_PER_TX + 1);

        assertEq(roster.getPendingRequest(first).agent, pricer);
        assertEq(roster.getPendingRequest(second).agent, concierge);
        assertTrue(first != second);
    }
}
