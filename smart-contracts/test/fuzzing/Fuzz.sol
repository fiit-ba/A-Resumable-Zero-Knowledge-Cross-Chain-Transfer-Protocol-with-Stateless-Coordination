// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ConnectorProperties} from "./properties/ConnectorProperties.sol";

/**
 * @title Fuzz
 * @notice Top-level fuzzing harness combining all handler, postcondition, and
 *         property contracts into a single deployable target.
 *
 * Echidna usage (from smart-contracts/):
 *   FOUNDRY_PROFILE=echidna echidna test/fuzzing/Fuzz.sol \
 *     --contract Fuzz --config echidna-config.yaml
 *
 * Medusa usage (from smart-contracts/):
 *   medusa fuzz --config medusa.json
 *
 * Inheritance chain (innermost → outermost):
 *   FuzzConstants → FuzzSetup → ConnectorPostconditions → ConnectorPreconditions
 *     → ConnectorHandler → ConnectorProperties → Fuzz
 */
contract Fuzz is ConnectorProperties {
    constructor() ConnectorProperties() {}
}
