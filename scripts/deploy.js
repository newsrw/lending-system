const main = async () => {
    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    const Token = await hre.ethers.getContractFactory("SpellToken");
    const token = await Token.deploy();

    await token.deployed();
    console.log("Token deployed to: ", token.address);
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