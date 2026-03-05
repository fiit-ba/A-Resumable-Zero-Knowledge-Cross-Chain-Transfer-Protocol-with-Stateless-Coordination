// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISnarkVerifier {
    function verify(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c, uint256[] calldata input)
        external
        view
        returns (bool);
}
