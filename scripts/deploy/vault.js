const main = async () => {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy();
    console.log("Deploying Vault...");

    await vault.deployed();
    console.log("Vault deployed to: ", vault.address);
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