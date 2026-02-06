/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps — Base Chain Integration Layer
 *
 * Connects the AgentSwaps server to deployed contracts on Base mainnet:
 *   - $SWAP Token (ERC-20 with trading rewards)
 *   - AgentSwapsDAO (governance)
 *   - AgentSwapsSettler (ERC-7683 cross-chain intents)
 *
 * Reads on-chain state and exposes it via REST endpoints.
 * Also provides functions for submitting on-chain transactions
 * (intent opening, settlement) when the server has a private key.
 */

const { ethers } = require('ethers');
const express = require('express');

// ============================================================================
// Contract Addresses (Base Mainnet — Chain ID 8453)
// ============================================================================

const CONTRACTS = {
  token: '0xA70DA9E19d102163983E3061c5Ade715f0dD36d3',
  dao: '0x27CfE2255dae29624D8DA82E6D389dcE5af0206B',
  settler: '0x0800Bd274441674f84526475a5daB5E7571e0Aa4',
  erc8004Registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
};

const ERC8004_AGENT_ID = 2065;

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const CHAIN_ID = 8453;

// ============================================================================
// ABI Fragments (read-only functions we need)
// ============================================================================

const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function usageDistributed() view returns (uint256)',
  'function usageRemaining() view returns (uint256)',
  'function governanceDistributed() view returns (uint256)',
  'function ecosystemDistributed() view returns (uint256)',
  'function liquidityDistributed() view returns (uint256)',
  'function totalDistributed() view returns (uint256)',
  'function totalRemaining() view returns (uint256)',
  'function USAGE_POOL() view returns (uint256)',
  'function LIQUIDITY_POOL() view returns (uint256)',
  'function GOVERNANCE_POOL() view returns (uint256)',
  'function ECOSYSTEM_POOL() view returns (uint256)',
  'function currentEpoch() view returns (uint256)',
  'function halvingDivisor() view returns (uint256)',
  'function genesisTime() view returns (uint256)',
  'function owner() view returns (address)',
];

const SETTLER_ABI = [
  'function totalOrdersOpened() view returns (uint256)',
  'function totalOrdersFilled() view returns (uint256)',
  'function feeBps() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function owner() view returns (address)',
  'function authorizedFillers(address) view returns (bool)',
  'function filledOrders(bytes32) view returns (bool)',
];

const DAO_ABI = [
  'function proposalCount() view returns (uint256)',
  'function quorumTokens() view returns (uint256)',
  'function votingDuration() view returns (uint256)',
  'function proposalThreshold() view returns (uint256)',
  'function token() view returns (address)',
];

// ============================================================================
// Module State
// ============================================================================

let provider = null;
let tokenContract = null;
let settlerContract = null;
let daoContract = null;
let initialized = false;

// Cached state (refreshed periodically)
let cachedState = null;
let lastRefresh = 0;
const CACHE_TTL_MS = 15_000; // 15 seconds

// ============================================================================
// Initialization
// ============================================================================

function initBase() {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    tokenContract = new ethers.Contract(CONTRACTS.token, TOKEN_ABI, provider);
    settlerContract = new ethers.Contract(CONTRACTS.settler, SETTLER_ABI, provider);
    daoContract = new ethers.Contract(CONTRACTS.dao, DAO_ABI, provider);
    initialized = true;
    console.log(`[base] Connected to Base mainnet (${RPC_URL})`);
    console.log(`[base] Token: ${CONTRACTS.token}`);
    console.log(`[base] Settler: ${CONTRACTS.settler}`);
    console.log(`[base] DAO: ${CONTRACTS.dao}`);
    console.log(`[base] ERC-8004 Agent ID: ${ERC8004_AGENT_ID}`);
    return true;
  } catch (err) {
    console.error(`[base] Init failed: ${err.message}`);
    return false;
  }
}

// ============================================================================
// On-Chain State Queries
// ============================================================================

