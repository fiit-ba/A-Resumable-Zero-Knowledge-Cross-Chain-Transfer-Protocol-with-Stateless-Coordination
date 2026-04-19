// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;
import {IMintableERC20} from "../../src/tokens/interfaces/IMintableERC20.sol";
import {IBurnableERC20} from "../../src/tokens/interfaces/IBurnableERC20.sol";
import {IERC20} from "openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CertoraBridgeWrappedToken is IMintableERC20, IBurnableERC20, IERC20 {
    address public immutable CONNECTOR;

    constructor(address connector_) {
        CONNECTOR = connector_;
    }

    function mint(address, uint256) external pure {}

    function burn(uint256) external pure {}

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function totalSupply() external pure returns (uint256) {
        return 0;
    }

    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }
}
