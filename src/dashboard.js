#!/usr/bin/env node
/**
 * AgentSwaps Live Dashboard — Terminal visualization of the trading floor
 *
 * Polls the AgentSwaps API and renders a live dashboard showing:
 * - World state (epoch, volume, fees)
 * - Active agents and balances
 * - Recent swaps
 * - Leaderboard
 * - Active intents
 */

const http = require('http');

const BASE = process.env.AGENTSWAPS_URL || 'http://localhost:8800';
const REFRESH_MS = 2000;

function apiCall(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function clearScreen() {
  process.stdout.write('\x1B[2J\x1B[H');
}

function pad(str, len) {
  return String(str).padEnd(len);
}

function rpad(str, len) {
  return String(str).padStart(len);
}

function formatUSD(n) {
  return '$' + (n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function render() {
  try {
    const [world, intents, swaps, leaderboard] = await Promise.all([
      apiCall('/api/world'),
      apiCall('/api/intents'),
      apiCall('/api/swaps?limit=10'),
      apiCall('/api/leaderboard'),
    ]);

    if (!world) {
      console.log('Waiting for AgentSwaps server...');
      return;
    }

    clearScreen();

    // Header
    console.log('\x1b[36m\x1b[1m');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║          AgentSwaps — Live Trading Dashboard            ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log('\x1b[0m');

    // World State
    console.log('\x1b[33m  ▸ World State\x1b[0m');
    console.log(`    Epoch: ${world.epoch}  |  Agents: ${world.agents}  |  Active Intents: ${world.activeIntents}`);
    console.log(`    Total Volume: ${formatUSD(world.totalVolume)}  |  Total Swaps: ${world.totalSwaps}  |  Fees: ${formatUSD(world.totalFees)}`);
    console.log();

    // Token Prices
    console.log('\x1b[33m  ▸ Token Prices\x1b[0m');
    const prices = Object.entries(world.tokenPrices || {})
      .map(([t, p]) => `${t}: ${formatUSD(p)}`)
      .join('  |  ');
    console.log(`    ${prices}`);
    console.log();

    // Leaderboard
    if (leaderboard && leaderboard.length > 0) {
      console.log('\x1b[33m  ▸ Leaderboard\x1b[0m');
      console.log(`    ${pad('Rank', 6)}${pad('Agent', 18)}${rpad('Volume', 14)}${rpad('Swaps', 8)}${rpad('Rep', 6)}`);
      console.log('    ' + '─'.repeat(52));
      leaderboard.forEach((entry, i) => {
        const rank = i === 0 ? '\x1b[36m★\x1b[0m' : ` ${i + 1}`;
        console.log(`    ${pad(rank, 6)}${pad(entry.name, 18)}${rpad(formatUSD(entry.volume), 14)}${rpad(entry.swaps, 8)}${rpad(entry.reputation, 6)}`);
      });
      console.log();
    }

    // Active Intents
    if (intents && intents.length > 0) {
      console.log('\x1b[33m  ▸ Active Intents\x1b[0m');
      intents.slice(0, 8).forEach((intent) => {
        console.log(`    ${pad(intent.agent, 16)} gives ${intent.give.amount} ${pad(intent.give.token, 6)} wants ${intent.want.token}`);
      });
      console.log();
    }

    // Recent Swaps
    if (swaps && swaps.length > 0) {
      console.log('\x1b[33m  ▸ Recent Swaps\x1b[0m');
      swaps.slice(0, 8).forEach((swap) => {
        const time = new Date(swap.executedAt).toLocaleTimeString();
        console.log(
          `    \x1b[32m✓\x1b[0m ${time}  ${pad(swap.agentA, 14)} ${swap.giveA.amount} ${pad(swap.giveA.token, 5)} ↔ ${pad(swap.agentB, 14)} ${swap.giveB.amount} ${swap.giveB.token}  (${formatUSD(swap.volumeUSD)})`
        );
      });
      console.log();
    }

    // Footer
    console.log(`\x1b[90m  Refreshing every ${REFRESH_MS / 1000}s  |  ${BASE}  |  Ctrl+C to exit\x1b[0m`);
  } catch (err) {
    console.log(`\x1b[31m  Connection error: ${err.message}\x1b[0m`);
    console.log(`\x1b[90m  Make sure the AgentSwaps server is running: npm start\x1b[0m`);
  }
}

// Run
render();
const interval = setInterval(render, REFRESH_MS);

process.on('SIGINT', () => {
  clearInterval(interval);
  clearScreen();
  console.log('\nDashboard closed.\n');
  process.exit(0);
});
