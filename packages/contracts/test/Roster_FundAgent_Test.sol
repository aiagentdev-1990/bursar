// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// §4.6. Earmarks USDC the Roster already holds — Bridge Kit delivers to the Roster address, and
/// this allocates what arrived. It moves no tokens.
contract Roster_FundAgent_Test is RosterTestBase {
    function test_IncreasesTheAgentsEarmarkAndTheRosterTotal() public {
        vm.prank(owner);
        roster.fundAgent(pricer, 500 * USD);

        assertEq(_agent(pricer).earmarkedBalance, EARMARK + 500 * USD);
        assertEq(roster.totalEarmarked(), EARMARK * 2 + 500 * USD);
    }

    /// It allocates; it does not transfer. The Roster's balance is unchanged by funding, and the
    /// agent still holds nothing standing (DECISIONS.md 2026-09-08).
    function test_MovesNoTokens() public {
        uint256 before = usdc.balanceOf(address(roster));

        vm.prank(owner);
        roster.fundAgent(pricer, 500 * USD);

        assertEq(usdc.balanceOf(address(roster)), before, "funding is an allocation, not a transfer");
        assertEq(usdc.balanceOf(pricer), 0, "an agent holds nothing standing");
    }

    function test_EmitsAllowanceFunded() public {
        vm.expectEmit(true, false, false, true, address(roster));
        emit IRoster.AllowanceFunded(pricer, 500 * USD);

        vm.prank(owner);
        roster.fundAgent(pricer, 500 * USD);
    }

    function test_EarmarksAreIsolatedBetweenAgents() public {
        uint256 before = _agent(concierge).earmarkedBalance;

        vm.prank(owner);
        roster.fundAgent(pricer, 500 * USD);

        assertEq(_agent(pricer).earmarkedBalance, EARMARK + 500 * USD);
        assertEq(_agent(concierge).earmarkedBalance, before);
    }

    /// Earmarking exactly the remaining balance is allowed — the boundary is inclusive.
    function test_EarmarkingExactlyTheRemainingBalanceSucceeds() public {
        vm.prank(owner);
        roster.fundAgent(pricer, TREASURY - EARMARK * 2);

        assertEq(roster.totalEarmarked(), TREASURY);
    }

    /// Spending creates no new funding headroom. It debits the balance and the earmark by the
    /// same amount, so `balance - totalEarmarked` is invariant across a spend — which is the
    /// point: the treasury cannot be re-allocated just because an agent used its allowance.
    function test_SpendingDoesNotCreateHeadroom() public {
        vm.prank(owner);
        roster.fundAgent(pricer, TREASURY - EARMARK * 2);
        assertEq(usdc.balanceOf(address(roster)) - roster.totalEarmarked(), 0, "fully allocated");

        _spend(pricer, PRICER_PER_TX);

        assertEq(usdc.balanceOf(address(roster)) - roster.totalEarmarked(), 0, "still fully allocated");
    }

    /// Only USDC actually arriving frees capacity — §4.6's Bridge Kit delivery, or any transfer
    /// to the Roster address.
    function test_ADepositCreatesHeadroom() public {
        vm.prank(owner);
        roster.fundAgent(pricer, TREASURY - EARMARK * 2);

        usdc.mint(address(roster), 250 * USD);

        vm.prank(owner);
        roster.fundAgent(concierge, 250 * USD);

        assertEq(roster.totalEarmarked(), TREASURY + 250 * USD);
    }

    /// Funding a revoked agent is allowed — it is not a spend, and the kill switch is enforced
    /// at `executeSpend`. Topping one up ahead of a deliberate re-hire is the owner's call.
    function test_FundsARevokedAgentWithoutReactivatingIt() public {
        vm.startPrank(owner);
        roster.revokeAgent(pricer);
        roster.fundAgent(pricer, 1 * USD);
        vm.stopPrank();

        assertEq(_agent(pricer).earmarkedBalance, EARMARK + 1 * USD);
        assertFalse(_agent(pricer).active, "funding does not reactivate");
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    /// The guard that matters: the same USDC cannot be promised to two agents. Without it the
    /// second agent's spend would fail at transfer time rather than at the point the owner made
    /// the mistake.
    function test_RevertWhen_TheTreasuryCannotCoverEveryEarmark() public {
        vm.startPrank(owner);
        roster.fundAgent(pricer, TREASURY - EARMARK * 2);
        assertEq(roster.totalEarmarked(), TREASURY);

        vm.expectRevert(IRoster.InsufficientTreasury.selector);
        roster.fundAgent(concierge, 1);
        vm.stopPrank();
    }

    /// The corollary of test_SpendingDoesNotCreateHeadroom.
    function test_RevertWhen_FundingAfterASpendWithNoNewDeposit() public {
        vm.prank(owner);
        roster.fundAgent(pricer, TREASURY - EARMARK * 2);

        _spend(pricer, PRICER_PER_TX);

        vm.prank(owner);
        vm.expectRevert(IRoster.InsufficientTreasury.selector);
        roster.fundAgent(concierge, 1);
    }

    function test_RevertWhen_EarmarkingOneBaseUnitPastTheBalance() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.InsufficientTreasury.selector);
        roster.fundAgent(pricer, TREASURY - EARMARK * 2 + 1);
    }

    function test_RevertWhen_TheCallerIsNotTheOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IRoster.NotOwner.selector);
        roster.fundAgent(pricer, 1);
    }

    function test_RevertWhen_TheAgentIsUnknown() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.UnknownAgent.selector);
        roster.fundAgent(stranger, 1);
    }
}
