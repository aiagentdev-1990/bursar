// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RosterFactory} from "../src/RosterFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// How many teams this factory has deployed, across every owner.
contract RosterFactory_RosterCount_Test is Test {
    RosterFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        factory = new RosterFactory(address(new MockUSDC()));
    }

    function test_IsZeroBeforeAnyRosterIsCreated() public view {
        assertEq(factory.rosterCount(), 0);
    }

    function test_CountsEveryRosterAcrossOwners() public {
        factory.createRoster(alice);
        factory.createRoster(alice);
        factory.createRoster(bob);

        assertEq(factory.rosterCount(), 3);
    }

    function test_IncrementsByOnePerCreation() public {
        for (uint256 i = 1; i <= 3; i++) {
            factory.createRoster(alice);
            assertEq(factory.rosterCount(), i);
        }
    }
}
