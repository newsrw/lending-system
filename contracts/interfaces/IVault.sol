// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/// @title Vault interface
interface IVault {
    function withdrawSurplus() external returns (uint256, uint256);

    function userDebtShare(address _user) external view returns (uint256);

    function repay(address _for, uint256 _maxDebtValue)
        external
        returns (uint256);

    function collateralPrice() external view returns (uint256);

    function collateral() external view returns (IERC20Upgradeable);

    function deposit(
        IERC20Upgradeable _token,
        address _to,
        uint256 _collateralAmount
    ) external;

    function withdraw(
        IERC20Upgradeable _token,
        address _to,
        uint256 _collateralAmount
    ) external;
}
