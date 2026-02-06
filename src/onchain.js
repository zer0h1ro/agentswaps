/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps — On-Chain Transaction Layer
 *
 * Writes to Base mainnet contracts using the deployer wallet:
 *   - Distributes $SWAP usage rewards after each swap
 *   - Ensures the server is an authorized distributor
 *   - Records swap events on-chain
 *
 * The deployer wallet is loaded from:
 *   1. DEPLOYER_PRIVATE_KEY env var
 *   2. ~/.config/agentswaps/deployer-wallet.json
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Contract Addresses (Base Mainnet)
// ============================================================================

const CONTRACTS = {
  token: '0xA70DA9E19d102163983E3061c5Ade715f0dD36d3',
  settler: '0x0800Bd274441674f84526475a5daB5E7571e0Aa4',
  dao: '0x27CfE2255dae29624D8DA82E6D389dcE5af0206B',
};

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

// ============================================================================
// ABI Fragments — write operations
// ============================================================================

const TOKEN_WRITE_ABI = [
  'function distributeUsageReward(address agent, uint256 baseAmount) external',
  'function setUsageDistributor(address distributor, bool status) external',
  'function usageDistributors(address) view returns (bool)',
  'function usageDistributed() view returns (uint256)',
  'function usageRemaining() view returns (uint256)',
  'function currentEpoch() view returns (uint256)',
  'function halvingDivisor() view returns (uint256)',
  'function applyHalving(uint256 baseAmount) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function owner() view returns (address)',
];

// ============================================================================
// Module State
// ============================================================================

let provider = null;
let wallet = null;
let tokenContract = null;
let initialized = false;

// Reward tracking
let rewardsDistributed = 0;
let rewardsFailed = 0;
let lastRewardTx = null;

// Base reward per swap (matches Settler's rewardPerSwap)
const BASE_REWARD_PER_SWAP = ethers.parseEther('1000');

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the on-chain writer with the deployer wallet.
 * Loads the private key from env or config file.
 * Returns true if ready, false if no key available (runs in read-only mode).
 */
async function init() {
  const privateKey = loadPrivateKey();

  if (!privateKey) {
    console.log('[onchain] No deployer key found — running in read-only mode');
    console.log('[onchain] Set DEPLOYER_PRIVATE_KEY or create ~/.config/agentswaps/deployer-wallet.json');
    return false;
  }

  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    wallet = new ethers.Wallet(privateKey, provider);
    tokenContract = new ethers.Contract(CONTRACTS.token, TOKEN_WRITE_ABI, wallet);

    console.log(`[onchain] Connected to Base mainnet as ${wallet.address}`);

    // Verify we're the owner (or at least authorized)
    const owner = await tokenContract.owner();
    console.log(`[onchain] Token owner: ${owner}`);
    console.log(`[onchain] We are owner: ${owner.toLowerCase() === wallet.address.toLowerCase()}`);

    // Check and setup distributor authorization
    await ensureDistributorAuth();

    initialized = true;
    return true;
  } catch (err) {
    console.error(`[onchain] Init failed: ${err.message}`);
    return false;
  }
}

/**
 * Load deployer private key from environment or config file.
 */
function loadPrivateKey() {
  // 1. Environment variable
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    return process.env.DEPLOYER_PRIVATE_KEY;
  }

  // 2. Config file
  const configPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.config',
    'agentswaps',
    'deployer-wallet.json'
  );

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.privateKey) {
        console.log(`[onchain] Loaded key from ${configPath}`);
        return config.privateKey;
      }
    }
  } catch {
    // Ignore read errors
  }

  return null;
}

/**
 * Ensure the deployer wallet is authorized as a usage distributor.
 * If not, register it (requires owner permissions).
 */
