// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Roster} from "../../src/Roster.sol";
import {RosterFactory} from "../../src/RosterFactory.sol";
import {IRoster} from "../../src/IRoster.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// Shared fixture for the per-function test files.
///
/// Every suite runs against a Roster deployed the way production deploys one — a clone from
/// RosterFactory, not a bare `new Roster()`. If initialization through the proxy ever broke,
/// every file would fail rather than none.
abstract contract RosterTestBase is Test {
    MockUSDC internal usdc;
    RosterFactory internal factory;
    Roster internal roster;

    address internal owner = makeAddr("owner");
    address internal pricer = makeAddr("pricer");
    address internal concierge = makeAddr("concierge");
    address internal payee = makeAddr("chrono24");
    address internal stranger = makeAddr("stranger");

    /// USDC is 6 decimals. Never a float, anywhere in the stack.
    uint256 internal constant USD = 1e6;

    // Mockup figures, so the tests and the dashboard describe the same roster.
    uint256 internal constant PRICER_PER_TX = 10 * USD;
    uint256 internal constant PRICER_PER_PERIOD = 400 * USD;
    uint256 internal constant CONCIERGE_PER_TX = 25 * USD;
    uint256 internal constant CONCIERGE_PER_PERIOD = 150 * USD;

    /// The one balance every agent on the roster spends from.
    uint256 internal constant TREASURY = 10_000 * USD;

    bytes internal constant MEMO = bytes("Comparable sold-listing pull");

    function setUp() public virtual {
        usdc = new MockUSDC();
        factory = new RosterFactory(address(usdc));
        roster = Roster(factory.createRoster(owner));

        vm.startPrank(owner);
        roster.hireAgent(pricer, PRICER_PER_TX, PRICER_PER_PERIOD, "Comparable-listing research");
        roster.hireAgent(concierge, CONCIERGE_PER_TX, CONCIERGE_PER_PERIOD, "Buyer questions and offers");
        vm.stopPrank();

        // Funding is a plain transfer to the Roster address (§4.6). There is no allocation step:
        // both agents spend from this balance as soon as it lands.
        usdc.mint(address(roster), TREASURY);
    }

    function _balance() internal view returns (uint256) {
        return usdc.balanceOf(address(roster));
    }

    // ─── helpers ──────────────────────────────────────────────────────────────

    /// The §4.2 path: the agent calls for itself, with no owner signature anywhere.
    function _spend(address agent, uint256 amount) internal returns (bool executed, uint256 requestId) {
        vm.prank(agent);
        return roster.executeSpend(amount, payee, MEMO);
    }

    /// Drives an agent to a held request and returns its id.
    function _hold(address agent, uint256 amount) internal returns (uint256 requestId) {
        bool executed;
        (executed, requestId) = _spend(agent, amount);
        assertFalse(executed, "fixture expected this spend to be held");
    }

    /// Spends the whole period cap in per-transaction-sized bites.
    function _exhaustPeriod(address agent, uint256 perTx, uint256 perPeriod) internal {
        for (uint256 spent = 0; spent < perPeriod; spent += perTx) {
            (bool executed,) = _spend(agent, perTx);
            assertTrue(executed, "fixture expected an in-cap spend to execute");
        }
    }

    function _agent(address agent) internal view returns (IRoster.AgentInfo memory) {
        return roster.getAgent(agent);
    }
}
