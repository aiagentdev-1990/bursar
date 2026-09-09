// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// §4.1. One step: an address, two caps, a role label. The caps bind from the first transaction.
contract Roster_HireAgent_Test is RosterTestBase {
    string internal constant ROLE = "One-off task payouts";
    uint256 internal constant PER_TX = 75 * USD;
    uint256 internal constant PER_PERIOD = 900 * USD;

    function test_RegistersTheAgentWithBothCapsAndItsRole() public {
        vm.prank(owner);
        roster.hireAgent(stranger, PER_TX, PER_PERIOD, ROLE);

        IRoster.AgentInfo memory info = _agent(stranger);
        assertEq(info.perTxCap, PER_TX);
        assertEq(info.perPeriodCap, PER_PERIOD);
        assertEq(info.role, ROLE);
        assertTrue(info.registered);
        assertTrue(info.active);
    }

    /// A new agent starts with a clean period and nothing earmarked. Funding is a separate step.
    function test_StartsWithAZeroedPeriodAndNoBalance() public {
        vm.prank(owner);
        roster.hireAgent(stranger, PER_TX, PER_PERIOD, ROLE);

        IRoster.AgentInfo memory info = _agent(stranger);
        assertEq(info.periodSpend, 0);
        assertEq(info.earmarkedBalance, 0);
        assertEq(info.periodStart, block.timestamp, "the period is anchored to the hire");
    }

    function test_EmitsAgentRegistered() public {
        vm.expectEmit(true, false, false, true, address(roster));
        emit IRoster.AgentRegistered(stranger, PER_TX, PER_PERIOD, ROLE);

        vm.prank(owner);
        roster.hireAgent(stranger, PER_TX, PER_PERIOD, ROLE);
    }

    /// The caps are live immediately — there is no arming step between hiring and enforcement.
    function test_CapsBindOnTheVeryFirstSpend() public {
        vm.startPrank(owner);
        roster.hireAgent(stranger, PER_TX, PER_PERIOD, ROLE);
        roster.fundAgent(stranger, 500 * USD);
        vm.stopPrank();

        (bool overCap,) = _spend(stranger, PER_TX + 1);
        assertFalse(overCap, "one base unit over holds on the first transaction");

        (bool inCap,) = _spend(stranger, PER_TX);
        assertTrue(inCap);
    }

    /// Hiring touches one struct. The agents already on the roster are untouched.
    function test_DoesNotDisturbTheExistingRoster() public {
        IRoster.AgentInfo memory before = _agent(pricer);

        vm.prank(owner);
        roster.hireAgent(stranger, PER_TX, PER_PERIOD, ROLE);

        IRoster.AgentInfo memory after_ = _agent(pricer);
        assertEq(after_.perTxCap, before.perTxCap);
        assertEq(after_.perPeriodCap, before.perPeriodCap);
        assertEq(after_.earmarkedBalance, before.earmarkedBalance);
        assertEq(after_.periodStart, before.periodStart);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.hireAgent(stranger, PER_TX, PER_PERIOD, ROLE);
    }

    function test_RevertWhen_TheAgentIsAlreadyRegistered() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.AgentAlreadyRegistered.selector);
        roster.hireAgent(pricer, PER_TX, PER_PERIOD, "duplicate");
    }

    /// A revoked agent is still registered, so re-hiring would silently reset its caps and its
    /// period. Re-activating one is deliberately not something this contract does.
    function test_RevertWhen_RehiringARevokedAgent() public {
        vm.startPrank(owner);
        roster.revokeAgent(pricer);

        vm.expectRevert(IRoster.AgentAlreadyRegistered.selector);
        roster.hireAgent(pricer, PER_TX, PER_PERIOD, "back again");
        vm.stopPrank();
    }

    function test_RevertWhen_EitherCapIsZero() public {
        vm.startPrank(owner);
        vm.expectRevert(IRoster.ZeroCap.selector);
        roster.hireAgent(stranger, 0, PER_PERIOD, ROLE);

        vm.expectRevert(IRoster.ZeroCap.selector);
        roster.hireAgent(stranger, PER_TX, 0, ROLE);
        vm.stopPrank();
    }

    function test_RevertWhen_TheAgentIsTheZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.ZeroAddress.selector);
        roster.hireAgent(address(0), PER_TX, PER_PERIOD, ROLE);
    }
}
