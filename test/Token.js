const { expect } = require("chai");

describe("Token contract", function () {
    it("Deployment should assign the total supply of MAGIC tokens to the owner", async function () {
        const [owner] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("MagicToken");

        const hardhatToken = await Token.deploy();

        const ownerBalance = await hardhatToken.balanceOf(owner.address);
        expect(await hardhatToken.totalSupply()).to.equal(ownerBalance);
    });

    it("Deployment should assign the total supply of SPELL tokens to the owner", async function () {
        const [owner] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("SpellToken");

        const hardhatToken = await Token.deploy();

        const ownerBalance = await hardhatToken.balanceOf(owner.address);
        expect(await hardhatToken.totalSupply()).to.equal(ownerBalance);
    });
});