async function ensureDistributorAuth() {
  try {
    const isAuthorized = await tokenContract.usageDistributors(wallet.address);

    if (isAuthorized) {
      console.log('[onchain] Deployer is authorized usage distributor');
      return true;
    }

    console.log('[onchain] Deployer NOT authorized — registering as usage distributor...');

    const tx = await tokenContract.setUsageDistributor(wallet.address, true);
    console.log(`[onchain] setUsageDistributor tx: ${tx.hash}`);

    const receipt = await tx.wait(1);
    console.log(`[onchain] Authorized in block ${receipt.blockNumber} (gas: ${receipt.gasUsed})`);

    return true;
  } catch (err) {
    console.error(`[onchain] Failed to authorize distributor: ${err.message}`);
    return false;
  }
}

// ============================================================================
// Reward Distribution
// ============================================================================

/**
 * Distribute $SWAP usage reward to an agent after a swap.
 *
 * @param {string} agentAddress — Agent's Base wallet address (0x...)
 * @returns {object} { success, txHash, reward, error }
 */
async function distributeSwapReward(agentAddress) {
  if (!initialized) {
    return { success: false, error: 'On-chain module not initialized' };
  }

  if (!agentAddress || !ethers.isAddress(agentAddress)) {
    return { success: false, error: `Invalid address: ${agentAddress}` };
  }

  try {
    // Get the actual reward amount after halving
    const actualReward = await tokenContract.applyHalving(BASE_REWARD_PER_SWAP);

    if (actualReward === 0n) {
      return { success: false, error: 'Reward is zero (halving exhausted)' };
    }

    // Check remaining pool
    const remaining = await tokenContract.usageRemaining();
    if (remaining < actualReward) {
      return { success: false, error: 'Usage pool exhausted' };
    }

    // Distribute
    const tx = await tokenContract.distributeUsageReward(agentAddress, BASE_REWARD_PER_SWAP);
    const receipt = await tx.wait(1);

    rewardsDistributed++;
    lastRewardTx = tx.hash;

    const rewardFormatted = ethers.formatEther(actualReward);
    console.log(
      `[onchain] Rewarded ${rewardFormatted} SWAP to ${agentAddress.slice(0, 10)}... (tx: ${tx.hash.slice(0, 14)}...)`
    );

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      reward: rewardFormatted,
      epoch: Number(await tokenContract.currentEpoch()),
    };
  } catch (err) {
    rewardsFailed++;
    console.error(`[onchain] Reward failed for ${agentAddress}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Distribute swap rewards to both agents after a match.
 * Non-blocking — logs errors but doesn't throw.
 *
 * @param {string} addressA — Agent A wallet
 * @param {string} addressB — Agent B wallet
 * @returns {object} { rewardA, rewardB }
 */
async function distributeSwapRewards(addressA, addressB) {
  const [rewardA, rewardB] = await Promise.allSettled([distributeSwapReward(addressA), distributeSwapReward(addressB)]);

  return {
    rewardA: rewardA.status === 'fulfilled' ? rewardA.value : { success: false, error: rewardA.reason?.message },
    rewardB: rewardB.status === 'fulfilled' ? rewardB.value : { success: false, error: rewardB.reason?.message },
  };
}

// ============================================================================
// On-chain balance check
// ============================================================================

/**
 * Get an agent's $SWAP token balance on-chain.
 *
 * @param {string} address — wallet address
 * @returns {string} balance in SWAP tokens
 */
async function getSwapBalance(address) {
  if (!initialized) return '0';

  try {
    const balance = await tokenContract.balanceOf(address);
    return ethers.formatEther(balance);
  } catch {
    return '0';
  }
}

// ============================================================================
// Status
// ============================================================================

function getStatus() {
  return {
    initialized,
    deployer: wallet?.address || null,
    contracts: CONTRACTS,
    stats: {
      rewardsDistributed,
      rewardsFailed,
      lastRewardTx,
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  init,
  distributeSwapReward,
  distributeSwapRewards,
  getSwapBalance,
  getStatus,
  CONTRACTS,
  BASE_REWARD_PER_SWAP,
};
