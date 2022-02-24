const main = async () => {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying token contracts with the account:", deployer.address);

    const MagicToken = await hre.ethers.getContractFactory("MagicToken");
    const magicToken = await MagicToken.deploy();
    console.log("Deploying MagicToken...");

    await magicToken.deployed();
    console.log("MagicToken deployed to: ", magicToken.address);

    console.log("Deploying SpellToken...");

    const SpellToken = await hre.ethers.getContractFactory("SpellToken");
    const spellToken = await SpellToken.deploy();

    await spellToken.deployed();
    console.log("SpellToken deployed to: ", spellToken.address);
}

const runMain = async () => {
    try {
        await main();
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

runMain();