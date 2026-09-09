// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Roster} from "../src/Roster.sol";
import {RosterFactory} from "../src/RosterFactory.sol";
import {IRoster} from "../src/IRoster.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// One Roster is one owner's team. This function's job is to make that separation real: two
/// teams share an implementation and nothing else.
contract RosterFactory_CreateRoster_Test is Test {
    MockUSDC internal usdc;
    RosterFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal sharedAgent = makeAddr("sharedAgent");
    address internal payee = makeAddr("payee");

    uint256 internal constant USD = 1e6;

    function setUp() public {
        usdc = new MockUSDC();
        factory = new RosterFactory(address(usdc));
    }

    function test_SetsTheOwnerAndEmits() public {
        vm.expectEmit(false, true, false, false, address(factory));
        emit RosterFactory.RosterCreated(address(0), alice);

        address created = factory.createRoster(alice);

        assertEq(Roster(created).owner(), alice);
    }

    /// A minimal proxy is 45 bytes; the implementation is not. Cheap teams are the whole point.
    function test_DeploysAMinimalProxyOverTheSharedImplementation() public {
        address first = factory.createRoster(alice);
        address second = factory.createRoster(bob);

        assertTrue(first != second);
        assertTrue(first != factory.implementation());
        assertEq(first.code.length, 45);
        assertLt(first.code.length, factory.implementation().code.length);
    }

    /// The multi-tenant version of the isolation guarantee: the same agent address on two
    /// different teams, revoked on one, still working on the other.
    function test_TwoRostersHaveFullyIndependentState() public {
        Roster alices = Roster(factory.createRoster(alice));
        Roster bobs = Roster(factory.createRoster(bob));

        vm.prank(alice);
        alices.hireAgent(sharedAgent, 10 * USD, 100 * USD, "Alice's researcher");
        vm.prank(bob);
        bobs.hireAgent(sharedAgent, 50 * USD, 900 * USD, "Bob's fulfiller");

        usdc.mint(address(alices), 500 * USD);
        usdc.mint(address(bobs), 500 * USD);
        vm.prank(alice);
        alices.fundAgent(sharedAgent, 100 * USD);
        vm.prank(bob);
        bobs.fundAgent(sharedAgent, 500 * USD);

        // Caps do not leak across teams.
        assertEq(alices.getAgent(sharedAgent).perTxCap, 10 * USD);
        assertEq(bobs.getAgent(sharedAgent).perTxCap, 50 * USD);

        vm.prank(alice);
        alices.revokeAgent(sharedAgent);

        vm.prank(sharedAgent);
        vm.expectRevert(IRoster.AgentNotActive.selector);
        alices.executeSpend(1 * USD, payee, "");

        vm.prank(sharedAgent);
        (bool executed,) = bobs.executeSpend(50 * USD, payee, "");
        assertTrue(executed, "revocation on one team must not reach another");
        assertTrue(bobs.getAgent(sharedAgent).active);
    }

    /// Each clone keeps its own treasury: USDC sent to one is invisible to the other.
    function test_TreasuriesAreSeparate() public {
        Roster alices = Roster(factory.createRoster(alice));
        Roster bobs = Roster(factory.createRoster(bob));

        vm.prank(alice);
        alices.hireAgent(sharedAgent, 10 * USD, 100 * USD, "Alice's researcher");
        vm.prank(bob);
        bobs.hireAgent(sharedAgent, 10 * USD, 100 * USD, "Bob's researcher");

        usdc.mint(address(alices), 100 * USD);

        vm.prank(alice);
        alices.fundAgent(sharedAgent, 100 * USD);

        vm.prank(bob);
        vm.expectRevert(IRoster.InsufficientTreasury.selector);
        bobs.fundAgent(sharedAgent, 1);
    }

    /// The factory is permissionless: the backend calls it on an owner's behalf, and the owner it
    /// names is the only account that can ever act on the result.
    function test_AnyoneCanCreateARosterForSomeoneElse() public {
        vm.prank(bob);
        address created = factory.createRoster(alice);

        assertEq(Roster(created).owner(), alice);

        vm.prank(bob);
        vm.expectRevert(IRoster.NotOwner.selector);
        Roster(created).hireAgent(sharedAgent, 1, 1, "not yours");
    }

    // ─── reverts ──────────────────────────────────────────────────────────────

    function test_RevertWhen_TheOwnerIsTheZeroAddress() public {
        vm.expectRevert(IRoster.ZeroAddress.selector);
        factory.createRoster(address(0));
    }

    /// Alice cannot act on Bob's roster, even though the factory made both.
    function test_RevertWhen_AnotherRostersOwnerActsOnThisOne() public {
        Roster bobs = Roster(factory.createRoster(bob));
        factory.createRoster(alice);

        vm.prank(bob);
        bobs.hireAgent(sharedAgent, 10 * USD, 100 * USD, "Bob's agent");

        vm.prank(alice);
        vm.expectRevert(IRoster.NotOwner.selector);
        bobs.revokeAgent(sharedAgent);

        assertTrue(bobs.getAgent(sharedAgent).active);
    }
}
