// SPDX-License-Identifier: MIT

// This contract stores funds, handles their transfers, supports yield trategies.

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IClerk.sol";
import "./interfaces/IVault.sol";
import "./libraries/MyConversion.sol";

// solhint-disable avoid-low-level-calls
// solhint-disable not-rely-on-time

/// @title Clerk
/// @notice The Clerk is the contract that act like a vault for managing funds.
/// it is also capable of handling loans and strategies.
/// Any funds transfered directly onto the Clerk will be LOST, use the deposit function instead.
contract Clerk is IClerk, OwnableUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using SafeCastUpgradeable for uint256;
    using MyConversion for Conversion;

    uint256 private constant MINIMUM_SHARE_BALANCE = 1000; // To prevent the ratio going off from tiny share

    // Balance per token per address/contract in shares
    mapping(IERC20Upgradeable => mapping(address => uint256))
        public
        override balanceOf;

    // Rebase from amount to share
    mapping(IERC20Upgradeable => Conversion) internal _totals;

    function initialize() public initializer {
        OwnableUpgradeable.__Ownable_init();
    }

    function totals(IERC20Upgradeable _token)
        external
        view
        returns (Conversion memory)
    {
        return _totals[_token];
    }

    /// @dev Helper function to represent an `amount` of `token` in shares.
    /// @param _token The ERC-20 token.
    /// @param _amount The `token` amount.
    /// @param _roundUp If the result `share` should be rounded up.
    /// @return share The token amount represented in shares.
    function toShare(
        IERC20Upgradeable _token,
        uint256 _amount,
        bool _roundUp
    ) external view override returns (uint256 share) {
        share = _totals[_token].toShare(_amount, _roundUp);
    }

    /// @dev Helper function represent shares back into the `token` amount.
    /// @param _token The ERC-20 token.
    /// @param _share The amount of shares.
    /// @param _roundUp If the result should be rounded up.
    /// @return amount The share amount back into native representation.
    function toAmount(
        IERC20Upgradeable _token,
        uint256 _share,
        bool _roundUp
    ) external view override returns (uint256 amount) {
        amount = _totals[_token].toAmount(_share, _roundUp);
    }

    /// @notice Deposit an amount of `token` represented in either `amount` or `share`.
    /// @param _token The ERC-20 token to deposit.
    /// @param _from which account to pull the tokens.
    /// @param _to which account to push the tokens.
    /// @param _amount Token amount in native representation to deposit.
    /// @param _share Token amount represented in shares to deposit. Takes precedence over `amount`.
    /// @return _amountOut The amount deposited.
    /// @return _shareOut The deposited amount repesented in shares.
    function deposit(
        IERC20Upgradeable _token,
        address _from,
        address _to,
        uint256 _amount,
        uint256 _share
    ) public override returns (uint256 _amountOut, uint256 _shareOut) {
        require(
            address(_token) != address(0),
            "Clerk::deposit:: token not set"
        );
        require(_to != address(0), "Clerk::deposit:: to not set"); // To avoid a bad UI from burning funds

        Conversion memory _total = _totals[_token];
        // If a new token gets added, the tokenSupply call checks that this is a deployed contract. Needed for security.
        require(
            _total.amount != 0 || _token.totalSupply() > 0,
            "Clerk::deposit:: No tokens"
        );
        if (_share == 0) {
            // value of the share may be lower than the amount due to rounding, that's ok
            _share = _total.toShare(_amount, false);
            // Any deposit should lead to at least the minimum share balance, otherwise it's ignored (no amount taken)
            if (_total.share + _share.toUint128() < MINIMUM_SHARE_BALANCE) {
                return (0, 0);
            }
        } else {
            // amount may be lower than the value of share due to rounding, in that case, add 1 to amount (Always round up)
            _amount = _total.toAmount(_share, true);
        }
        balanceOf[_token][_to] = balanceOf[_token][_to] + _share;
        _total.share = _total.share + _share.toUint128();
        _total.amount = _total.amount + _amount.toUint128();
        _totals[_token] = _total;

        _token.safeTransferFrom(_from, address(this), _amount);

        emit LogDeposit(_token, _from, _to, _amount, _share);
        _amountOut = _amount;
        _shareOut = _share;
    }

    /// @notice Withdraws an amount of `token` from a user account.
    /// @param _token The ERC-20 token to withdraw.
    /// @param _from which user to pull the tokens.
    /// @param _to which user to push the tokens.
    /// @param _amount of tokens. Either one of `amount` or `share` needs to be supplied.
    /// @param _share Like above, but `share` takes precedence over `amount`.
    function withdraw(
        IERC20Upgradeable _token,
        address _from,
        address _to,
        uint256 _amount,
        uint256 _share
    ) public override returns (uint256 _amountOut, uint256 _shareOut) {
        require(
            address(_token) != address(0),
            "Clerk::withdraw:: token not set"
        );
        require(_to != address(0), "Clerk::withdraw:: to not set"); // To avoid a bad UI from burning funds

        Conversion memory _total = _totals[_token];
        if (_share == 0) {
            // value of the share paid could be lower than the amount paid due to rounding, in that case, add a share (Always round up)
            _share = _total.toShare(_amount, true);
        } else {
            // amount may be lower than the value of share due to rounding, that's ok
            _amount = _total.toAmount(_share, false);
        }

        balanceOf[_token][_from] = balanceOf[_token][_from] - _share;
        _total.amount = _total.amount - _amount.toUint128();
        _total.share = _total.share - _share.toUint128();
        // There have to be at least 1000 shares left to prevent reseting the share/amount ratio (unless it's fully emptied)
        require(
            _total.share >= MINIMUM_SHARE_BALANCE || _total.share == 0,
            "Clerk::withdraw:: cannot empty"
        );
        _totals[_token] = _total;

        _token.safeTransfer(_to, _amount);

        emit LogWithdraw(_token, _from, _to, _amount, _share);
        _amountOut = _amount;
        _shareOut = _share;
    }

    /// @notice Transfer shares from a user account to another one.
    /// @param _token The ERC-20 token to transfer.
    /// @param _from which user to pull the tokens.
    /// @param _to which user to push the tokens.
    /// @param _share The amount of `token` in shares.
    function transfer(
        IERC20Upgradeable _token,
        address _from,
        address _to,
        uint256 _share
    ) public override {
        require(_to != address(0), "Clerk::transfer:: to not set"); // To avoid a bad UI from burning funds

        balanceOf[_token][_from] = balanceOf[_token][_from] - _share;
        balanceOf[_token][_to] = balanceOf[_token][_to] + _share;

        emit LogTransfer(_token, _from, _to, _share);
    }
}
