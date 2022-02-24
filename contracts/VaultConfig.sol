// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IVaultConfig.sol";

contract VaultConfig is IVaultConfig, OwnableUpgradeable {
    /// @notice Events
    event LogSetConfig(
        address _caller,
        address indexed _market,
        uint64 _collateralFactor,
        uint256 _minDebtSize,
        uint256 _interestPerSecond
    );

    /// @notice Config for the Vaults
    struct Config {
        uint64 collateralFactor;
        uint256 minDebtSize;
        uint256 interestPerSecond;
    }

    mapping(address => Config) public configs;

    /// @notice The constructor is only used for the initial master contract.
    /// Subsequent clones are initialised via `init`.
    function initialize() external initializer {
        OwnableUpgradeable.__Ownable_init();
    }

    /// @notice Return the collateralFactor of the given market
    /// @param _vault The market address
    function collateralFactor(
        address _vault,
        address /* _user */
    ) external view returns (uint256) {
        return uint256(configs[_vault].collateralFactor);
    }

    /// @notice Return interestPerSecond of the given market
    /// @param _vault The market address
    function interestPerSecond(address _vault) external view returns (uint256) {
        return configs[_vault].interestPerSecond;
    }

    /// @notice Return the minDebtSize of the given market
    /// @param _vault The market address
    function minDebtSize(address _vault) external view returns (uint256) {
        return uint256(configs[_vault].minDebtSize);
    }

    /// @notice Set the config for markets
    /// @param _markets The markets addresses
    /// @param _configs Configs for each market
    function setConfig(address[] calldata _markets, Config[] calldata _configs)
        external
        onlyOwner
    {
        uint256 _len = _markets.length;
        require(_len == _configs.length, "bad len");
        for (uint256 i = 0; i < _len; i++) {
            require(_markets[i] != address(0), "bad market");
            require(
                _configs[i].collateralFactor >= 5000 &&
                    _configs[i].collateralFactor <= 9500,
                "bad collateralFactor"
            );

            configs[_markets[i]] = Config({
                collateralFactor: _configs[i].collateralFactor,
                minDebtSize: _configs[i].minDebtSize,
                interestPerSecond: _configs[i].interestPerSecond
            });
            emit LogSetConfig(
                msg.sender,
                _markets[i],
                _configs[i].collateralFactor,
                _configs[i].minDebtSize,
                _configs[i].interestPerSecond
            );
        }
    }
}
