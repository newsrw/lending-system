// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

import "./interfaces/IVaultConfig.sol";
import "./interfaces/IClerk.sol";

/// @title Vault - Lending Vault
contract Vault is OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /// @dev Events
    event LogAccrue(uint256 amount);
    event LogAddCollateral(
        address indexed from,
        address indexed to,
        uint256 share
    );
    event LogBorrow(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 part
    );

    /// @dev Constants
    uint256 private constant BPS_PRECISION = 1e4;
    uint256 private constant COLLATERAL_PRICE_PRECISION = 1e18;

    /// @dev Default configuration states.
    /// These configurations are expected to be the same amongs markets.
    IClerk public clerk;
    IERC20Upgradeable public spell;

    /// @dev Market configuration states.
    IERC20Upgradeable public collateral;

    /// @dev Global states of the market
    uint256 public totalCollateralShare;
    uint256 public totalDebtShare;
    uint256 public totalDebtValue;

    /// @dev User's states
    mapping(address => uint256) public userCollateralShare;
    mapping(address => uint256) public userDebtShare;

    /// @dev Price of collateral
    uint256 public collateralPrice;

    /// @dev Interest-related states
    uint256 public lastAccrueTime;

    /// @dev Protocol revenue
    uint256 public surplus;
    uint256 public liquidationFee;

    /// @dev Fee & Risk parameters
    IVaultConfig public marketConfig;

    /// @notice The constructor is only used for the initial master contract.
    /// Subsequent clones are initialised via `init`.
    function initialize(
        IClerk _clerk,
        IERC20Upgradeable _spell,
        IERC20Upgradeable _collateral,
        IVaultConfig _marketConfig
    ) external initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        require(address(_clerk) != address(0), "clerk cannot be address(0)");
        require(address(_spell) != address(0), "spell cannot be address(0)");
        require(
            address(_collateral) != address(0),
            "collateral cannot be address(0)"
        );
        require(
            address(_marketConfig) != address(0),
            "marketConfig cannot be address(0)"
        );

        clerk = _clerk;
        spell = _spell;
        collateral = _collateral;
        marketConfig = _marketConfig;
    }

    /// @notice Accrue interest and realized surplus.
    modifier accrue() {
        // Only accrue interest if there is time diff and there is a debt
        if (block.timestamp > lastAccrueTime) {
            // 1. Findout time diff between this block and update lastAccruedTime
            uint256 _timePast = block.timestamp - lastAccrueTime;
            lastAccrueTime = block.timestamp;

            // 2. If totalDebtValue > 0 then calculate interest
            if (totalDebtValue > 0) {
                // 3. Calculate interest
                uint256 _pendingInterest = (marketConfig.interestPerSecond(
                    address(this)
                ) *
                    totalDebtValue *
                    _timePast) / 1e18;
                totalDebtValue = totalDebtValue + _pendingInterest;

                // 4. Realized surplus
                surplus = surplus + _pendingInterest;

                emit LogAccrue(_pendingInterest);
            }
        }
        _;
    }

    /// @notice Modifier to check if the user is safe from liquidation at the end of function.
    modifier checkSafe() {
        _;
        require(_checkSafe(msg.sender, collateralPrice), "!safe");
    }

    /// @notice Return if true "_user" is safe from liquidation.
    /// @dev Beware of unaccrue interest. accrue is expected to be executed before _isSafe.
    /// @param _user The address to check if it is safe from liquidation.
    /// @param _collateralPrice The exchange rate. Used to cache the `exchangeRate` between calls.
    function _checkSafe(address _user, uint256 _collateralPrice)
        internal
        view
        returns (bool)
    {
        uint256 _collateralFactor = marketConfig.collateralFactor(
            address(this),
            _user
        );

        require(
            _collateralFactor <= 9500 && _collateralFactor >= 5000,
            "bad collateralFactor"
        );

        uint256 _userDebtShare = userDebtShare[_user];
        if (_userDebtShare == 0) return true;
        uint256 _userCollateralShare = userCollateralShare[_user];
        if (_userCollateralShare == 0) return false;

        return
            (clerk.toAmount(collateral, _userCollateralShare, false) *
                _collateralPrice *
                _collateralFactor) /
                BPS_PRECISION >=
            (_userDebtShare * totalDebtValue * COLLATERAL_PRICE_PRECISION) /
                totalDebtShare;
    }

    /// @notice check debt size after an execution
    modifier checkDebtSize() {
        _;
        if (debtShareToValue(userDebtShare[msg.sender]) == 0) return;
        require(
            debtShareToValue(userDebtShare[msg.sender]) >=
                marketConfig.minDebtSize(address(this)),
            "invalid debt size"
        );
    }

    /// @notice Perform actual add collateral
    /// @param _to The address of the user to get the collateral added
    /// @param _share The share of the collateral to be added
    function _addCollateral(address _to, uint256 _share) internal {
        require(
            clerk.balanceOf(collateral, msg.sender) -
                userCollateralShare[msg.sender] >=
                _share,
            "not enough balance to add collateral"
        );

        userCollateralShare[_to] = userCollateralShare[_to] + _share;
        uint256 _oldTotalCollateralShare = totalCollateralShare;
        totalCollateralShare = _oldTotalCollateralShare + _share;

        _addTokens(collateral, _to, _share);

        emit LogAddCollateral(msg.sender, _to, _share);
    }

    /// @notice Adds `collateral` from msg.sender to the account `to`.
    /// @param _to The receiver of the tokens.
    /// @param _amount The amount of collateral to be added to "_to".
    function addCollateral(address _to, uint256 _amount)
        public
        nonReentrant
        accrue
    {
        uint256 _share = clerk.toShare(collateral, _amount, false);
        _addCollateral(_to, _share);
    }

    /// @dev Perform token transfer from msg.sender to _to.
    /// @param _token The ERC20 token.
    /// @param _to The receiver of the tokens.
    /// @param _share The amount in shares to add.
    /// False if tokens from msg.sender in `spellVault` should be transferred.
    function _addTokens(
        IERC20Upgradeable _token,
        address _to,
        uint256 _share
    ) internal {
        clerk.transfer(_token, msg.sender, address(_to), _share);
    }

    /// @notice Perform the actual borrow.
    /// @dev msg.sender borrow "_amount" of SPELL and transfer to "_to"
    /// @param _to The address to received borrowed SPELL
    /// @param _amount The amount of SPELL to be borrowed
    function _borrow(address _to, uint256 _amount)
        internal
        checkDebtSize
        returns (uint256 _debtShare, uint256 _share)
    {
        // 1. Find out debtShare from the give "_value" that msg.sender wish to borrow
        _debtShare = debtValueToShare(_amount);

        // 2. Update user's debtShare
        userDebtShare[msg.sender] = userDebtShare[msg.sender] + _debtShare;

        // 3. Book totalDebtShare and totalDebtValue
        totalDebtShare = totalDebtShare + _debtShare;
        totalDebtValue = totalDebtValue + _amount;

        // 4. Transfer borrowed SPELL to "_to"
        _share = clerk.toShare(spell, _amount, false);
        clerk.transfer(spell, address(this), _to, _share);

        emit LogBorrow(msg.sender, _to, _amount, _debtShare);
    }

    /// @notice Sender borrows `_amount` and transfers it to `to`.
    /// @dev "checkSafe" modifier prevents msg.sender from borrow > collateralFactor
    /// @param _to The address to received borrowed SPELL
    /// @param _borrowAmount The amount of SPELL to be borrowed
    function borrow(address _to, uint256 _borrowAmount)
        external
        nonReentrant
        accrue
        checkSafe
        returns (uint256 _debtShare, uint256 _share)
    {
        // Perform actual borrow
        (_debtShare, _share) = _borrow(_to, _borrowAmount);
    }

    /// @notice Return the debt value of the given debt share.
    /// @param _debtShare The debt share to be convered.
    function debtShareToValue(uint256 _debtShare)
        public
        view
        returns (uint256)
    {
        if (totalDebtShare == 0) return _debtShare;
        uint256 _debtValue = (_debtShare * totalDebtValue) / totalDebtShare;
        return _debtValue;
    }

    /// @notice Return the debt share for the given debt value.
    /// @dev debt share will always be rounded up to prevent tiny share.
    /// @param _debtValue The debt value to be converted.
    function debtValueToShare(uint256 _debtValue)
        public
        view
        returns (uint256)
    {
        if (totalDebtShare == 0) return _debtValue;
        uint256 _debtShare = (_debtValue * totalDebtShare) / totalDebtValue;
        if ((_debtShare * totalDebtValue) / totalDebtShare < _debtValue) {
            return _debtShare + 1;
        }
        return _debtShare;
    }

    /// @notice Deposit collateral to Clerk.
    /// @dev msg.sender deposits `_amount` of `_token` to Clerk. "_to" will be credited with `_amount` of `_token`.
    /// @param _token The address of the token to be deposited.
    /// @param _to The address to be credited with `_amount` of `_token`.
    /// @param _collateralAmount The amount of `_token` to be deposited.
    function deposit(
        IERC20Upgradeable _token,
        address _to,
        uint256 _collateralAmount
    ) external nonReentrant accrue {
        _vaultDeposit(_token, _to, _collateralAmount, 0);
    }

    /// @notice Deposit collateral to Clerk and borrow SPELL
    /// @param _to The address to received borrowed SPELL
    /// @param _collateralAmount The amount of collateral to be deposited
    /// @param _borrowAmount The amount of SPELL to be borrowed
    function depositAndBorrow(
        address _to,
        uint256 _collateralAmount,
        uint256 _borrowAmount
    ) external nonReentrant accrue checkSafe {
        // 1. Deposit collateral to the Vault
        (, uint256 _shareOut) = _vaultDeposit(
            collateral,
            msg.sender,
            _collateralAmount,
            0
        );

        // 2. Add collateral
        _addCollateral(msg.sender, _shareOut);

        // 3. Borrow SPELL
        _borrow(msg.sender, _borrowAmount);

        // 4. Withdraw SPELL from Vault to "_to"
        _vaultWithdraw(spell, _to, _borrowAmount, 0);
    }

    /// @notice Perform deposit token from msg.sender and credit token's balance to "_to"
    /// @param _token The token to deposit.
    /// @param _to The address to credit the deposited token's balance to.
    /// @param _amount The amount of tokens to deposit.
    /// @param _share The amount to deposit in share units.
    function _vaultDeposit(
        IERC20Upgradeable _token,
        address _to,
        uint256 _amount,
        uint256 _share
    ) internal returns (uint256, uint256) {
        return
            clerk.deposit(
                _token,
                msg.sender,
                _to,
                uint256(_amount),
                uint256(_share)
            );
    }

    /// @notice Perform debit token's balance from msg.sender and transfer token to "_to"
    /// @param _token The token to withdraw.
    /// @param _to The address of the receiver.
    /// @param _amount The amount to withdraw.
    /// @param _share The amount to withdraw in share.
    function _vaultWithdraw(
        IERC20Upgradeable _token,
        address _to,
        uint256 _amount,
        uint256 _share
    ) internal returns (uint256, uint256) {
        uint256 share_ = _amount > 0
            ? clerk.toShare(_token, _amount, true)
            : _share;
        require(
            _token == collateral || _token == spell,
            "invalid token to be withdrawn"
        );
        if (_token == collateral) {
            require(
                clerk.balanceOf(_token, msg.sender) - share_ >=
                    userCollateralShare[msg.sender],
                "please exclude the collateral"
            );
        }

        return clerk.withdraw(_token, msg.sender, _to, _amount, _share);
    }

    /// @notice Return the current debt of the "_user"
    /// @param _user The address to get the current debt
    function getUserDebtValue(address _user) external view returns (uint256) {
        uint256 _userDebtShare = userDebtShare[_user];
        return debtShareToValue(_userDebtShare);
    }
}
