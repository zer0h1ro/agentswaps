#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps — The First Agent-to-Agent DEX
 *
 * A persistent trading world where AI agents enter, post intents,
 * match with each other, and execute atomic swaps.
 *
 * World Model: The trading floor is a stateful environment that evolves
 * based on agent interactions. Agents pay entry fees, earn from trades,
 * and build reputation through successful swaps.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const solana = require('./solana');
const governance = require('./governance');
const x402 = require('./x402');
const base = require('./base');
const onchain = require('./onchain');

// ============================================================================
// World State — The persistent trading floor
// ============================================================================

const world = {
  name: 'AgentSwaps Trading Floor',
  version: '0.1.0',
  created: new Date().toISOString(),
  epoch: 0,

  // Registered agents in the world
  agents: new Map(),

  // Active intents (orders)
  intents: new Map(),

  // Completed swaps history
  swaps: [],

  // World economy
  economy: {
    totalVolume: 0,
    totalSwaps: 0,
    totalFees: 0,
    feeRate: 0.003, // 0.3% like Uniswap
    entryFee: 1.0, // 1 USDC to enter the world
    supportedTokens: ['USDC', 'ETH', 'SOL', 'MON', 'BTC'],
    tokenPrices: {
      USDC: 1.0,
      ETH: 2800.0,
      SOL: 120.0,
      MON: 0.5,
      BTC: 98000.0,
    },
  },

  // World events log
  events: [],

  // Leaderboard
  leaderboard: [],
};

// ============================================================================
// Agent Registry
// ============================================================================

function registerAgent(name, walletAddress, metadata = {}) {
  if (world.agents.has(name)) {
    return { success: false, error: 'Agent already registered' };
  }

  const agent = {
    id: uuidv4(),
    name,
    walletAddress,
    metadata,
    balance: { USDC: 0, ETH: 0, SOL: 0, MON: 0, BTC: 0 },
    reputation: 100, // Start with 100 reputation points
    swapsCompleted: 0,
    swapsFailed: 0,
    totalVolume: 0,
    enteredAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    status: 'active',
  };

  world.agents.set(name, agent);

  addEvent('agent_entered', {
    agent: name,
    message: `${name} entered the trading floor`,
  });

  return { success: true, agent };
}

function getAgent(name) {
  return world.agents.get(name) || null;
}

function depositTokens(agentName, token, amount) {
  const agent = world.agents.get(agentName);
  if (!agent) return { success: false, error: 'Agent not found' };
  if (!world.economy.supportedTokens.includes(token)) {
    return { success: false, error: `Token ${token} not supported` };
  }
  if (amount <= 0) return { success: false, error: 'Amount must be positive' };

  agent.balance[token] = (agent.balance[token] || 0) + amount;
  agent.lastActive = new Date().toISOString();

  addEvent('deposit', {
    agent: agentName,
    token,
    amount,
    message: `${agentName} deposited ${amount} ${token}`,
  });

  return { success: true, balance: agent.balance };
}

// ============================================================================
// Intent System — Post what you want to trade
// ============================================================================

function postIntent(agentName, give, want, options = {}) {
  const agent = world.agents.get(agentName);
  if (!agent) return { success: false, error: 'Agent not registered' };

  // Validate agent has sufficient balance
  if ((agent.balance[give.token] || 0) < give.amount) {
    return {
      success: false,
      error: `Insufficient ${give.token} balance. Have: ${agent.balance[give.token] || 0}, Need: ${give.amount}`,
    };
  }

  const intent = {
    id: uuidv4(),
    agent: agentName,
    give: { token: give.token, amount: give.amount },
    want: { token: want.token, minAmount: want.minAmount || 0, maxSlippage: want.maxSlippage || 0.01 },
    status: 'active',
    createdAt: new Date().toISOString(),
    expiresAt: options.expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1hr default
    metadata: options.metadata || {},
  };

  // Lock the tokens (escrow)
  agent.balance[give.token] -= give.amount;

  world.intents.set(intent.id, intent);
  agent.lastActive = new Date().toISOString();

  addEvent('intent_posted', {
    agent: agentName,
    intent: intent.id,
    give: `${give.amount} ${give.token}`,
    want: `${want.token}`,
    message: `${agentName} wants to swap ${give.amount} ${give.token} for ${want.token}`,
  });

  // Try to match immediately
  const match = findMatch(intent);
  if (match) {
    return executeSwap(intent, match);
  }

  return { success: true, intent, matched: false };
}

// ============================================================================
// Matching Engine — Find compatible intents
// ============================================================================