async function getOnChainState() {
  if (!initialized) return null;

  // Return cached if fresh
  if (cachedState && Date.now() - lastRefresh < CACHE_TTL_MS) {
    return cachedState;
  }

  try {
    const [
      tokenName,
      tokenSymbol,
      totalSupply,
      usageDistributed,
      usageRemaining,
      governanceDistributed,
      ecosystemDistributed,
      liquidityDistributed,
      totalDistributed,
      totalRemaining,
      currentEpoch,
      halvingDivisor,
      tokenOwner,
      settlerOrdersOpened,
      settlerOrdersFilled,
      settlerFeeBps,
      settlerFeeRecipient,
      settlerOwner,
      daoProposalCount,
      daoQuorum,
      daoVotingDuration,
      daoThreshold,
      blockNumber,
    ] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.totalSupply(),
      tokenContract.usageDistributed(),
      tokenContract.usageRemaining(),
      tokenContract.governanceDistributed(),
      tokenContract.ecosystemDistributed(),
      tokenContract.liquidityDistributed(),
      tokenContract.totalDistributed(),
      tokenContract.totalRemaining(),
      tokenContract.currentEpoch(),
      tokenContract.halvingDivisor(),
      tokenContract.owner(),
      settlerContract.totalOrdersOpened(),
      settlerContract.totalOrdersFilled(),
      settlerContract.feeBps(),
      settlerContract.feeRecipient(),
      settlerContract.owner(),
      daoContract.proposalCount(),
      daoContract.quorumTokens(),
      daoContract.votingDuration(),
      daoContract.proposalThreshold(),
      provider.getBlockNumber(),
    ]);

    cachedState = {
      chain: 'base',
      chainId: CHAIN_ID,
      version: 2,
      fairLaunch: true,
      blockNumber,
      contracts: CONTRACTS,
      erc8004AgentId: ERC8004_AGENT_ID,
      token: {
        name: tokenName,
        symbol: tokenSymbol,
        totalSupply: ethers.formatEther(totalSupply),
        pools: {
          usage: { distributed: ethers.formatEther(usageDistributed), remaining: ethers.formatEther(usageRemaining) },
          governance: { distributed: ethers.formatEther(governanceDistributed) },
          ecosystem: { distributed: ethers.formatEther(ecosystemDistributed) },
          liquidity: { distributed: ethers.formatEther(liquidityDistributed) },
        },
        totalDistributed: ethers.formatEther(totalDistributed),
        totalRemaining: ethers.formatEther(totalRemaining),
        halving: {
          epoch: Number(currentEpoch),
          divisor: Number(halvingDivisor),
        },
        owner: tokenOwner,
      },
      settler: {
        ordersOpened: Number(settlerOrdersOpened),
        ordersFilled: Number(settlerOrdersFilled),
        feeBps: Number(settlerFeeBps),
        feePercent: `${Number(settlerFeeBps) / 100}%`,
        feeRecipient: settlerFeeRecipient,
        owner: settlerOwner,
        permissionlessFilling: true,
      },
      dao: {
        proposalCount: Number(daoProposalCount),
        quorum: ethers.formatEther(daoQuorum),
        votingDuration: `${Number(daoVotingDuration)} seconds`,
        proposalThreshold: ethers.formatEther(daoThreshold),
      },
      refreshedAt: new Date().toISOString(),
    };

    lastRefresh = Date.now();
    return cachedState;
  } catch (err) {
    console.error(`[base] State query failed: ${err.message}`);
    return cachedState || { error: err.message, chain: 'base' };
  }
}

async function getTokenBalance(address) {
  if (!initialized) return null;
  try {
    const balance = await tokenContract.balanceOf(address);
    return {
      address,
      token: 'SWAP',
      balance: ethers.formatEther(balance),
      raw: balance.toString(),
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function getEthBalance(address) {
  if (!initialized) return null;
  try {
    const balance = await provider.getBalance(address);
    return {
      address,
      token: 'ETH',
      balance: ethers.formatEther(balance),
      raw: balance.toString(),
    };
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================================
// Express Router
// ============================================================================

const router = express.Router();

// Full on-chain state
router.get('/state', async (req, res) => {
  const state = await getOnChainState();
  if (!state) {
    return res.status(503).json({ error: 'Base chain not connected' });
  }
  res.json(state);
});

// Contract addresses and links
router.get('/contracts', (req, res) => {
  res.json({
    chain: 'base',
    chainId: CHAIN_ID,
    explorer: 'https://basescan.org',
    contracts: {
      token: {
        address: CONTRACTS.token,
        name: '$SWAP Token',
        url: `https://basescan.org/address/${CONTRACTS.token}`,
      },
      dao: {
        address: CONTRACTS.dao,
        name: 'AgentSwaps DAO',
        url: `https://basescan.org/address/${CONTRACTS.dao}`,
      },
      settler: {
        address: CONTRACTS.settler,
        name: 'ERC-7683 Settler',
        url: `https://basescan.org/address/${CONTRACTS.settler}`,
      },
    },
    erc8004: {
      agentId: ERC8004_AGENT_ID,
      registry: CONTRACTS.erc8004Registry,
      url: `https://basescan.org/address/${CONTRACTS.erc8004Registry}`,
    },
  });
});

// Token balance lookup
router.get('/balance/:address', async (req, res) => {
  const [swapBalance, ethBalance] = await Promise.all([
    getTokenBalance(req.params.address),
    getEthBalance(req.params.address),
  ]);
  res.json({ swap: swapBalance, eth: ethBalance });
});

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  initBase,
  getOnChainState,
  getTokenBalance,
  getEthBalance,
  router,
  CONTRACTS,
  CHAIN_ID,
  ERC8004_AGENT_ID,
};
