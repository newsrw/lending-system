const main = async () => {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const Clerk = await hre.ethers.getContractFactory("Clerk");
    const clerk = await Clerk.deploy();
    console.log("Deploying Clerk...");

    await clerk.deployed();
    console.log("Clerk deployed to: ", clerk.address);
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