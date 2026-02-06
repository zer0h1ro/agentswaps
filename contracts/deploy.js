#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps Smart Contract Deployer
 *
 * Deploys $SWAP token and DAO governance to Base (or any EVM chain).
 * Built by AI agents. Deployed by AI agents.
 *
 * Usage:
 *   PRIVATE_KEY=0x... node deploy.js                    # Deploy to Base mainnet
 *   PRIVATE_KEY=0x... CHAIN=base-sepolia node deploy.js # Deploy to Base Sepolia testnet
 *
 * Prerequisites:
 *   npm install ethers @openzeppelin/contracts solc
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Chain configurations
const CHAINS = {
  'base': {
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    chainId: 8453,
    explorer: 'https://basescan.org',
  },
  'base-sepolia': {
    name: 'Base Sepolia',
    rpc: 'https://sepolia.base.org',
    chainId: 84532,
    explorer: 'https://sepolia.basescan.org',
  },
  'ethereum': {
    name: 'Ethereum',
    rpc: 'https://eth.llamarpc.com',
    chainId: 1,
    explorer: 'https://etherscan.io',
  },
};

// Distribution addresses — set these before deployment
const DISTRIBUTION = {
  treasury: null,      // Will use deployer if not set
  teamVesting: null,   // Will use deployer if not set
  ecosystemFund: null,  // Will use deployer if not set
  earlyBackers: null,   // Will use deployer if not set
};

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('ERROR: Set PRIVATE_KEY environment variable');
    console.error('  PRIVATE_KEY=0x... node deploy.js');
    process.exit(1);
  }

  const chainKey = process.env.CHAIN || 'base';
  const chain = CHAINS[chainKey];
  if (!chain) {
    console.error(`Unknown chain: ${chainKey}. Available: ${Object.keys(CHAINS).join(', ')}`);
    process.exit(1);
  }

  console.log('=== AgentSwaps Contract Deployer ===');
  console.log(`Chain: ${chain.name} (${chain.chainId})`);
  console.log(`RPC: ${chain.rpc}`);
  console.log();

  // Connect
  const provider = new ethers.JsonRpcProvider(chain.rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const deployer = wallet.address;
  console.log(`Deployer: ${deployer}`);

  const balance = await provider.getBalance(deployer);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('ERROR: Deployer has no ETH for gas');
    process.exit(1);
  }

  // Use deployer as default for all pools (can transfer later via DAO)
  const treasury = DISTRIBUTION.treasury || deployer;
  const teamVesting = DISTRIBUTION.teamVesting || deployer;
  const ecosystemFund = DISTRIBUTION.ecosystemFund || deployer;
  const earlyBackers = DISTRIBUTION.earlyBackers || deployer;

  console.log();
  console.log('Distribution addresses:');
  console.log(`  Treasury:  ${treasury}`);
  console.log(`  Team:      ${teamVesting}`);
  console.log(`  Ecosystem: ${ecosystemFund}`);
  console.log(`  Early:     ${earlyBackers}`);

  // NOTE: In production, compile with solc or hardhat.
  // For now, this script shows the deployment flow.
  // The actual compiled bytecode will be generated when we set up Hardhat.

  console.log();
  console.log('--- DEPLOYMENT READY ---');
  console.log('Smart contracts written:');
  console.log('  1. SwapToken.sol — $SWAP ERC-20 (1B supply, 5 pools)');
  console.log('  2. AgentSwapsDAO.sol — Governance (proposals, voting, execution)');
  console.log();
  console.log('To compile and deploy:');
  console.log('  1. npx hardhat compile');
  console.log('  2. npx hardhat run contracts/deploy.js --network base');
  console.log();
  console.log('Or use this script directly after adding compiled artifacts.');
  console.log();
  console.log('Built by agents. Owned by agents. On-chain.');
}

main().catch(e => {
  console.error('Deploy failed:', e.message);
  process.exit(1);
});
