// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Roster} from "./Roster.sol";
import {IRoster} from "./IRoster.sol";

/// @title RosterFactory — one Roster per agent team
/// @notice Deploys Rosters as EIP-1167 minimal proxies over a single implementation, so a new
///         team costs a 45-byte deployment instead of a full contract.
///
///         Deliberately not upgradeable. The clones delegatecall a fixed implementation set at
///         factory construction and there is no admin that can swap it. Risk R4 in the PRD is
///         that the contract is the single point of enforcement and therefore the single point
///         of failure; an upgrade path would add a second way for the guarantee to fail — one an
///         owner could not audit by reading the code their agents are bound to.
contract RosterFactory {
    /// @notice The Roster implementation every clone delegatecalls into. Locked at construction.
    address public immutable implementation;

    /// @notice Every Roster this factory has deployed, oldest first.
    address[] private _rosters;
    mapping(address => address[]) private _rostersOf;

    event RosterCreated(address indexed roster, address indexed owner);

    constructor(address usdc) {
        // Constructing the implementation here means it can never be left uninitialized: its
        // constructor claims ownership of itself, so `initialize` on the implementation reverts.
        implementation = address(new Roster(usdc));
    }

    /// @notice Deploy a Roster owned by `owner`. Permissionless — the backend calls this on an
    ///         owner's behalf during onboarding, and the owner it names is the only account that
    ///         can ever act on the result.
    function createRoster(address owner) external returns (address roster) {
        if (owner == address(0)) revert IRoster.ZeroAddress();

        roster = Clones.clone(implementation);
        Roster(roster).initialize(owner);

        _rosters.push(roster);
        _rostersOf[owner].push(roster);

        emit RosterCreated(roster, owner);
    }

    /// @notice Every Roster owned by `owner`, oldest first.
    function rostersOf(address owner) external view returns (address[] memory) {
        return _rostersOf[owner];
    }

    function rosterCount() external view returns (uint256) {
        return _rosters.length;
    }

    function rosterAt(uint256 index) external view returns (address) {
        return _rosters[index];
    }
}
