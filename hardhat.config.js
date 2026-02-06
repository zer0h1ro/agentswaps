/* eslint-disable @typescript-eslint/no-require-imports */
require('@nomicfoundation/hardhat-toolbox');

// Support both PRIVATE_KEY and MNEMONIC for wallet configuration
function getAccounts() {
  if (process.env.PRIVATE_KEY) {
    return [process.env.PRIVATE_KEY];
  }
  if (process.env.MNEMONIC) {
    return { mnemonic: process.env.MNEMONIC };
  }
  return [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  sourcify: {
    enabled: true,
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || '',
    },
  },
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    base: {
      url: 'https://mainnet.base.org',
      chainId: 8453,
      accounts: getAccounts(),
    },
    'base-sepolia': {
      url: 'https://sepolia.base.org',
      chainId: 84532,
      accounts: getAccounts(),
    },
    bsc: {
      url: 'https://bsc-dataseed1.binance.org',
      chainId: 56,
      accounts: getAccounts(),
    },
    'bsc-testnet': {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      chainId: 97,
      accounts: getAccounts(),
    },
    ethereum: {
      url: process.env.ETH_RPC || 'https://eth.llamarpc.com',
      chainId: 1,
      accounts: getAccounts(),
    },
  },
};
