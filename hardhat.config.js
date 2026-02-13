require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config();

module.exports = {
  solidity: "0.8.20",
  networks: {
    monad: {
      url: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
      accounts: process.env.BOT_WALLET_PRIVATE_KEY ? [process.env.BOT_WALLET_PRIVATE_KEY] : [],
      chainId: 143
    }
  }
};
