// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MagicToken is ERC20 {
    constructor() ERC20("MagicToken", "MAGIC") {
        _mint(msg.sender, 1681688 * 10**decimals());
    }
}
