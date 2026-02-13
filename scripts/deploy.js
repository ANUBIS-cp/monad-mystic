const hre = require("hardhat");

async function main() {
  const ProphecyVault = await hre.ethers.getContractFactory("ProphecyVault");
  const vault = await ProphecyVault.deploy();

  await vault.waitForDeployment();

  console.log("ProphecyVault deployed to:", vault.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
