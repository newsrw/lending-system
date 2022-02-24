const { expect } = require("chai");
const { ethers, waffle } = require("hardhat");
const { BigNumber } = require("ethers");

// async function latestTimestamp(): Promise<BigNumber> {
//     const block = await ethers.provider.getBlock("latest");
//     return ethers.BigNumber.from(block.timestamp);
// }

// async function latestBlockNumber(): Promise<BigNumber> {
//     const block = await ethers.provider.getBlock("latest");
//     return ethers.BigNumber.from(block.number);
// }

async function advanceBlock() {
    await ethers.provider.send("evm_mine", []);
}

// async function setTimestamp(timeStamp: BigNumber) {
//     await ethers.provider.send("evm_mine", [timeStamp.toNumber()]);
// }

async function increaseTimestamp(duration) {
    if (duration.isNegative()) throw Error(`Cannot increase time by a negative amount (${duration})`);

    await ethers.provider.send("evm_increaseTime", [duration.toNumber()]);

    await advanceBlock();
}

const duration = {
    seconds: function (val) {
        return val;
    },
    minutes: function (val) {
        return val.mul(this.seconds(ethers.BigNumber.from("60")));
    },
    hours: function (val) {
        return val.mul(this.minutes(ethers.BigNumber.from("60")));
    },
    days: function (val) {
        return val.mul(this.hours(ethers.BigNumber.from("24")));
    },
    weeks: function (val) {
        return val.mul(this.days(ethers.BigNumber.from("7")));
    },
    years: function (val) {
        return val.mul(this.days(ethers.BigNumber.from("365")));
    },
};

