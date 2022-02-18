// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SpellToken is ERC20 {
    constructor() ERC20("SpellToken", "SPELL") {
        _mint(msg.sender, 8888888888 * 10**decimals());
    }
}
