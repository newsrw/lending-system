// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "../libraries/MyConversion.sol";

/// @title Clerk contract interface for managing the fund, as well as yield farming
interface IClerk {
    event LogDeposit(
        IERC20Upgradeable indexed token,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 share
    );
    event LogWithdraw(
        IERC20Upgradeable indexed token,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 share
    );
    event LogTransfer(
        IERC20Upgradeable indexed token,
        address indexed from,
        address indexed to,
        uint256 share
    );

    event LogWhiteListMarket(address indexed market, bool approved);
    event LogTokenToMarkets(
        address indexed market,
        address indexed token,
        bool approved
    );

    function balanceOf(IERC20Upgradeable, address)
        external
        view
        returns (uint256);

    function deposit(
        IERC20Upgradeable token_,
        address from,
        address to,
        uint256 amount,
        uint256 share
    ) external returns (uint256 amountOut, uint256 shareOut);

    function toAmount(
        IERC20Upgradeable token,
        uint256 share,
        bool roundUp
    ) external view returns (uint256 amount);

    function toShare(
        IERC20Upgradeable token,
        uint256 amount,
        bool roundUp
    ) external view returns (uint256 share);

    function totals(IERC20Upgradeable)
        external
        view
        returns (Conversion memory _totals);

    function transfer(
        IERC20Upgradeable token,
        address from,
        address to,
        uint256 share
    ) external;

    function whitelistMarket(address market, bool approved) external;

    function whitelistedMarkets(address) external view returns (bool);

    function withdraw(
        IERC20Upgradeable token_,
        address from,
        address to,
        uint256 amount,
        uint256 share
    ) external returns (uint256 amountOut, uint256 shareOut);
}
