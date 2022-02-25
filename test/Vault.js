const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");

async function advanceBlock() {
    await ethers.provider.send("evm_mine", []);
}

async function increaseTimestamp(duration) {
    if (duration.isNegative()) throw Error(`Cannot increase time by a negative amount (${duration})`);

    await ethers.provider.send("evm_increaseTime", [duration.toNumber()]);

    await advanceBlock();
}

describe("Vault", () => {
    const DAY = ethers.BigNumber.from(24 * 60 * 60);
    const MIN_DEBT_SIZE = ethers.utils.parseEther("1");
    const MAX_COLLATERAL_RATIO = ethers.BigNumber.from("8500"); // 85%
    const INTEREST_PER_SECOND = ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60);

    // Accounts - Type Signer
    let deployer;
    let alice;

    // Addresses - Type string
    let deployerAddress;
    let aliceAddress;

    // tokens
    let magic;
    let spell;

    let clerk;

    let vault;
    let vaultConfig;

    // contract account
    let spellAsAlice;
    let magicAsAlice;
    let vaultMarketAsAlice;

    async function fixture() {
        [deployer, alice] = await ethers.getSigners();
        [deployerAddress, aliceAddress] = await Promise.all([
            deployer.getAddress(),
            alice.getAddress()
        ]);

        // Deploy MagicToken
        const MagicToken = (await ethers.getContractFactory("MagicToken"));
        magic = await MagicToken.deploy();
        await magic.mint(deployerAddress, ethers.utils.parseEther("1681688"));

        // Deploy Clerk
        const Clerk = (await ethers.getContractFactory("Clerk", deployer));
        clerk = await Clerk.deploy();

        // Deploy Spell
        const SpellToken = (await ethers.getContractFactory("SpellToken", deployer));
        spell = await SpellToken.deploy();

        // Deploy MarketConfig
        const VaultConfig = (await ethers.getContractFactory(
            "VaultConfig",
            deployer
        ));
        vaultConfig = await VaultConfig.deploy();

        // Deploy vaultMarket
        // Assuming 0.5% interest rate per year
        // Assuming 85% collateralization ratio
        const Vault = (await ethers.getContractFactory("Vault", deployer));
        vault = await Vault.deploy();

        // Mint SPELL to deployer
        await spell.mint(deployerAddress, ethers.utils.parseEther("8888888888"));
        // Increase timestamp by 1 day to allow more SPELL to be minted
        await increaseTimestamp(DAY);
        // Assuming someone try to borrow SPELL from vaultMarket when it is not setup yet
        await magic.approve(clerk.address, ethers.constants.MaxUint256);

        // Config market
        await vaultConfig.setConfig(
            [vault.address],
            [
                {
                    collateralFactor: MAX_COLLATERAL_RATIO,
                    interestPerSecond: INTEREST_PER_SECOND,
                    minDebtSize: MIN_DEBT_SIZE,
                },
            ]
        );
        // // Connect contracts to Alice
        magicAsAlice = magic.connect(magic.address, alice);
        vaultMarketAsAlice = magic.connect(vault.address, alice);
        spellAsAlice = spell.connect(spell.address, alice);

        // Transfer magic to Alice and Bob
        await magic.transfer(aliceAddress, ethers.utils.parseEther("100000000"));
        await magic.transfer(bobAddress, ethers.utils.parseEther("100000000"));
        // Approve clerk to deduct money
        await magicAsAlice.approve(clerk.address, ethers.constants.MaxUint256);
        // Approve clerk to deduct money
        await spellAsAlice.approve(clerk.address, ethers.constants.MaxUint256);
    }

    beforeEach(async () => {
        await waffle.loadFixture(fixture);
    });

    describe("#initialzied", async () => {
        it("should be initialized", async () => {
            expect(await vault.clerk()).to.equal(clerk.address);
            expect(await vault.spell()).to.equal(spell.address);
            expect(await vault.collateral()).to.equal(magic.address);
            expect(await vaultConfig.interestPerSecond(vault.address)).to.equal(
                ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60)
            );
            expect(await vaultConfig.collateralFactor(vault.address, deployerAddress)).to.equal(
                MAX_COLLATERAL_RATIO
            );
        });
    });

    describe("#accrue", async () => {
        it("should accrue interest correctly", async () => {
            // preparation
            const stages = {};
            const collateralAmount = ethers.utils.parseEther("10000000");
            const borrowAmount = ethers.utils.parseEther("1000000");

            // Move timestamp to start of the week for easy testing
            await timeHelpers.setTimestamp(
                (await timeHelpers.latestTimestamp()).div(timeHelpers.WEEK).add(1).mul(timeHelpers.WEEK)
            );

            // Assuming Alice deposit "collateralAmount" MAGIC and borrow "borrowAmount" SPELL
            const aliceSpellBefore = await spell.balanceOf(aliceAddress);
            await magicMarketAsAlice.depositAndBorrow(
                aliceAddress,
                collateralAmount,
                borrowAmount,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
            );
            const aliceSpellAfter = await spell.balanceOf(aliceAddress);
            stages["aliceBorrow"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

            expect(aliceSpellAfter.sub(aliceSpellBefore)).to.be.eq(borrowAmount);

            // Move timestamp to 52 weeks since Alice borrowed "borrowAmount" SPELL
            await timeHelpers.setTimestamp(
                (await timeHelpers.latestTimestamp()).div(timeHelpers.WEEK).add(52).mul(timeHelpers.WEEK)
            );
            stages["oneYearAfter"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

            // Deposit 0 to accrue interest
            await vault.deposit(spell.address, deployerAddress, 0);
            stages["accrue"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

            const timePast = stages["accrue"][0].sub(stages["aliceBorrow"][0]);
            const expectedSurplus = borrowAmount.mul(timePast).mul(INTEREST_PER_SECOND).div(ethers.constants.WeiPerEther);
            expect(await vault.lastAccrueTime()).to.be.eq(stages["accrue"][0]);
            expect(await vault.surplus()).to.be.eq(expectedSurplus);
            expect(await vault.totalDebtShare()).to.be.eq(borrowAmount);
            expect(await vault.totalDebtValue()).to.be.eq(borrowAmount.add(expectedSurplus));

            // Deployer withdraw surplus
            await vault.withdrawSurplus();
            const deployerSpellBefore = await spell.balanceOf(deployerAddress);
            await clerk.withdraw(spell.address, deployerAddress, deployerAddress, expectedSurplus, 0);
            const deployerSpellAfter = await spell.balanceOf(deployerAddress);

            expect(deployerSpellAfter.sub(deployerSpellBefore)).to.be.eq(expectedSurplus);
        });
    });

    describe("#depositAndBorrow", async () => {
        context("when borrow 50% of collateral", async () => {
            it("should deposit and borrow", async () => {
                // Assuming MAGIC worth 1 USD
                // Alice deposit 10,000,000 MAGIC and borrow 5,000,000 SPELL (50% collateral ratio)
                const aliceSpellBefore = await spell.balanceOf(aliceAddress);
                await vaultMarketAsAlice.depositAndBorrow(
                    aliceAddress,
                    ethers.utils.parseEther("10000000"),
                    ethers.utils.parseEther("5000000"),
                    ethers.utils.parseEther("1"),
                    ethers.utils.parseEther("1.1")
                );
                const aliceSpellAfter = await spell.balanceOf(aliceAddress);

                expect(aliceSpellAfter.sub(aliceSpellBefore)).to.eq(ethers.utils.parseEther("5000000"));
            });
        });

        context("when borrow at MAX_COLLATERAL_RATIO", async () => {
            it("should deposit and borrow", async () => {
                // Assuming MAGIC worth 1 USD
                // Alice deposit 10,000,000 MAGIC and borrow 10,000,000 * MAX_COLLATERAL_RATIO
                const aliceSpellBefore = await spell.balanceOf(aliceAddress);
                await vaultMarketAsAlice.depositAndBorrow(
                    aliceAddress,
                    ethers.utils.parseEther("10000000"),
                    ethers.utils.parseEther("8500000"),
                    ethers.utils.parseEther("1"),
                    ethers.utils.parseEther("1.1")
                );
                const aliceSpellAfter = await spell.balanceOf(aliceAddress);

                expect(aliceSpellAfter.sub(aliceSpellBefore)).to.be.eq(ethers.utils.parseEther("8500000"));

                // Alice try to borrow 1 wei of SPELL
                // Expect to be revert
                await expect(
                    vaultMarketAsAlice.borrow(aliceAddress, 1, ethers.utils.parseEther("1"), ethers.utils.parseEther("1"))
                ).to.be.revertedWith("!safe");
            });
        });
    });
});