describe("Vault", () => {
    const DAY = ethers.BigNumber.from(24 * 60 * 60);
    const MIN_DEBT_SIZE = ethers.utils.parseEther("1");
    const MAX_COLLATERAL_RATIO = ethers.BigNumber.from("8500"); // 85%
    const INTEREST_PER_SECOND = ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60);
    const MAX_PRICE_DEVIATION = ethers.utils.parseEther("1.5")

    // Accounts - Type Signer
    let deployer;
    let alice;

    // Addresses - Type string
    let deployerAddress;
    let aliceAddress;

    // tokens
    let magic;
    let spell;

    // oracle
    let offChainOracle;
    let compositeOracle;

    let clerk;

    let vaultMarket;
    let vaultConfig;

    // contract account
    let spellAsAlice;
    let magicAsAlice;
    let vaultMarketAsAlice;

    // function calculateAccruedInterest(
    //     t0,
    //     t1,
    //     debt,
    //     interestPerSecond
    // ) {
    //     const t0b = BigNumber.from(t0);
    //     const t1b = BigNumber.from(t1);
    //     const currentDebt = BigNumber.from(debt);
    //     const currentInterestPerSecond = BigNumber.from(interestPerSecond);

    //     if (t0b.gt(t1b)) throw new Error("t0 must be less than t1");

    //     const timePast = t1b.sub(t0b);
    //     const accruedInterest = timePast.mul(currentDebt).mul(currentInterestPerSecond).div(ethers.constants.WeiPerEther);

    //     return accruedInterest;
    // }

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

        // Deploy Oracles
        // Use Offchain Oracle for easy testing
        const OffChainOracle = (await ethers.getContractFactory("OffChainOracle", deployer));
        offChainOracle = await OffChainOracle.deploy([]);
        await offChainOracle.grantRole(ethers.utils.solidityKeccak256(["string"], ["FEEDER_ROLE"]), deployerAddress);

        // Feed offchain price
        await offChainOracle.setPrices([magic.address], [ethers.utils.parseEther("1")]);

        // Expect offchain price to be 1
        let [updated, price] = await offChainOracle.get(
            ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])
        );
        expect(updated).to.be.true;
        expect(price).to.eq(ethers.utils.parseEther("1"));

        const CompositeOracle = (await ethers.getContractFactory("CompositeOracle", deployer));
        compositeOracle = await CompositeOracle.deploy([15 * 60]);
        await compositeOracle.setPrimarySources(
            magic.address,
            MAX_PRICE_DEVIATION,
            [offChainOracle.address],
            [ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]
        );

        await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);

        // skip time to avoid time delay
        await increaseTimestamp(duration.minutes(BigNumber.from("15")));

        // set price once again to let the `nextPrice` of a previous setPrices call move to `currentPrice)
        await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);

        // Expect composite oracle can query from offchain oracle
        [updated, price] = await compositeOracle.get(ethers.utils.defaultAbiCoder.encode(["address"], [magic.address]));
        expect(updated).to.be.true;
        expect(price).to.eq(ethers.utils.parseEther("1"));

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
        const VaultMarket = (await ethers.getContractFactory("Vault", deployer));
        vaultMarket = await VaultMarket.deploy(
            clerk.address,
            spell.address,
            magic.address,
            vaultConfig.address,
            compositeOracle.address,
            ethers.utils.defaultAbiCoder.encode(["address"], [magic.address]),
        );

        // Whitelist market to allow market to access funds in Clerk
        await clerk.whitelistMarket(vaultMarket.address, true);
        // Mint SPELL to deployer
        await spell.mint(deployerAddress, ethers.utils.parseEther("8888888888"));
        // Increase timestamp by 1 day to allow more SPELL to be minted
        await increaseTimestamp(DAY);
        // Assuming someone try to borrow SPELL from vaultMarket when it is not setup yet
        await magic.approve(clerk.address, ethers.constants.MaxUint256);
        await expect(
            vaultMarket.depositAndBorrow(
                deployerAddress,
                ethers.utils.parseEther("10000000"),
                ethers.utils.parseEther("8500000"),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
            ),
            "if oracle get stale > 1 day, it will be reverted as no valid source"
        ).to.be.revertedWith("CompositeOracle::get::price stale");
        // Feed offchain price again
        await offChainOracle.setPrices([magic.address], [ethers.utils.parseEther("1")]);
        // update composit oracle price after offchain feeding the latest price
        await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);
        await expect(
            vaultMarket.depositAndBorrow(
                deployerAddress,
                ethers.utils.parseEther("10000000"),
                ethers.utils.parseEther("8500000"),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
            )
        ).to.be.revertedWith("bad collateralFactor");
        // Config market
        await vaultConfig.setConfig(
            [vaultMarket.address],
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
        vaultMarketAsAlice = magic.connect(vaultMarket.address, alice);
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
            expect(await vaultMarket.clerk()).to.equal(clerk.address);
            expect(await vaultMarket.spell()).to.equal(spell.address);
            expect(await vaultMarket.collateral()).to.equal(magic.address);
            expect(await vaultMarket.oracle()).to.equal(compositeOracle.address);
            expect(await vaultMarket.oracleData()).to.equal(
                ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])
            );
            expect(await vaultConfig.interestPerSecond(vaultMarket.address)).to.equal(
                ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60)
            );
            expect(await vaultConfig.collateralFactor(vaultMarket.address, deployerAddress)).to.equal(
                MAX_COLLATERAL_RATIO
            );
        });
    });

    // describe("#accrue", async () => {
    //     it("should accrue interest correctly", async () => {
    //         // preparation
    //         const stages: any = {};
    //         const collateralAmount = ethers.utils.parseEther("10000000");
    //         const borrowAmount = ethers.utils.parseEther("1000000");

    //         // Move timestamp to start of the week for easy testing
    //         await timeHelpers.setTimestamp(
    //             (await timeHelpers.latestTimestamp()).div(timeHelpers.WEEK).add(1).mul(timeHelpers.WEEK)
    //         );

    //         // set price to prevent no valid source in case of stale
    //         await offChainOracle.setPrices([magic.address], [usdt.address], [ethers.utils.parseEther("1")]);
    //         await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
    //         await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);

    //         // Assuming Alice deposit "collateralAmount" MAGIC and borrow "borrowAmount" SPELL
    //         const aliceSpellBefore = await spell.balanceOf(aliceAddress);
    //         await magicMarketAsAlice.depositAndBorrow(
    //             aliceAddress,
    //             collateralAmount,
    //             borrowAmount,
    //             ethers.utils.parseEther("1"),
    //             ethers.utils.parseEther("1")
    //         );
    //         const aliceSpellAfter = await spell.balanceOf(aliceAddress);
    //         stages["aliceBorrow"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

    //         expect(aliceSpellAfter.sub(aliceSpellBefore)).to.be.eq(borrowAmount);

    //         // Move timestamp to 52 weeks since Alice borrowed "borrowAmount" SPELL
    //         await timeHelpers.setTimestamp(
    //             (await timeHelpers.latestTimestamp()).div(timeHelpers.WEEK).add(52).mul(timeHelpers.WEEK)
    //         );
    //         stages["oneYearAfter"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

    //         // set price to prevent no valid source in case of stale
    //         await offChainOracle.setPrices([magic.address], [usdt.address], [ethers.utils.parseEther("1")]);
    //         await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
    //         await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);

    //         // Deposit 0 to accrue interest
    //         await vaultMarket.deposit(spell.address, deployerAddress, 0);
    //         stages["accrue"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

    //         const timePast = stages["accrue"][0].sub(stages["aliceBorrow"][0]);
    //         const expectedSurplus = borrowAmount.mul(timePast).mul(INTEREST_PER_SECOND).div(ethers.constants.WeiPerEther);
    //         expect(await vaultMarket.lastAccrueTime()).to.be.eq(stages["accrue"][0]);
    //         expect(await vaultMarket.surplus()).to.be.eq(expectedSurplus);
    //         expect(await vaultMarket.totalDebtShare()).to.be.eq(borrowAmount);
    //         expect(await vaultMarket.totalDebtValue()).to.be.eq(borrowAmount.add(expectedSurplus));

    //         // Deployer withdraw surplus
    //         await vaultMarket.withdrawSurplus();
    //         const deployerSpellBefore = await spell.balanceOf(deployerAddress);
    //         await clerk.withdraw(spell.address, deployerAddress, deployerAddress, expectedSurplus, 0);
    //         const deployerSpellAfter = await spell.balanceOf(deployerAddress);

    //         expect(deployerSpellAfter.sub(deployerSpellBefore)).to.be.eq(expectedSurplus);
    //     });
    // });

    describe("#depositAndBorrow", async () => {
        context("when price went below _minPrice", async () => {
            it("should revert", async () => {
                // preparation
                // set price to 0.5
                await offChainOracle.setPrices([magic.address], [usdt.address], [ethers.utils.parseEther("0.5")]);

                // clear the price cache
                await increaseTimestamp(duration.minutes(BigNumber.from("15")));
                await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);
                await increaseTimestamp(duration.minutes(BigNumber.from("15")));
                await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);

                await expect(
                    vaultMarketAsAlice.depositAndBorrow(
                        aliceAddress,
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1")
                    )
                ).to.be.revertedWith("slippage");
            });
        });

        context("when price went above _maxPrice", async () => {
            it("should revert", async () => {
                // preparation
                // set price to 1.5
                await offChainOracle.setPrices([magic.address], [usdt.address], [ethers.utils.parseEther("1.5")]);

                // clear the price cache
                await increaseTimestamp(duration.minutes(BigNumber.from("15")));
                await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);
                await increaseTimestamp(duration.minutes(BigNumber.from("15")));
                await compositeOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [magic.address])]);

                await expect(
                    vaultMarketAsAlice.depositAndBorrow(
                        aliceAddress,
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1")
                    )
                ).to.be.revertedWith("slippage");
            });
        });

        context("when collateral is not enough to borrow SPELL", async () => {
            it("should revert", async () => {
                // Alice try to borrow 8,500,001 SPELL with 10,000,000 magic as collateral
                // This should revert due to _collateralFactor is 85% and collateral is only 10,000,000.
                await expect(
                    vaultMarketAsAlice.depositAndBorrow(
                        aliceAddress,
                        ethers.utils.parseEther("10000000"),
                        ethers.utils.parseEther("8500001"),
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1.1")
                    )
                ).to.be.revertedWith("!safe");
            });
        });

        context("when there is no SPELL left to borrow", async () => {
            it("should revert", async () => {
                // Reduce supply of SPELL to 0
                await vaultMarket.reduceSupply(await clerk.balanceOf(spell.address, vaultMarket.address));

                // Assuming MAGIC worth 1 USD
                // Alice deposit 10,000,000 MAGIC and borrow 1 wei of SPELL
                await expect(
                    vaultMarketAsAlice.depositAndBorrow(
                        aliceAddress,
                        ethers.utils.parseEther("10000000"),
                        1,
                        ethers.utils.parseEther("1"),
                        ethers.utils.parseEther("1.1")
                    )
                ).to.be.reverted;
            });
        });

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
