// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RosterFactory} from "../src/RosterFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Enumeration for the dashboard: which teams exist, and which belong to whom. Read-only — the
/// factory records what it deployed and nothing else.
contract RosterFactory_RostersOf_Test is Test {
    MockUSDC internal usdc;
    RosterFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal nobody = makeAddr("nobody");

    function setUp() public {
        usdc = new MockUSDC();
        factory = new RosterFactory(address(usdc));
    }

    function test_IsEmptyForAnOwnerWithNoRosters() public view {
        assertEq(factory.rostersOf(nobody).length, 0);
    }

    /// One owner's list never picks up another's.
    function test_DoesNotLeakBetweenOwners() public {
        factory.createRoster(alice);

        assertEq(factory.rostersOf(bob).length, 0);
        assertEq(factory.rostersOf(nobody).length, 0);
    }

    function test_TracksRostersPerOwnerOldestFirst() public {
        address first = factory.createRoster(alice);
        address second = factory.createRoster(alice);
        address bobs = factory.createRoster(bob);

        address[] memory alices = factory.rostersOf(alice);
        assertEq(alices.length, 2);
        assertEq(alices[0], first, "oldest first");
        assertEq(alices[1], second);

        assertEq(factory.rostersOf(bob).length, 1);
        assertEq(factory.rostersOf(bob)[0], bobs);
    }
}
