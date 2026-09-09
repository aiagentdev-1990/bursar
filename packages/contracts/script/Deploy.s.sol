// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {RosterFactory} from "../src/RosterFactory.sol";
import {Roster} from "../src/Roster.sol";

/// @notice Deploys the factory (which deploys and locks the Roster implementation) and creates
///         the first team for the demo owner.
///
///         forge script script/Deploy.s.sol:Deploy --rpc-url arc_testnet --broadcast
contract Deploy is Script {
    /// Arc's USDC predeploy. Also the native gas asset, so one balance covers fees too.
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        address owner = vm.envAddress("ROSTER_OWNER_ADDRESS");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        RosterFactory factory = new RosterFactory(usdc);
        address roster = factory.createRoster(owner);

        vm.stopBroadcast();

        console2.log("USDC:                 ", usdc);
        console2.log("RosterFactory:        ", address(factory));
        console2.log("Roster implementation:", factory.implementation());
        console2.log("Roster (owner's team):", roster);
        console2.log("Owner:                ", Roster(roster).owner());
        console2.log("");
        console2.log("Set in .env: ROSTER_FACTORY_ADDRESS and ROSTER_CONTRACT_ADDRESS");
    }
}
