#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps Demo — Two AI agents trading autonomously
 *
 * Demonstrates the full flow:
 * 1. Two agents register on the trading floor
 * 2. Each deposits tokens
 * 3. They post intents (what they want to trade)
 * 4. The matching engine finds compatible intents
 * 5. Smart contract executes the swap atomically
 * 6. Both agents walk away with what they wanted
 *
 * No humans in the loop. Both sides are AI.
 */

const http = require('http');

const BASE = 'http://localhost:8800';

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runDemo() {
  console.log('\n========================================');
  console.log('  AgentSwaps Demo');
  console.log('  Two AI Agents Trading Autonomously');
  console.log('========================================\n');

  // Step 1: Register agents
  console.log('--- Step 1: Agent Registration ---\n');

  const agentA = await apiCall('POST', '/api/agents', {
    name: 'AlphaTrader',
    walletAddress: '0xAlpha001',
    metadata: {
      type: 'trading-bot',
      strategy: 'momentum',
      description: 'AI trading agent focused on ETH momentum signals',
    },
  });
  console.log(`Agent A registered: ${agentA.agent?.name || 'already exists'}`);

  const agentB = await apiCall('POST', '/api/agents', {
    name: 'BetaYield',
    walletAddress: '0xBeta002',
    metadata: {
      type: 'yield-optimizer',
      strategy: 'yield-farming',
      description: 'AI agent optimizing stablecoin yields across protocols',
    },
  });
  console.log(`Agent B registered: ${agentB.agent?.name || 'already exists'}`);

  const agentC = await apiCall('POST', '/api/agents', {
    name: 'GammaArb',
    walletAddress: '0xGamma003',
    metadata: {
      type: 'arbitrage-bot',
      strategy: 'cross-dex-arb',
      description: 'AI arbitrage agent exploiting price differences',
    },
  });
  console.log(`Agent C registered: ${agentC.agent?.name || 'already exists'}`);

  await sleep(500);

  // Step 2: Deposit tokens
  console.log('\n--- Step 2: Token Deposits ---\n');

  await apiCall('POST', '/api/agents/AlphaTrader/deposit', { token: 'USDC', amount: 5000 });
  console.log('AlphaTrader deposited 5,000 USDC');

  await apiCall('POST', '/api/agents/AlphaTrader/deposit', { token: 'ETH', amount: 2 });
  console.log('AlphaTrader deposited 2 ETH');

  await apiCall('POST', '/api/agents/BetaYield/deposit', { token: 'ETH', amount: 3 });
  console.log('BetaYield deposited 3 ETH');

  await apiCall('POST', '/api/agents/BetaYield/deposit', { token: 'USDC', amount: 10000 });
  console.log('BetaYield deposited 10,000 USDC');

  await apiCall('POST', '/api/agents/GammaArb/deposit', { token: 'SOL', amount: 50 });
  console.log('GammaArb deposited 50 SOL');

  await apiCall('POST', '/api/agents/GammaArb/deposit', { token: 'USDC', amount: 3000 });
  console.log('GammaArb deposited 3,000 USDC');

  await sleep(500);

  // Step 3: Post intents and execute swaps
  console.log('\n--- Step 3: Intent Posting & Matching ---\n');

  // Swap 1: AlphaTrader wants ETH, BetaYield wants USDC
  console.log('AlphaTrader posts intent: sell 2800 USDC, want ETH...');
  const intent1 = await apiCall('POST', '/api/intents', {
    agent: 'AlphaTrader',
    give: { token: 'USDC', amount: 2800 },
    want: { token: 'ETH', maxSlippage: 0.02 },
  });
  console.log(`  Result: ${intent1.matched ? 'MATCHED!' : 'Waiting for counterparty...'}`);

  await sleep(1000);

  console.log('BetaYield posts intent: sell 1 ETH, want USDC...');
  const intent2 = await apiCall('POST', '/api/intents', {
    agent: 'BetaYield',
    give: { token: 'ETH', amount: 1 },
    want: { token: 'USDC', maxSlippage: 0.02 },
  });

  if (intent2.matched) {
    console.log(`  SWAP EXECUTED!`);
    console.log(`  AlphaTrader gave 2800 USDC -> received ~1 ETH`);
    console.log(`  BetaYield gave 1 ETH -> received ~2800 USDC`);
    console.log(`  Fee: 0.3% from each side`);
    console.log(`  Swap ID: ${intent2.swap?.id}`);
  }

  await sleep(1000);

  // Swap 2: GammaArb sells SOL for USDC
  console.log('\nGammaArb posts intent: sell 25 SOL, want USDC...');
  const intent3 = await apiCall('POST', '/api/intents', {
    agent: 'GammaArb',
    give: { token: 'SOL', amount: 25 },
    want: { token: 'USDC', maxSlippage: 0.03 },
  });
  console.log(`  Result: ${intent3.matched ? 'MATCHED!' : 'Waiting... (no SOL buyers yet)'}`);

  await sleep(500);

  // AlphaTrader wants SOL
  console.log('AlphaTrader posts intent: sell 2000 USDC, want SOL...');
  const intent4 = await apiCall('POST', '/api/intents', {
    agent: 'AlphaTrader',
    give: { token: 'USDC', amount: 2000 },
    want: { token: 'SOL', maxSlippage: 0.03 },
  });

  if (intent4.matched) {
    console.log(`  SWAP EXECUTED!`);
    console.log(`  GammaArb gave 25 SOL -> received USDC`);
    console.log(`  AlphaTrader gave 2000 USDC -> received ~25 SOL`);
    console.log(`  Swap ID: ${intent4.swap?.id}`);
  }

  await sleep(1000);

  // Step 4: Show world state
  console.log('\n--- Step 4: World State ---\n');

  const worldState = await apiCall('GET', '/api/world');
  console.log(`Trading Floor: ${worldState.name}`);
  console.log(`Epoch: ${worldState.epoch}`);
  console.log(`Active Agents: ${worldState.agents}`);
  console.log(`Total Swaps: ${worldState.totalSwaps}`);
  console.log(`Total Volume: $${worldState.totalVolume?.toFixed(2)}`);
  console.log(`Total Fees Collected: $${worldState.totalFees?.toFixed(2)}`);
  console.log(`Active Intents: ${worldState.activeIntents}`);

  // Step 5: Show leaderboard
  console.log('\n--- Step 5: Leaderboard ---\n');

  const leaderboard = await apiCall('GET', '/api/leaderboard');
  if (leaderboard.length > 0) {
    console.log('Rank | Agent         | Volume     | Swaps | Rep');
    console.log('-----|---------------|-----------|-------|----');
    leaderboard.forEach((entry, i) => {
      console.log(
        `  ${i + 1}  | ${entry.name.padEnd(13)} | $${entry.volume.toFixed(2).padStart(8)} | ${String(entry.swaps).padStart(5)} | ${entry.reputation}`
      );
    });
  }

  // Step 6: Show agent balances
  console.log('\n--- Step 6: Final Balances ---\n');

  for (const name of ['AlphaTrader', 'BetaYield', 'GammaArb']) {
    const agent = await apiCall('GET', `/api/agents/${name}`);
    if (agent && agent.balance) {
      const nonZero = Object.entries(agent.balance)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v.toFixed(4)} ${k}`)
        .join(', ');
      console.log(`${name}: ${nonZero || 'empty'}`);
    }
  }

  console.log('\n========================================');
  console.log('  Demo Complete!');
  console.log('  All swaps executed autonomously.');
  console.log('  No humans were involved.');
  console.log('  Both sides of every trade were AI agents.');
  console.log('========================================\n');
}

runDemo().catch(console.error);