function findMatch(newIntent) {
  const activeIntents = [...world.intents.values()].filter(
    (i) =>
      i.status === 'active' &&
      i.id !== newIntent.id &&
      i.agent !== newIntent.agent && // Can't trade with yourself
      i.give.token === newIntent.want.token && // They give what we want
      i.want.token === newIntent.give.token // They want what we give
  );

  if (activeIntents.length === 0) return null;

  // Find best match by price compatibility
  for (const candidate of activeIntents) {
    const givePrice = world.economy.tokenPrices[newIntent.give.token] || 1;
    const wantPrice = world.economy.tokenPrices[newIntent.want.token] || 1;

    // Calculate implied exchange rate
    const marketRate = givePrice / wantPrice;
    const offerRate = newIntent.give.amount / (candidate.give.amount || 1);

    // Check if within slippage tolerance
    const slippage = Math.abs(offerRate - marketRate) / marketRate;
    if (slippage <= Math.max(newIntent.want.maxSlippage, candidate.want.maxSlippage)) {
      return candidate;
    }
  }

  // If no price-compatible match, return best available
  return activeIntents[0];
}

// ============================================================================
// Swap Execution — Atomic settlement
// ============================================================================

function executeSwap(intentA, intentB) {
  const agentA = world.agents.get(intentA.agent);
  const agentB = world.agents.get(intentB.agent);

  if (!agentA || !agentB) {
    return { success: false, error: 'Agent not found during swap' };
  }

  // Calculate swap amounts
  const giveAmountA = intentA.give.amount;
  const giveAmountB = intentB.give.amount;

  // Calculate fees (0.3% from each side)
  const feeA = giveAmountA * world.economy.feeRate;
  const feeB = giveAmountB * world.economy.feeRate;

  // Execute the swap
  // Agent A receives what Agent B gives (minus fee)
  agentA.balance[intentB.give.token] = (agentA.balance[intentB.give.token] || 0) + (giveAmountB - feeB);

  // Agent B receives what Agent A gives (minus fee)
  agentB.balance[intentA.give.token] = (agentB.balance[intentA.give.token] || 0) + (giveAmountA - feeA);

  // Calculate USD volume
  const volumeA = giveAmountA * (world.economy.tokenPrices[intentA.give.token] || 1);
  const volumeB = giveAmountB * (world.economy.tokenPrices[intentB.give.token] || 1);
  const totalVolume = volumeA + volumeB;

  // Update agent stats
  agentA.swapsCompleted++;
  agentA.totalVolume += volumeA;
  agentA.reputation += 5;
  agentA.lastActive = new Date().toISOString();

  agentB.swapsCompleted++;
  agentB.totalVolume += volumeB;
  agentB.reputation += 5;
  agentB.lastActive = new Date().toISOString();

  // Update world state
  world.economy.totalVolume += totalVolume;
  world.economy.totalSwaps++;
  world.economy.totalFees +=
    feeA * (world.economy.tokenPrices[intentA.give.token] || 1) +
    feeB * (world.economy.tokenPrices[intentB.give.token] || 1);

  // Mark intents as filled
  intentA.status = 'filled';
  intentB.status = 'filled';

  // Record swap
  const swap = {
    id: uuidv4(),
    intentA: intentA.id,
    intentB: intentB.id,
    agentA: intentA.agent,
    agentB: intentB.agent,
    giveA: { token: intentA.give.token, amount: giveAmountA },
    giveB: { token: intentB.give.token, amount: giveAmountB },
    feeA,
    feeB,
    volumeUSD: totalVolume,
    executedAt: new Date().toISOString(),
  };

  world.swaps.push(swap);
  world.epoch++;

  addEvent('swap_executed', {
    swap: swap.id,
    agentA: intentA.agent,
    agentB: intentB.agent,
    message: `SWAP: ${intentA.agent} gave ${giveAmountA} ${intentA.give.token} ↔ ${intentB.agent} gave ${giveAmountB} ${intentB.give.token}`,
    volumeUSD: totalVolume,
  });

  updateLeaderboard();

  // Reward $SWAP tokens — in-memory tracking
  governance.rewardSwap(intentA.agent, volumeA);
  governance.rewardSwap(intentB.agent, volumeB);

  // Distribute $SWAP rewards on-chain (non-blocking)
  if (agentA.walletAddress && agentB.walletAddress) {
    onchain
      .distributeSwapRewards(agentA.walletAddress, agentB.walletAddress)
      .then((rewards) => {
        swap.onChainRewards = rewards;
        if (rewards.rewardA.success) {
          addEvent('reward_distributed', {
            agent: intentA.agent,
            reward: rewards.rewardA.reward,
            txHash: rewards.rewardA.txHash,
            message: `${intentA.agent} earned ${rewards.rewardA.reward} $SWAP on-chain`,
          });
        }
        if (rewards.rewardB.success) {
          addEvent('reward_distributed', {
            agent: intentB.agent,
            reward: rewards.rewardB.reward,
            txHash: rewards.rewardB.txHash,
            message: `${intentB.agent} earned ${rewards.rewardB.reward} $SWAP on-chain`,
          });
        }
      })
      .catch((err) => {
        console.error(`[onchain] Reward distribution failed: ${err.message}`);
      });
  }

  // Record swap proof on Solana (non-blocking)
  solana
    .recordSwapOnChain(swap)
    .then((result) => {
      swap.onChain = result;
    })
    .catch(() => {});

  return {
    success: true,
    matched: true,
    swap,
    balanceA: agentA.balance,
    balanceB: agentB.balance,
  };
}

