// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// The exit. §4.6's funding rail delivers to the Roster address, so without this any USDC sent
/// here would be locked in forever.
///
/// Bounded by the balance and nothing else: a cap is permission to spend, not a claim on funds,
/// so no agent is owed any part of the balance. DECISIONS.md 2026-09-11, "shared pool".
contract Roster_WithdrawTreasury_Test is RosterTestBase {
    function test_SendsUsdcToTheGivenAddress() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, 100 * USD);

        assertEq(usdc.balanceOf(owner), 100 * USD);
        assertEq(_balance(), TREASURY - 100 * USD);
    }

    function test_EmitsTreasuryWithdrawn() public {
        vm.expectEmit(true, false, false, true, address(roster));
        emit IRoster.TreasuryWithdrawn(owner, 100 * USD);

        vm.prank(owner);
        roster.withdrawTreasury(owner, 100 * USD);
    }

    /// The boundary is inclusive: the owner can take everything back.
    function test_CanWithdrawTheWholeBalance() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, TREASURY);

        assertEq(_balance(), 0);
        assertEq(usdc.balanceOf(owner), TREASURY);
    }

    function test_CanWithdrawToAThirdParty() public {
        vm.prank(owner);
        roster.withdrawTreasury(stranger, 100 * USD);

        assertEq(usdc.balanceOf(stranger), 100 * USD);
    }

    /// Withdrawing changes no agent's caps or period — it only changes what there is to spend.
    function test_DoesNotChangeAnyAgent() public {
        _spend(pricer, PRICER_PER_TX);
        IRoster.AgentInfo memory before = _agent(pricer);
        uint256 everything = _balance();

        vm.prank(owner);
        roster.withdrawTreasury(owner, everything);

        IRoster.AgentInfo memory after_ = _agent(pricer);
        assertEq(after_.perTxCap, before.perTxCap);
        assertEq(after_.perPeriodCap, before.perPeriodCap);
        assertEq(after_.periodSpend, before.periodSpend);
        assertTrue(after_.active);
    }

    /// After a full withdrawal an in-cap spend is refused for want of money, not for want of
    /// permission — and adding money back makes the same spend work with no other step.
    function test_AnEmptiedBalanceStopsSpendingUntilMoneyIsAdded() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, TREASURY);

        vm.prank(pricer);
        vm.expectRevert(IRoster.InsufficientBalance.selector);
        roster.executeSpend(PRICER_PER_TX, payee, MEMO);

        usdc.mint(address(roster), PRICER_PER_TX);

        (bool executed,) = _spend(pricer, PRICER_PER_TX);
        assertTrue(executed);
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_WithdrawingOneBaseUnitPastTheBalance() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.InsufficientBalance.selector);
        roster.withdrawTreasury(owner, TREASURY + 1);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.withdrawTreasury(stranger, 1);
    }

    /// Not even an agent can pull from the shared balance except through its own capped spend.
    function test_RevertWhen_AnAgentTriesToWithdraw() public {
        vm.prank(pricer);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.withdrawTreasury(pricer, 1);
    }

    function test_RevertWhen_TheDestinationIsTheZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.ZeroAddress.selector);
        roster.withdrawTreasury(address(0), 1);
    }
}
