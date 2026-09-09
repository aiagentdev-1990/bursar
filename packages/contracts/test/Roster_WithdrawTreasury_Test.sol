// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// The exit. Before this existed, USDC delivered to a Roster but never earmarked was locked in
/// it forever — and §4.6's whole funding rail delivers to this address.
contract Roster_WithdrawTreasury_Test is RosterTestBase {
    /// The fixture mints TREASURY and earmarks EARMARK * 2; the rest is unallocated.
    uint256 internal constant UNALLOCATED = TREASURY - EARMARK * 2;

    function test_SendsUnallocatedUsdcToTheGivenAddress() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, UNALLOCATED);

        assertEq(usdc.balanceOf(owner), UNALLOCATED);
        assertEq(usdc.balanceOf(address(roster)), TREASURY - UNALLOCATED);
    }

    function test_EmitsTreasuryWithdrawn() public {
        vm.expectEmit(true, false, false, true, address(roster));
        emit IRoster.TreasuryWithdrawn(owner, UNALLOCATED);

        vm.prank(owner);
        roster.withdrawTreasury(owner, UNALLOCATED);
    }

    function test_DoesNotChangeAnyEarmark() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, UNALLOCATED);

        assertEq(_agent(pricer).earmarkedBalance, EARMARK);
        assertEq(_agent(concierge).earmarkedBalance, EARMARK);
        assertEq(roster.totalEarmarked(), EARMARK * 2);
    }

    /// The invariant this function must never break: every agent keeps what it was promised, so
    /// an in-cap spend still works after the owner has drained everything unallocated.
    function test_EveryEarmarkIsStillSpendableAfterADrain() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, UNALLOCATED);

        (bool executed,) = _spend(pricer, PRICER_PER_TX);
        assertTrue(executed);
        assertEq(usdc.balanceOf(pricer), PRICER_PER_TX);
    }

    function test_CanWithdrawToAThirdParty() public {
        vm.prank(owner);
        roster.withdrawTreasury(stranger, 100 * USD);

        assertEq(usdc.balanceOf(stranger), 100 * USD);
    }

    /// Defunding an agent makes its budget withdrawable — the two halves of the fix together.
    function test_DefundedBudgetBecomesWithdrawable() public {
        vm.startPrank(owner);
        roster.defundAgent(pricer, EARMARK);
        roster.withdrawTreasury(owner, UNALLOCATED + EARMARK);
        vm.stopPrank();

        assertEq(usdc.balanceOf(owner), UNALLOCATED + EARMARK);
        assertEq(usdc.balanceOf(address(roster)), EARMARK, "only the other agent's earmark left");
    }

    function test_WithdrawingExactlyTheUnallocatedBalanceSucceeds() public {
        vm.prank(owner);
        roster.withdrawTreasury(owner, UNALLOCATED);

        assertEq(usdc.balanceOf(address(roster)), roster.totalEarmarked(), "nothing spare remains");
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    /// The whole point: an earmark cannot be withdrawn out from under an agent.
    function test_RevertWhen_WithdrawingOneBaseUnitPastTheUnallocatedBalance() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.InsufficientTreasury.selector);
        roster.withdrawTreasury(owner, UNALLOCATED + 1);
    }

    function test_RevertWhen_WithdrawingAnEarmarkedBalance() public {
        vm.startPrank(owner);
        roster.withdrawTreasury(owner, UNALLOCATED);

        vm.expectRevert(IRoster.InsufficientTreasury.selector);
        roster.withdrawTreasury(owner, 1);
        vm.stopPrank();
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.withdrawTreasury(stranger, 1);
    }

    function test_RevertWhen_TheDestinationIsTheZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.ZeroAddress.selector);
        roster.withdrawTreasury(address(0), 1);
    }
}