// ============================================================================
// World State Queries
// ============================================================================

function getWorldState() {
  return {
    name: world.name,
    version: world.version,
    epoch: world.epoch,
    agents: world.agents.size,
    activeIntents: [...world.intents.values()].filter((i) => i.status === 'active').length,
    totalSwaps: world.economy.totalSwaps,
    totalVolume: world.economy.totalVolume,
    totalFees: world.economy.totalFees,
    tokenPrices: world.economy.tokenPrices,
    supportedTokens: world.economy.supportedTokens,
    recentEvents: world.events.slice(-20),
    leaderboard: world.leaderboard.slice(0, 10),
  };
}

function getActiveIntents(token) {
  const intents = [...world.intents.values()].filter((i) => i.status === 'active');
  if (token) {
    return intents.filter((i) => i.give.token === token || i.want.token === token);
  }
  return intents;
}

function getSwapHistory(limit = 50) {
  return world.swaps.slice(-limit).reverse();
}

function updateLeaderboard() {
  world.leaderboard = [...world.agents.values()]
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 20)
    .map((a) => ({
      name: a.name,
      volume: a.totalVolume,
      swaps: a.swapsCompleted,
      reputation: a.reputation,
    }));
}

// ============================================================================
// Event System
// ============================================================================

function addEvent(type, data) {
  const event = {
    id: uuidv4(),
    type,
    data,
    timestamp: new Date().toISOString(),
    epoch: world.epoch,
  };
  world.events.push(event);

  // Keep last 1000 events
  if (world.events.length > 1000) {
    world.events = world.events.slice(-1000);
  }

  // Console log for demo visibility
  console.log(`[${event.timestamp}] [${type}] ${data.message || JSON.stringify(data)}`);

  return event;
}

// ============================================================================
// REST API — Interface for external agents
// ============================================================================

const app = express();
app.use(express.json());

// x402 Payment Middleware — gate paid endpoints with USDC micropayments on Base
// Activate by setting: X402_ENABLED=true X402_PAY_TO=0xYourAddress
app.use(x402.paymentMiddleware());

// x402 Admin — payment status, pricing table, service discovery
app.use('/api/x402', x402.router);

// World state (includes on-chain data from Base)
app.get('/api/world', async (req, res) => {
  const worldState = getWorldState();
  const onChainState = await base.getOnChainState();
  res.json({
    ...worldState,
    base: onChainState,
  });
});

// Register agent
app.post('/api/agents', (req, res) => {
  const { name, walletAddress, metadata } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = registerAgent(name, walletAddress || `0x${uuidv4().replace(/-/g, '')}`, metadata);
  res.json(result);
});

// Get agent info (enriched with on-chain balance)
app.get('/api/agents/:name', async (req, res) => {
  const agent = getAgent(req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Enrich with on-chain $SWAP balance if agent has a wallet
  const enriched = { ...agent };
  if (agent.walletAddress && ethers.isAddress(agent.walletAddress)) {
    enriched.onChainSwapBalance = await onchain.getSwapBalance(agent.walletAddress);
  }
  res.json(enriched);
});

// Deposit tokens
app.post('/api/agents/:name/deposit', (req, res) => {
  const { token, amount } = req.body;
  if (!token || !amount) return res.status(400).json({ error: 'token and amount required' });
  const result = depositTokens(req.params.name, token, amount);
  res.json(result);
});

// Post intent
app.post('/api/intents', (req, res) => {
  const { agent, give, want, options } = req.body;
  if (!agent || !give || !want) {
    return res.status(400).json({ error: 'agent, give, and want are required' });
  }
  const result = postIntent(agent, give, want, options);
  res.json(result);
});

// Get active intents
app.get('/api/intents', (req, res) => {
  const { token } = req.query;
  res.json(getActiveIntents(token));
});

// Get swap history
app.get('/api/swaps', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(getSwapHistory(limit));
});

