#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps MCP Client Demo
 *
 * Demonstrates an AI agent connecting to the AgentSwaps MCP server
 * and executing a full trading workflow via MCP tool calls.
 *
 * This is the demo flow for the x402 hackathon (Feb 11-13).
 *
 * Flow:
 *   1. Connect to AgentSwaps MCP server via stdio
 *   2. Discover available tools
 *   3. Check world state (free)
 *   4. Register an agent
 *   5. Deposit tokens
 *   6. Post a trade intent
 *   7. Check orderbook and swap history
 *
 * Usage:
 *   node src/mcp-demo.js              # free mode (no payment)
 *   X402_DEMO=true node src/mcp-demo.js  # simulate payment flow
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

const AGENT_NAME = `demo-agent-${Date.now().toString(36)}`;

function log(emoji, msg) {
  console.log(`\n${emoji}  ${msg}`);
}

function logResult(result) {
  if (result.content && result.content[0]) {
    try {
      const data = JSON.parse(result.content[0].text);
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log(result.content[0].text.substring(0, 200));
    }
  }
}

async function main() {
  log('🔌', 'Connecting to AgentSwaps MCP server...');

  // Spawn the MCP server as a child process
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, 'mcp-server.js')],
    env: { ...process.env },
  });

  const client = new Client({ name: 'demo-client', version: '1.0.0' });
  await client.connect(transport);

  log('✅', 'Connected to AgentSwaps MCP server');

  // ── Step 1: Discover tools ──────────────────────────────────────────
  log('🔍', 'Discovering available tools...');
  const { tools } = await client.listTools();
  console.log(`\n  Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`    - ${tool.name}: ${tool.description.substring(0, 70)}...`);
  }

  // ── Step 2: Check world state (free tool) ───────────────────────────
  log('🌍', 'Getting world state (free)...');
  const world = await client.callTool({ name: 'get_world', arguments: {} });
  logResult(world);

  // ── Step 3: Check prices (free tool) ────────────────────────────────
  log('💰', 'Getting token prices (free)...');
  const prices = await client.callTool({ name: 'get_prices', arguments: {} });
  logResult(prices);

  // ── Step 4: Register agent ──────────────────────────────────────────
  log('📝', `Registering agent "${AGENT_NAME}"...`);
  const reg = await client.callTool({
    name: 'register_agent',
    arguments: {
      name: AGENT_NAME,
      description: 'MCP demo agent — autonomous trader',
    },
  });
  logResult(reg);

  // ── Step 5: Deposit tokens ──────────────────────────────────────────
  log('💎', 'Depositing 1000 USDC...');
  const dep1 = await client.callTool({
    name: 'deposit',
    arguments: { agent: AGENT_NAME, token: 'USDC', amount: 1000 },
  });
  logResult(dep1);

  log('💎', 'Depositing 0.5 ETH...');
  const dep2 = await client.callTool({
    name: 'deposit',
    arguments: { agent: AGENT_NAME, token: 'ETH', amount: 0.5 },
  });
  logResult(dep2);

  // ── Step 6: Check agent details ─────────────────────────────────────
  log('👤', `Getting agent details for "${AGENT_NAME}"...`);
  const agent = await client.callTool({
    name: 'get_agent',
    arguments: { name: AGENT_NAME },
  });
  logResult(agent);

  // ── Step 7: Post trade intent ───────────────────────────────────────
  log('📊', 'Posting trade intent: sell 500 USDC, want ETH...');
  const intent = await client.callTool({
    name: 'post_intent',
    arguments: {
      agent: AGENT_NAME,
      give_token: 'USDC',
      give_amount: 500,
      want_token: 'ETH',
      max_slippage: 0.02,
    },
  });
  logResult(intent);

  // ── Step 8: Check orderbook ─────────────────────────────────────────
  log('📖', 'Checking orderbook...');
  const orderbook = await client.callTool({
    name: 'get_orderbook',
    arguments: {},
  });
  logResult(orderbook);

  // ── Step 9: Check leaderboard ───────────────────────────────────────
  log('🏆', 'Checking leaderboard (free)...');
  const leaderboard = await client.callTool({
    name: 'get_leaderboard',
    arguments: {},
  });
  logResult(leaderboard);

  // ── Step 10: Check governance ───────────────────────────────────────
  log('🏛️', 'Checking governance...');
  try {
    const gov = await client.callTool({
      name: 'get_governance',
      arguments: {},
    });
    logResult(gov);
  } catch (e) {
    console.log(`    (governance endpoint not available: ${e.message})`);
  }

  // ── Done ────────────────────────────────────────────────────────────
  log('🎉', 'Demo complete! Full MCP trading workflow executed.');
  log('📋', 'Summary:');
  console.log(`    Agent: ${AGENT_NAME}`);
  console.log(`    Tools used: 10 of ${tools.length}`);
  console.log(`    Protocol: MCP (stdio transport)`);
  console.log(`    x402: ${process.env.X402_ENABLED === 'true' ? 'enabled (paid tools)' : 'disabled (free mode)'}`);

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n❌ Demo failed: ${err.message}`);
  process.exit(1);
});
