#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps x402-MCP Server
 *
 * An MCP server that exposes AgentSwaps DEX trading tools to AI agents.
 * Paid tools use x402 micropayments (USDC on Base) for access.
 *
 * Any MCP-capable agent (Claude, GPT, etc.) can:
 *   1. Discover available trading tools
 *   2. Pay per tool call via x402 micropayments
 *   3. Register, deposit, trade — all autonomously
 *
 * Protocol Stack:
 *   MCP (tool discovery) + x402 (micropayments) + AgentSwaps (DEX engine)
 *
 * Usage:
 *   node src/mcp-server.js                          # stdio transport (free mode)
 *   node src/mcp-server.js --sse                    # SSE transport (remote access)
 *   X402_ENABLED=true X402_PAY_TO=0x... node src/mcp-server.js  # with payments
 *
 * Environment Variables:
 *   AGENTSWAPS_API   — Backend API URL (default: http://localhost:8800)
 *   X402_ENABLED     — Enable x402 payments ("true" to enable)
 *   X402_PAY_TO      — Recipient wallet address for payments (required when enabled)
 *   X402_NETWORK     — CAIP-2 network ID (default: eip155:84532 for Base Sepolia)
 *   MCP_PORT         — SSE transport port (default: 4022, only used with --sse)
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = process.env.AGENTSWAPS_API || 'http://localhost:8800';
const PAY_TO = process.env.X402_PAY_TO || null;
const X402_ENABLED = process.env.X402_ENABLED === 'true' && PAY_TO;
const NETWORK = process.env.X402_NETWORK || 'eip155:84532'; // Base Sepolia default

// ---------------------------------------------------------------------------
// HTTP helper — call the AgentSwaps REST API
// ---------------------------------------------------------------------------

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// x402 Payment Setup
// ---------------------------------------------------------------------------

/**
 * Initialize x402 payment infrastructure.
 * Returns a `paid(price, handler)` function that wraps tool handlers with payment.
 * When x402 is disabled, returns a passthrough that just calls the handler directly.
 */
async function initPayments() {
  if (!X402_ENABLED) {
    // No-op wrapper — tools work without payment
    return function paid(_price, handler) {
      return handler;
    };
  }

  const { HTTPFacilitatorClient, x402ResourceServer } = require('@x402/core/server');
  const { ExactEvmScheme } = require('@x402/evm/exact/server');
  const { createPaymentWrapper } = require('@x402/mcp');

  // Connect to the x402 facilitator (handles verify + settle)
  const facilitator = new HTTPFacilitatorClient();
  const resourceServer = new x402ResourceServer(facilitator);

  // Register EVM exact payment scheme for our network
  resourceServer.register(NETWORK, new ExactEvmScheme());

  // Initialize — fetches supported kinds from facilitator
  await resourceServer.initialize();
  console.error(`[agentswaps-mcp] x402 resource server initialized`);

  // Pre-build payment requirements for each price tier
  const priceCache = new Map();

  async function getAccepts(price) {
    const key = String(price);
    if (priceCache.has(key)) return priceCache.get(key);

    const accepts = await resourceServer.buildPaymentRequirements({
      scheme: 'exact',
      network: NETWORK,
      payTo: PAY_TO,
      price,
      maxTimeoutSeconds: 300,
    });
    priceCache.set(key, accepts);
    return accepts;
  }

  /**
   * Wrap a tool handler with x402 payment verification.
   * @param {string} price - Price in USD (e.g., "$0.01")
   * @param {Function} handler - The original tool handler
   * @returns {Function} Wrapped handler that verifies payment before executing
   */
  return async function paid(price, handler) {
    const accepts = await getAccepts(price);
    const wrapper = createPaymentWrapper(resourceServer, {
      accepts,
      hooks: {
        onAfterSettlement: async ({ settlement, toolName }) => {
          console.error(
            `[agentswaps-mcp] Payment settled: ${toolName} — tx: ${settlement.transaction}`
          );
        },
      },
    });
    return wrapper(handler);
  };
}

// ---------------------------------------------------------------------------
// MCP Server Setup + Tool Registration
// ---------------------------------------------------------------------------

async function main() {
  const server = new McpServer({
    name: 'agentswaps',
    version: '0.3.0',
    description:
      'AgentSwaps DEX — The first agent-to-agent decentralized exchange. ' +
      'Register, deposit tokens, post trade intents, and execute atomic swaps. ' +
      'All operations are autonomous — no human intermediary required.' +
      (X402_ENABLED ? ' Paid tools require x402 USDC micropayments.' : ''),
  });

  // Initialize payment wrapper (no-op if x402 disabled)
  const paid = await initPayments();

  // -------------------------------------------------------------------------
  // Free Tools (no x402 payment required)
  // -------------------------------------------------------------------------

  server.tool(
    'get_world',
    'Get the current state of the AgentSwaps trading floor: registered agents, active intents, completed swaps, token prices, and recent events.',
    {},
    async () => {
      const world = await apiGet('/api/world');
      return { content: [{ type: 'text', text: JSON.stringify(world, null, 2) }] };
    }
  );

  server.tool(
    'get_prices',
    'Get live token prices for all supported tokens (USDC, ETH, SOL, MON, BTC).',
    {},
    async () => {
      const prices = await apiGet('/api/prices');
      return { content: [{ type: 'text', text: JSON.stringify(prices, null, 2) }] };
    }
  );

  server.tool(
    'get_events',
    'Get recent events from the trading floor (agent entries, deposits, intents, swaps).',
    {
      since: z.string().optional().describe('ISO timestamp to filter events after'),
    },
    async ({ since }) => {
      const path = since ? `/api/events?since=${encodeURIComponent(since)}` : '/api/events';
      const events = await apiGet(path);
      return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
    }
  );

  server.tool(
    'get_leaderboard',
    'Get the top traders by volume on AgentSwaps.',
    {},
    async () => {
      const leaderboard = await apiGet('/api/leaderboard');
      return { content: [{ type: 'text', text: JSON.stringify(leaderboard, null, 2) }] };
    }
  );

  // -------------------------------------------------------------------------
  // Paid Tools (require x402 micropayment when enabled)
  // -------------------------------------------------------------------------

  server.tool(
    'register_agent',
    'Register a new agent on the AgentSwaps trading floor. Cost: $0.01 USDC. ' +
      'Returns agent details including starting balance and reputation score.',
    {
      name: z.string().describe('Unique agent name (e.g., "claude-trader-1")'),
      wallet_address: z
        .string()
        .optional()
        .describe('Base wallet address (0x...) for on-chain rewards'),
      description: z.string().optional().describe('Short description of the agent'),
    },
    await paid('$0.01', async ({ name, wallet_address, description }) => {
      const result = await apiPost('/api/agents', {
        name,
        walletAddress: wallet_address,
        metadata: description ? { description } : {},
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    })
  );

  server.tool(
    'get_agent',
    'Get details about a registered agent including balance, reputation, and swap history. Cost: $0.001 USDC.',
    {
      name: z.string().describe('Agent name to look up'),
    },
    await paid('$0.001', async ({ name }) => {
      const agent = await apiGet(`/api/agents/${encodeURIComponent(name)}`);
      return { content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }] };
    })
  );

  server.tool(
    'deposit',
    'Deposit tokens into your agent account for trading. Cost: $0.001 USDC. ' +
      'Supported tokens: USDC, ETH, SOL, MON, BTC.',
    {
      agent: z.string().describe('Your agent name'),
      token: z.enum(['USDC', 'ETH', 'SOL', 'MON', 'BTC']).describe('Token to deposit'),
      amount: z.number().positive().describe('Amount to deposit'),
    },
    await paid('$0.001', async ({ agent, token, amount }) => {
      const result = await apiPost(`/api/agents/${encodeURIComponent(agent)}/deposit`, {
        token,
        amount,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    })
  );

  server.tool(
    'post_intent',
    'Post a trade intent (order) to the AgentSwaps matching engine. Cost: $0.01 USDC. ' +
      'If a matching counter-party exists, the swap executes atomically. ' +
      'Both agents earn $SWAP governance tokens as rewards.',
    {
      agent: z.string().describe('Your agent name'),
      give_token: z
        .enum(['USDC', 'ETH', 'SOL', 'MON', 'BTC'])
        .describe('Token you want to sell'),
      give_amount: z.number().positive().describe('Amount to sell'),
      want_token: z
        .enum(['USDC', 'ETH', 'SOL', 'MON', 'BTC'])
        .describe('Token you want to buy'),
      want_min_amount: z
        .number()
        .optional()
        .describe('Minimum amount to receive (0 = market)'),
      max_slippage: z.number().optional().describe('Max slippage tolerance (0.01 = 1%)'),
    },
    await paid(
      '$0.01',
      async ({ agent, give_token, give_amount, want_token, want_min_amount, max_slippage }) => {
        const result = await apiPost('/api/intents', {
          agent,
          give: { token: give_token, amount: give_amount },
          want: {
            token: want_token,
            minAmount: want_min_amount || 0,
            maxSlippage: max_slippage || 0.01,
          },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    )
  );

  server.tool(
    'get_orderbook',
    'View active trade intents (orderbook). Cost: $0.001 USDC. Optionally filter by token.',
    {
      token: z
        .enum(['USDC', 'ETH', 'SOL', 'MON', 'BTC'])
        .optional()
        .describe('Filter by token'),
    },
    await paid('$0.001', async ({ token }) => {
      const path = token ? `/api/intents?token=${token}` : '/api/intents';
      const intents = await apiGet(path);
      return { content: [{ type: 'text', text: JSON.stringify(intents, null, 2) }] };
    })
  );

  server.tool(
    'get_swap_history',
    'View completed swap history. Cost: $0.001 USDC.',
    {
      limit: z.number().optional().describe('Number of recent swaps to return (default: 50)'),
    },
    await paid('$0.001', async ({ limit }) => {
      const swaps = await apiGet(`/api/swaps?limit=${limit || 50}`);
      return { content: [{ type: 'text', text: JSON.stringify(swaps, null, 2) }] };
    })
  );

  server.tool(
    'get_governance',
    'View $SWAP governance proposals and token supply. Cost: $0.001 USDC.',
    {},
    await paid('$0.001', async () => {
      const [proposals, tokenomics] = await Promise.all([
        apiGet('/api/governance/proposals'),
        apiGet('/api/governance/tokenomics'),
      ]);
      return {
        content: [{ type: 'text', text: JSON.stringify({ proposals, tokenomics }, null, 2) }],
      };
    })
  );

  server.tool(
    'create_proposal',
    'Create a $SWAP governance proposal. Cost: $0.05 USDC. Requires minimum SWAP token balance.',
    {
      title: z.string().describe('Proposal title'),
      description: z.string().describe('Detailed proposal description'),
      proposer: z.string().describe('Your agent name'),
    },
    await paid('$0.05', async ({ title, description, proposer }) => {
      const result = await apiPost('/api/governance/proposals', {
        title,
        description,
        proposer,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    })
  );

  server.tool(
    'vote_proposal',
    'Vote on a $SWAP governance proposal. Cost: $0.01 USDC.',
    {
      proposal_id: z.string().describe('Proposal ID to vote on'),
      voter: z.string().describe('Your agent name'),
      support: z.boolean().describe('true = for, false = against'),
    },
    await paid('$0.01', async ({ proposal_id, voter, support }) => {
      const result = await apiPost(`/api/governance/proposals/${proposal_id}/vote`, {
        voter,
        support,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    })
  );

  // -------------------------------------------------------------------------
  // Resources — expose key data as MCP resources
  // -------------------------------------------------------------------------

  server.resource(
    'pricing',
    'agentswaps://pricing',
    { mimeType: 'application/json', description: 'x402 endpoint pricing table' },
    async () => {
      const pricing = await apiGet('/api/x402/pricing');
      return {
        contents: [
          {
            uri: 'agentswaps://pricing',
            mimeType: 'application/json',
            text: JSON.stringify(pricing, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'contracts',
    'agentswaps://contracts',
    { mimeType: 'application/json', description: 'Smart contract addresses on Base' },
    async () => {
      const contracts = await apiGet('/api/base/contracts');
      return {
        contents: [
          {
            uri: 'agentswaps://contracts',
            mimeType: 'application/json',
            text: JSON.stringify(contracts, null, 2),
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // Start — select transport mode
  // -------------------------------------------------------------------------

  const paidCount = X402_ENABLED ? 9 : 0;
  const freeCount = X402_ENABLED ? 4 : 13;
  const useSSE = process.argv.includes('--sse');
  const ssePort = parseInt(process.env.MCP_PORT || '4022', 10);

  console.error(`[agentswaps-mcp] Starting MCP server v0.3.0...`);
  console.error(`[agentswaps-mcp] API: ${API_BASE}`);
  console.error(
    `[agentswaps-mcp] x402: ${X402_ENABLED ? `enabled (${NETWORK}, pay to ${PAY_TO})` : 'disabled (all tools free)'}`
  );
  console.error(`[agentswaps-mcp] Tools: 13 (${freeCount} free, ${paidCount} paid)`);

  if (useSSE) {
    // SSE transport — remote access over HTTP
    const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
    const express = require('express');

    const app = express();
    let sseTransport = null;

    app.get('/sse', async (req, res) => {
      sseTransport = new SSEServerTransport('/messages', res);
      await server.connect(sseTransport);
      console.error(`[agentswaps-mcp] SSE client connected`);
    });

    app.post('/messages', async (req, res) => {
      if (!sseTransport) {
        res.status(503).json({ error: 'No active SSE connection' });
        return;
      }
      await sseTransport.handlePostMessage(req, res);
    });

    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        server: 'agentswaps-mcp',
        version: '0.3.0',
        tools: 13,
        x402: !!X402_ENABLED,
      });
    });

    app.listen(ssePort, () => {
      console.error(`[agentswaps-mcp] SSE transport listening on http://localhost:${ssePort}/sse`);
      console.error(`[agentswaps-mcp] Health check: http://localhost:${ssePort}/health`);
    });
  } else {
    // Stdio transport — local process (default)
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[agentswaps-mcp] Connected via stdio. Ready for tool calls.`);
  }
}

main().catch((err) => {
  console.error(`[agentswaps-mcp] Fatal: ${err.message}`);
  process.exit(1);
});
