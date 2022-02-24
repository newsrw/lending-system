// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

interface IVaultConfig {
    function collateralFactor(address _vault, address _user)
        external
        view
        returns (uint256);

    function interestPerSecond(address _vault) external view returns (uint256);

    function minDebtSize(address _vault) external view returns (uint256);
}
