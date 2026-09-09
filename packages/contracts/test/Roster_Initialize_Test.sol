// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Roster} from "../src/Roster.sol";
import {IRoster} from "../src/IRoster.sol";
import {RosterTestBase} from "./base/RosterTestBase.sol";

/// `initialize` replaces a constructor, which a minimal proxy cannot run. Everything here is
/// about the two ways that goes wrong: a clone claimed twice, or an implementation left unowned.
contract Roster_Initialize_Test is RosterTestBase {
    function test_SetsTheOwnerSuppliedByTheFactory() public view {
        assertEq(roster.owner(), owner);
    }

    /// PERIOD_LENGTH is a constant, not per-agent state, so it is identical on every Roster.
    function test_PeriodLengthIsThirtyDays() public view {
        assertEq(roster.PERIOD_LENGTH(), 30 days);
    }

    function test_EmitsRosterInitialized() public {
        // A fresh clone, so the event is observable — the fixture's roster is already past this.
        vm.expectEmit(true, false, false, false);
        emit IRoster.RosterInitialized(stranger);
        factory.createRoster(stranger);
    }

    function test_RevertWhen_AlreadyInitialized() public {
        vm.expectRevert(IRoster.AlreadyInitialized.selector);
        roster.initialize(stranger);
    }

    /// Not even by the current owner — initialization is not an ownership transfer.
    function test_RevertWhen_CalledAgainByTheOwner() public {
        vm.prank(owner);
        vm.expectRevert(IRoster.AlreadyInitialized.selector);
        roster.initialize(stranger);
    }

    /// An implementation left initializable is an unowned contract anyone can claim, and every
    /// clone delegatecalls into it. Its constructor claims it, so this reverts.
    function test_RevertWhen_InitializingTheImplementation() public {
        Roster implementation = Roster(factory.implementation());

        vm.expectRevert(IRoster.AlreadyInitialized.selector);
        implementation.initialize(stranger);
    }

    function test_RevertWhen_TheOwnerIsTheZeroAddress() public {
        vm.expectRevert(IRoster.ZeroAddress.selector);
        factory.createRoster(address(0));
    }
}
