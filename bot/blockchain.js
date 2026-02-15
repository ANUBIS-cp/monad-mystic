const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config({ path: '/home/rayzelnoblesse5/monad-mystic/.env' });

const provider = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL);
const pk = (process.env.BOT_WALLET_PRIVATE_KEY || '').trim().replace(/^0x/, '');
const wallet = new ethers.Wallet(pk, provider);
const CA_ADDRESS = process.env.CONTRACT_ADDRESS;

const CONTRACT_ABI = [
  "function storeProphecy(address user, string text, string pred, uint256 deadline) public returns (uint256)",
  "function getAccuracy(address user) public view returns (uint256)",
  "function payWinner(address payable winner, uint256 amount) public",
  "function verifyProphecy(uint256 id, bool isCorrect) public",
];

let contract = null;
const getContract = () => {
    if (!contract) contract = new ethers.Contract(CA_ADDRESS, CONTRACT_ABI, wallet);
    return contract;
};
const usedHashesPath = 'used_hashes.json';

const processingHashes = new Set();

const getUsedHashes = () => {
    if (!fs.existsSync(usedHashesPath)) fs.writeFileSync(usedHashesPath, '[]');
    try { return JSON.parse(fs.readFileSync(usedHashesPath, 'utf8') || '[]'); }
    catch(e) { return []; }
};

const addUsedHash = (hash) => {
    const hashes = getUsedHashes();
    hashes.push(hash.toLowerCase());
    fs.writeFileSync(usedHashesPath, JSON.stringify(hashes));
};

async function verifyPayment(txHash) {
    return Promise.race([
        verifyPaymentInternal(txHash),
        new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 25000))
    ]);
}
async function verifyPaymentInternal(txHash) {
    // (unchanged from previous hardened version - keeps all TX security checks)
    const normalizedHash = txHash.toLowerCase().trim();

    const TX_HASH_REGEX = /^0x[a-f0-9]{64}$/;
    if (!TX_HASH_REGEX.test(normalizedHash)) {
        return { valid: false, reason: 'INVALID_FORMAT' };
    }

    try {
        const usedHashes = getUsedHashes();
        if (usedHashes.includes(normalizedHash)) {
            return { valid: false, reason: 'ALREADY_USED' };
        }

        if (processingHashes.has(normalizedHash)) {
            return { valid: false, reason: 'ALREADY_USED' };
        }

        processingHashes.add(normalizedHash);

        const tx = await provider.getTransaction(normalizedHash);
        if (!tx || !tx.to) {
            processingHashes.delete(normalizedHash);
            return { valid: false, reason: 'NOT_FOUND' };
        }

        if (!tx.blockNumber) {
            processingHashes.delete(normalizedHash);
            return { valid: false, reason: 'UNCONFIRMED' };
        }

        const latestBlock = await provider.getBlockNumber();
        const confirmations = latestBlock - tx.blockNumber;
        if (confirmations < 2) {
            console.log(`⏳ Waiting for confirmations: ${confirmations}/2`);
            processingHashes.delete(normalizedHash);
            return { valid: false, reason: 'UNCONFIRMED' };
        }

        const block = await provider.getBlock(tx.blockNumber);
        const txAge = Math.floor(Date.now() / 1000) - block.timestamp;
        if (txAge > 1800) {
            processingHashes.delete(normalizedHash);
            return { valid: false, reason: 'TOO_OLD' };
        }

        if (tx.to.toLowerCase() !== CA_ADDRESS.toLowerCase()) {
            processingHashes.delete(normalizedHash);
            return { valid: false, reason: 'WRONG_DESTINATION' };
        }

        if (ethers.formatEther(tx.value) !== "0.01") {
            processingHashes.delete(normalizedHash);
            return { valid: false, reason: 'WRONG_AMOUNT' };
        }

        addUsedHash(normalizedHash);
        processingHashes.delete(normalizedHash);
        return { valid: true, from: tx.from };

    } catch (e) {
        console.error('verifyPayment error:', e.message);
        processingHashes.delete(normalizedHash);
        return { valid: false, reason: 'ERROR' };
    }
}

async function storeProphecyOnChain(prophecy, userRef) {
    try {
        let ts = Math.floor(Date.parse(prophecy.deadline) / 1000);
        const addr = ethers.isAddress(userRef) ? userRef : "0x0000000000000000000000000000000000000000";

        const tx = await getContract().storeProphecy(addr, prophecy.text.slice(0,100), prophecy.prediction.slice(0,50), ts, { gasLimit: 400000, maxFeePerGas: ethers.parseUnits("200", "gwei"), maxPriorityFeePerGas: ethers.parseUnits("2", "gwei") });
        const onChainId = null;
        const receipt = await tx.wait();

        return { hash: receipt.hash, onChainId };
    } catch (e) {
        console.error('storeProphecyOnChain error:', e.message);
        return { hash: "ERROR_IN_TX", onChainId: null };
    }
}

async function finalizeProphecy(id, isCorrect) {
    try {
        const tx = await getContract().verifyProphecy(id, isCorrect, { gasLimit: 300000 });
        await tx.wait();
        return true;
    } catch (e) { return false; }
}

async function payoutWinner(winnerAddress, amount) {
    amount = amount || "0.04";
    // SECURITY: On-chain payout only (contract holds pool). No direct fallback to keep funds safe in contract.
    try {
        const balance = await provider.getBalance(wallet.address);
        if (balance < ethers.parseEther("0.05")) { // buffer for gas
            console.log("⚠️ Low gas in bot wallet — payout may fail.");
        }
        const tx = await getContract().payWinner(winnerAddress, ethers.parseEther(amount), { gasLimit: 200000 });
        await tx.wait();
        return { success: true, method: 'contract' };
    } catch (e) {
        console.log(`⚠️ On-chain payout failed for ${winnerAddress}. Marked for admin review.`);
        return { success: false, method: 'contract_failed' };
    }
}

module.exports = { verifyPayment, storeProphecyOnChain, finalizeProphecy, payoutWinner, wallet };