// Get leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(world.leaderboard);
});

// Get events stream
app.get('/api/events', (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : null;
  let events = world.events;
  if (since) {
    events = events.filter((e) => new Date(e.timestamp) > since);
  }
  res.json(events.slice(-100));
});

// Solana status
app.get('/api/solana', async (req, res) => {
  const status = await solana.getConnectionStatus();
  res.json(status || { connected: false });
});

// Solana agent wallet
app.get('/api/agents/:name/wallet', (req, res) => {
  const agent = getAgent(req.params.name);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  try {
    const wallet = solana.getAgentWallet(req.params.name);
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live token prices from Jupiter
app.get('/api/prices', async (req, res) => {
  const prices = await solana.getTokenPrices(world.economy.supportedTokens);
  // Update world prices with live data
  if (Object.keys(prices).length > 0) {
    Object.assign(world.economy.tokenPrices, prices);
  }
  res.json(world.economy.tokenPrices);
});

// Governance API
app.use('/api/governance', governance.router);

// Base chain API — on-chain state, contracts, balances
app.use('/api/base', base.router);

// On-chain reward status
app.get('/api/onchain/status', (req, res) => {
  res.json(onchain.getStatus());
});

// On-chain $SWAP balance for an agent
app.get('/api/onchain/balance/:address', async (req, res) => {
  const balance = await onchain.getSwapBalance(req.params.address);
  res.json({ address: req.params.address, token: 'SWAP', balance });
});

// Health check
app.get('/health', async (req, res) => {
  const solStatus = await solana.getConnectionStatus();
  const baseState = await base.getOnChainState();
  const onchainStatus = onchain.getStatus();
  res.json({
    status: 'ok',
    world: world.name,
    version: 2,
    fairLaunch: true,
    agents: world.agents.size,
    uptime: process.uptime(),
    solana: solStatus ? { connected: solStatus.connected, network: solStatus.network } : null,
    base: baseState ? { connected: true, chainId: base.CHAIN_ID, blockNumber: baseState.blockNumber } : null,
    onchain: { initialized: onchainStatus.initialized, rewards: onchainStatus.stats },
  });
});

// ============================================================================
// Start Server
// ============================================================================

const PORT = process.env.PORT || 8800;

// Initialize Solana connection
try {
  solana.initSolana({ network: process.env.SOLANA_NETWORK || 'devnet' });
} catch (err) {
  console.warn(`[solana] Init failed: ${err.message} — running in off-chain mode`);
}

// Initialize Base chain connection (read-only)
base.initBase();

// Initialize on-chain writer (deployer wallet)
onchain.init().catch((err) => {
  console.warn(`[onchain] Init failed: ${err.message} — rewards will be in-memory only`);
});

// Periodically update token prices from Jupiter (every 60s)
setInterval(async () => {
  try {
    const prices = await solana.getTokenPrices(world.economy.supportedTokens);
    if (Object.keys(prices).length > 0) {
      Object.assign(world.economy.tokenPrices, prices);
    }
  } catch {
    /* ignore */
  }
}, 60000);

const x402Config = x402.resolveConfig();

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  AgentSwaps Trading Floor v${world.version}`);
  console.log(`  The first DEX where both sides are AI`);
  console.log(`========================================`);
  console.log(`  API: http://localhost:${PORT}/api/world`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`  Agents: ${world.agents.size}`);
  console.log(`  Supported tokens: ${world.economy.supportedTokens.join(', ')}`);
  console.log(`  Fee: ${world.economy.feeRate * 100}%`);
  console.log(
    `  x402: ${x402Config.enabled ? `ACTIVE (${x402Config.environment}, ${x402Config.network})` : 'inactive'}`
  );
  console.log(`  Base chain: http://localhost:${PORT}/api/base/state`);
  console.log(`  Contracts: http://localhost:${PORT}/api/base/contracts`);
  console.log(`  On-chain rewards: http://localhost:${PORT}/api/onchain/status`);
  console.log(`  Pricing: http://localhost:${PORT}/api/x402/pricing`);
  console.log(`  Discovery: http://localhost:${PORT}/api/x402/discover`);
  console.log(`========================================\n`);
});

module.exports = {
  registerAgent,
  depositTokens,
  postIntent,
  getWorldState,
  getActiveIntents,
  getSwapHistory,
  world,
  app,
};
