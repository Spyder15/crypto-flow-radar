require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: { version: "0.8.28", settings: { evmVersion: "cancun" } },
  networks: {
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
