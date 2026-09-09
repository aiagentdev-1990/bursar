// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RosterFactory} from "../src/RosterFactory.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Positional access to every roster the factory has deployed.
contract RosterFactory_RosterAt_Test is Test {
    RosterFactory internal factory;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        factory = new RosterFactory(address(new MockUSDC()));
    }

    function test_IndexesEveryRosterInDeploymentOrder() public {
        address first = factory.createRoster(alice);
        address second = factory.createRoster(bob);

        assertEq(factory.rosterAt(0), first);
        assertEq(factory.rosterAt(1), second);
    }

    /// Ordering is global, not per owner — two owners interleaved keep their deployment order.
    function test_OrderingSpansOwners() public {
        address alicesFirst = factory.createRoster(alice);
        address bobs = factory.createRoster(bob);
        address alicesSecond = factory.createRoster(alice);

        assertEq(factory.rosterAt(0), alicesFirst);
        assertEq(factory.rosterAt(1), bobs);
        assertEq(factory.rosterAt(2), alicesSecond);
    }

    function test_RevertWhen_TheIndexIsOutOfRange() public {
        factory.createRoster(alice);

        vm.expectRevert();
        factory.rosterAt(1);
    }

    function test_RevertWhen_ThereAreNoRosters() public {
        vm.expectRevert();
        factory.rosterAt(0);
    }
}
