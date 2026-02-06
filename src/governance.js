/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * $SWAP Token & DAO Governance Module
 *
 * Implements the governance token for AgentSwaps:
 * - 1B total supply with 5-pool distribution
 * - Trading rewards minted proportional to volume
 * - Proposal creation + vote-weighted governance
 *
 * All in-memory for hackathon demo — no blockchain yet.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

// ============================================================================
// $SWAP Token — Tokenomics
// ============================================================================

const TOTAL_SUPPLY = 1_000_000_000; // 1 Billion $SWAP

// v2 Fair Launch — all tokens locked in contract, earned through usage
const DISTRIBUTION = {
  usage: { label: 'Usage Rewards', pct: 0.5, cap: TOTAL_SUPPLY * 0.5, minted: 0 },
  liquidity: { label: 'Liquidity', pct: 0.2, cap: TOTAL_SUPPLY * 0.2, minted: 0 },
  governance: { label: 'Governance', pct: 0.2, cap: TOTAL_SUPPLY * 0.2, minted: 0 },
  ecosystem: { label: 'Ecosystem', pct: 0.1, cap: TOTAL_SUPPLY * 0.1, minted: 0 },
};

// $SWAP balances per agent (agentName -> balance)
const balances = new Map();

// Governance proposals
const proposals = [];

// Reward rate: $SWAP per $1 USD volume
const REWARD_PER_USD = 100; // 100 $SWAP per $1 traded

// Voting period duration (ms) — 24 hours for demo
const VOTING_PERIOD_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Token Operations
// ============================================================================

/**
 * Get an agent's $SWAP balance. Returns 0 for unknown agents.
 */
function getTokenBalance(agentName) {
  return balances.get(agentName) || 0;
}

/**
 * Mint $SWAP tokens to an agent from the Trading Rewards pool.
 * Called after each swap to reward participants.
 *
 * @param {string} agentName - Agent receiving the reward
 * @param {number} volumeUSD - USD volume of their side of the trade
 * @returns {{ minted: number, balance: number, pool: object }}
 */
function rewardSwap(agentName, volumeUSD) {
  const pool = DISTRIBUTION.usage;
  const amount = Math.floor(volumeUSD * REWARD_PER_USD);

  // Cap at pool limit
  const mintable = Math.min(amount, pool.cap - pool.minted);
  if (mintable <= 0) {
    return { minted: 0, balance: getTokenBalance(agentName), pool: poolStats('usage') };
  }

  pool.minted += mintable;
  const prev = balances.get(agentName) || 0;
  balances.set(agentName, prev + mintable);

  return {
    minted: mintable,
    balance: balances.get(agentName),
    pool: poolStats('usage'),
  };
}

/**
 * Return stats for a single distribution pool.
 */
function poolStats(key) {
  const p = DISTRIBUTION[key];
  return {
    label: p.label,
    percentage: p.pct * 100,
    cap: p.cap,
    minted: p.minted,
    remaining: p.cap - p.minted,
  };
}

/**
 * Return full tokenomics overview.
 */
function getTokenomics() {
  const totalMinted = Object.values(DISTRIBUTION).reduce((s, p) => s + p.minted, 0);
  return {
    token: '$SWAP',
    version: 2,
    fairLaunch: true,
    totalSupply: TOTAL_SUPPLY,
    totalMinted,
    circulatingPct: ((totalMinted / TOTAL_SUPPLY) * 100).toFixed(4),
    rewardRate: `${REWARD_PER_USD} $SWAP per $1 USD volume`,
    halvingPeriod: '180 days',
    onChainToken: '0xA70DA9E19d102163983E3061c5Ade715f0dD36d3',
    pools: Object.fromEntries(
      Object.entries(DISTRIBUTION).map(([k, p]) => [
        k,
        {
          label: p.label,
          percentage: p.pct * 100,
          cap: p.cap,
          minted: p.minted,
          remaining: p.cap - p.minted,
        },
      ])
    ),
    holders: balances.size,
    topHolders: [...balances.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, balance]) => ({ name, balance })),
  };
}

// ============================================================================
// Governance — Proposals & Voting
// ============================================================================

/**
 * Create a governance proposal. Requires a $SWAP balance > 0.
 *
 * @param {string} agentName - Proposer
 * @param {string} title - Short title
 * @param {string} description - Proposal body
 * @param {string[]} options - Vote options (e.g. ["For", "Against", "Abstain"])
 * @returns {{ success: boolean, proposal?: object, error?: string }}
 */
function createProposal(agentName, title, description, options) {
  const balance = getTokenBalance(agentName);
  if (balance <= 0) {
    return { success: false, error: 'Must hold $SWAP to create proposals' };
  }
  if (!title || !description) {
    return { success: false, error: 'title and description are required' };
  }
  if (!options || options.length < 2) {
    return { success: false, error: 'At least 2 options required' };
  }

  const proposal = {
    id: uuidv4(),
    proposer: agentName,
    title,
    description,
    options: options.map((label) => ({ label, votes: 0, voters: [] })),
    createdAt: new Date().toISOString(),
    votingEndsAt: new Date(Date.now() + VOTING_PERIOD_MS).toISOString(),
    status: 'active', // active | passed | rejected | expired
    totalVotes: 0,
  };

  proposals.push(proposal);
  return { success: true, proposal };
}

