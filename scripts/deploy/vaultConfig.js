const main = async () => {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const VaultConfig = await hre.ethers.getContractFactory("VaultConfig");
    const vaultConfig = await VaultConfig.deploy();
    console.log("Deploying VaultConfig...");

    await vaultConfig.deployed();
    console.log("VaultConfig deployed to: ", vaultConfig.address);
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