
require('dotenv').config({ path: '/home/rayzelnoblesse5/monad-mystic/.env' });
const { ethers } = require('ethers');

async function getBalance() {
    const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL);
    const contractAddress = process.env.CONTRACT_ADDRESS;

    if (!contractAddress) {
        console.error("CONTRACT_ADDRESS not found in .env");
        return;
    }

    try {
        const balanceWei = await provider.getBalance(contractAddress);
        const balanceMon = ethers.formatEther(balanceWei);
        console.log(`Wallet Balance for ${contractAddress}: ${balanceMon} MON`);
    } catch (error) {
        console.error("Error fetching balance:", error.message);
    }
}

getBalance();
