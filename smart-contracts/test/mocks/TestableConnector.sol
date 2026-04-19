// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Connector} from "../../src/connectors/Connector.sol";
import {Enums} from "../../src/libs/Enums.sol";

/// @dev Thin wrapper that exposes internal _cleanupTx for coverage-gap tests.
contract TestableConnector is Connector {
    constructor(address risc0_, address snark_, uint64 ackWindow_, bytes32[6] memory imageIds_, address factory_)
        Connector(risc0_, snark_, ackWindow_, imageIds_, factory_)
    {}

    function exposedCleanup(bytes32 txId) external {
        _cleanupTx(txId);
    }

    function exposedExpectedCommitment(
        Enums.VerifierRoute route,
        Enums.ProofType proofType,
        bytes calldata publicInputs
    ) external returns (bytes32) {
        return _expectedCommitment(route, proofType, publicInputs);
    }
}