/**
 * Vote on a proposal. Vote weight = agent's $SWAP balance at time of vote.
 * Each agent can only vote once per proposal.
 *
 * @param {string} agentName - Voter
 * @param {string} proposalId - Proposal UUID
 * @param {number} optionIndex - Which option to vote for (0-indexed)
 * @returns {{ success: boolean, error?: string, proposal?: object }}
 */
function vote(agentName, proposalId, optionIndex) {
  const proposal = proposals.find((p) => p.id === proposalId);
  if (!proposal) {
    return { success: false, error: 'Proposal not found' };
  }

  // Check voting period
  if (new Date() > new Date(proposal.votingEndsAt)) {
    finalizeProposal(proposal);
    return { success: false, error: 'Voting period has ended' };
  }

  if (proposal.status !== 'active') {
    return { success: false, error: `Proposal is ${proposal.status}` };
  }

  // Validate option
  if (optionIndex < 0 || optionIndex >= proposal.options.length) {
    return { success: false, error: `Invalid option index. Must be 0-${proposal.options.length - 1}` };
  }

  // Check if already voted
  const alreadyVoted = proposal.options.some((opt) => opt.voters.includes(agentName));
  if (alreadyVoted) {
    return { success: false, error: 'Agent has already voted on this proposal' };
  }

  // Vote weight = $SWAP balance
  const weight = getTokenBalance(agentName);
  if (weight <= 0) {
    return { success: false, error: 'Must hold $SWAP to vote' };
  }

  proposal.options[optionIndex].votes += weight;
  proposal.options[optionIndex].voters.push(agentName);
  proposal.totalVotes += weight;

  return { success: true, proposal: formatProposal(proposal) };
}

/**
 * Finalize a proposal after voting ends.
 */
function finalizeProposal(proposal) {
  if (proposal.status !== 'active') return;

  if (proposal.totalVotes === 0) {
    proposal.status = 'expired';
    return;
  }

  // Find winning option
  let maxVotes = 0;
  let winnerIdx = -1;
  for (let i = 0; i < proposal.options.length; i++) {
    if (proposal.options[i].votes > maxVotes) {
      maxVotes = proposal.options[i].votes;
      winnerIdx = i;
    }
  }

  // Majority = more than 50% of votes cast
  if (maxVotes > proposal.totalVotes / 2) {
    proposal.status = 'passed';
    proposal.winner = proposal.options[winnerIdx].label;
  } else {
    proposal.status = 'rejected';
  }
}

/**
 * Get all proposals with formatted vote counts.
 * Auto-finalizes expired proposals.
 */
function getProposals() {
  const now = new Date();
  for (const p of proposals) {
    if (p.status === 'active' && now > new Date(p.votingEndsAt)) {
      finalizeProposal(p);
    }
  }
  return proposals.map(formatProposal);
}

/**
 * Format a proposal for API response.
 */
function formatProposal(p) {
  return {
    id: p.id,
    proposer: p.proposer,
    title: p.title,
    description: p.description,
    options: p.options.map((o) => ({
      label: o.label,
      votes: o.votes,
      voterCount: o.voters.length,
    })),
    totalVotes: p.totalVotes,
    status: p.status,
    winner: p.winner || null,
    createdAt: p.createdAt,
    votingEndsAt: p.votingEndsAt,
  };
}

// ============================================================================
// REST API Router
// ============================================================================

const router = express.Router();

// GET /api/governance/tokenomics — full tokenomics overview
router.get('/tokenomics', (req, res) => {
  res.json(getTokenomics());
});

// GET /api/governance/proposals — list all proposals
router.get('/proposals', (req, res) => {
  res.json(getProposals());
});

// POST /api/governance/proposals — create a proposal
router.post('/proposals', (req, res) => {
  const { agent, title, description, options } = req.body;
  if (!agent) return res.status(400).json({ error: 'agent is required' });
  const result = createProposal(agent, title, description, options);
  if (!result.success) return res.status(400).json(result);
  res.status(201).json(result);
});

// POST /api/governance/proposals/:id/vote — vote on a proposal
router.post('/proposals/:id/vote', (req, res) => {
  const { agent, optionIndex } = req.body;
  if (!agent || optionIndex === undefined) {
    return res.status(400).json({ error: 'agent and optionIndex are required' });
  }
  const result = vote(agent, req.params.id, optionIndex);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// GET /api/governance/balance/:agent — get agent's $SWAP balance
router.get('/balance/:agent', (req, res) => {
  const balance = getTokenBalance(req.params.agent);
  res.json({ agent: req.params.agent, balance, token: '$SWAP' });
});

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  router,
  rewardSwap,
  getTokenBalance,
  createProposal,
  vote,
  getProposals,
  getTokenomics,
  TOTAL_SUPPLY,
  REWARD_PER_USD,
};
