/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps — x402 Payment Middleware
 *
 * Implements the x402 Payment Required protocol (HTTP 402) for AI agent
 * micropayments on Base via USDC. This enables AI agents to pay per API
 * call when executing trades on the AgentSwaps DEX.
 *
 * Protocol: x402 (https://x402.org)
 * Network:  Base (EIP-155:8453) / Base Sepolia (EIP-155:84532)
 * Token:    USDC
 *
 * Flow:
 *   1. Agent calls a paid endpoint without payment header
 *   2. Server responds 402 with PAYMENT-REQUIRED header (base64 JSON)
 *   3. Agent signs a USDC payment and retries with PAYMENT-SIGNATURE header
 *   4. Server verifies via facilitator, processes request, returns PAYMENT-RESPONSE
 *
 * References:
 *   - https://docs.cdp.coinbase.com/x402/welcome
 *   - https://github.com/coinbase/x402
 *   - https://www.x402.org/x402-whitepaper.pdf
 */

// ============================================================================
// Configuration
// ============================================================================

// Network identifiers (CAIP-2 format)
const NETWORKS = {
  BASE_MAINNET: 'eip155:8453',
  BASE_SEPOLIA: 'eip155:84532',
};

// USDC contract addresses
const USDC_ADDRESSES = {
  [NETWORKS.BASE_MAINNET]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [NETWORKS.BASE_SEPOLIA]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

// Facilitator endpoints
const FACILITATORS = {
  // Testnet: free, hosted by x402.org
  testnet: 'https://x402.org/facilitator',
  // Mainnet: Coinbase CDP (requires CDP_API_KEY_ID + CDP_API_KEY_SECRET)
  mainnet: 'https://api.cdp.coinbase.com/platform/v2/x402',
};

// Default configuration
const DEFAULT_CONFIG = {
  // Wallet address that receives payments (set via X402_PAY_TO env var)
  payTo: process.env.X402_PAY_TO || null,

  // Network: 'testnet' or 'mainnet'
  environment: process.env.X402_ENV || 'testnet',

  // CAIP-2 network ID (auto-set from environment)
  network: process.env.X402_NETWORK || null,

  // Facilitator URL (auto-set from environment)
  facilitatorUrl: process.env.X402_FACILITATOR_URL || null,

  // Whether x402 is enabled at all (can run without it)
  enabled: process.env.X402_ENABLED === 'true',

  // CDP credentials for mainnet
  cdpApiKeyId: process.env.CDP_API_KEY_ID || null,
  cdpApiKeySecret: process.env.CDP_API_KEY_SECRET || null,
};

// ============================================================================
// Pricing — Per-endpoint cost in USD
// ============================================================================

/**
 * Route pricing table. Keys are "METHOD /path" strings.
 * Price is in USD string format (e.g., "$0.001").
 *
 * Free endpoints (null price) are not gated.
 * Paid endpoints require x402 payment.
 */
const ROUTE_PRICING = {
  // --- Free endpoints (discovery, read-only state) ---
  'GET /health': null,
  'GET /api/world': null,
  'GET /api/events': null,
  'GET /api/leaderboard': null,
  'GET /api/prices': null,
  'GET /api/solana': null,

  // --- Paid endpoints (actions that affect world state) ---
  'POST /api/agents': '$0.01', // Register agent: 1 cent
  'POST /api/agents/:name/deposit': '$0.001', // Deposit: 0.1 cent
  'POST /api/intents': '$0.01', // Post trade intent: 1 cent
  'GET /api/intents': '$0.001', // Read orderbook: 0.1 cent
  'GET /api/swaps': '$0.001', // Read swap history: 0.1 cent
  'GET /api/agents/:name': '$0.001', // Read agent details: 0.1 cent
  'GET /api/agents/:name/wallet': '$0.001', // Read agent wallet: 0.1 cent

  // --- Governance (slightly higher since it affects protocol) ---
  'POST /api/governance/proposals': '$0.05', // Create proposal: 5 cents
  'POST /api/governance/proposals/:id/vote': '$0.01', // Vote: 1 cent
  'GET /api/governance/proposals': '$0.001', // Read proposals: 0.1 cent
  'GET /api/governance/token/supply': '$0.001', // Read supply: 0.1 cent
};

// ============================================================================
// x402 PaymentRequired Response Builder
// ============================================================================

/**
 * Build the PaymentRequired object per x402 spec.
 * This is base64-encoded and sent in the PAYMENT-REQUIRED response header.
 *
 * @param {string} price - USD price string like "$0.01"
 * @param {object} config - Server configuration
 * @param {object} routeMeta - Optional route metadata
 * @returns {object} PaymentRequired object
 */
function buildPaymentRequired(price, config, routeMeta = {}) {
  // Parse dollar amount to USDC atomic units (6 decimals)
  const usdAmount = parseFloat(price.replace('$', ''));
  const usdcAtomicAmount = Math.round(usdAmount * 1_000_000).toString();

  return {
    accepts: [
      {
        scheme: 'exact',
        network: config.network,
        maxAmountRequired: usdcAtomicAmount,
        resource: routeMeta.path || '',
        description: routeMeta.description || 'AgentSwaps API access',
        mimeType: 'application/json',
        payTo: config.payTo,
        asset: USDC_ADDRESSES[config.network] || USDC_ADDRESSES[NETWORKS.BASE_SEPOLIA],
        maxTimeoutSeconds: 30,
        extra: {
          // AgentSwaps-specific metadata
          service: 'agentswaps',
          version: '0.1.0',
          name: routeMeta.name || 'api-call',
        },
      },
    ],
    // Include human-readable info
    x402Version: 2,
    error: `Payment required: ${price} USDC to access this endpoint`,
  };
}

/**
 * Encode PaymentRequired as base64 for the PAYMENT-REQUIRED header.
 */
function encodePaymentRequired(paymentRequired) {
  return Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
}

/**
 * Decode a PAYMENT-SIGNATURE header from base64 to JSON.
 */
function decodePaymentSignature(headerValue) {
  try {
    const json = Buffer.from(headerValue, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ============================================================================
// Facilitator Client — Verify and Settle Payments
// ============================================================================

/**
 * Verify a payment signature with the facilitator.
 *
 * @param {object} paymentPayload - Decoded PAYMENT-SIGNATURE payload
 * @param {object} paymentRequired - The original PaymentRequired we sent
 * @param {object} config - Server configuration
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function verifyPayment(paymentPayload, paymentRequired, config) {
  const facilitatorUrl = config.facilitatorUrl;

  try {
    const headers = {
      'Content-Type': 'application/json',
    };

    // Add CDP auth headers for mainnet
    if (config.environment === 'mainnet' && config.cdpApiKeyId) {
      headers['X-CDP-API-KEY-ID'] = config.cdpApiKeyId;
      headers['X-CDP-API-KEY-SECRET'] = config.cdpApiKeySecret;
    }

    const response = await fetch(`${facilitatorUrl}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements: paymentRequired.accepts[0],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { valid: false, error: `Facilitator verify failed: ${response.status} ${body}` };
    }

    const result = await response.json();
    return { valid: result.valid === true || result.isValid === true, data: result };
  } catch (err) {
    return { valid: false, error: `Facilitator unreachable: ${err.message}` };
  }
}

/**
 * Settle a payment through the facilitator (triggers on-chain transfer).
 *
 * @param {object} paymentPayload - Decoded PAYMENT-SIGNATURE payload
 * @param {object} paymentRequired - The original PaymentRequired we sent
 * @param {object} config - Server configuration
 * @returns {Promise<{success: boolean, receipt?: object, error?: string}>}
 */
async function settlePayment(paymentPayload, paymentRequired, config) {
  const facilitatorUrl = config.facilitatorUrl;

  try {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (config.environment === 'mainnet' && config.cdpApiKeyId) {
      headers['X-CDP-API-KEY-ID'] = config.cdpApiKeyId;
      headers['X-CDP-API-KEY-SECRET'] = config.cdpApiKeySecret;
    }

    const response = await fetch(`${facilitatorUrl}/settle`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements: paymentRequired.accepts[0],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { success: false, error: `Facilitator settle failed: ${response.status} ${body}` };
    }

    const result = await response.json();
    return { success: true, receipt: result };
  } catch (err) {
    return { success: false, error: `Facilitator unreachable: ${err.message}` };
  }
}

// ============================================================================
// Payment Ledger — Track payments received
// ============================================================================

const paymentLedger = {
  total: 0,
  count: 0,
  payments: [],
};

function recordPayment(payment) {
  paymentLedger.total += payment.amount;
  paymentLedger.count++;
  paymentLedger.payments.push({
    ...payment,
    recordedAt: new Date().toISOString(),
  });

  // Keep last 1000 payment records
  if (paymentLedger.payments.length > 1000) {
    paymentLedger.payments = paymentLedger.payments.slice(-1000);
  }

  console.log(
    `[x402] Payment received: $${payment.amount.toFixed(6)} USDC from ${payment.payer || 'unknown'} for ${payment.route}`
  );
}

// ============================================================================
// Express Middleware
// ============================================================================

/**
 * Resolve the configured environment into a full config object.
 */
function resolveConfig(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  // Auto-set network from environment
  if (!config.network) {
    config.network = config.environment === 'mainnet' ? NETWORKS.BASE_MAINNET : NETWORKS.BASE_SEPOLIA;
  }

  // Auto-set facilitator URL from environment
  if (!config.facilitatorUrl) {
    config.facilitatorUrl = config.environment === 'mainnet' ? FACILITATORS.mainnet : FACILITATORS.testnet;
  }

  return config;
}

/**
 * Match a request's "METHOD /path" against route pricing rules.
 * Supports Express-style :param patterns via simple conversion.
 *
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @returns {{ price: string|null, routeKey: string }|null}
 */
function matchRoute(method, path) {
  const requestKey = `${method} ${path}`;

  // Exact match first
  if (requestKey in ROUTE_PRICING) {
    return { price: ROUTE_PRICING[requestKey], routeKey: requestKey };
  }

  // Pattern match (convert :param to regex segments)
  for (const [routeKey, price] of Object.entries(ROUTE_PRICING)) {
    const [routeMethod, routePath] = routeKey.split(' ');
    if (routeMethod !== method) continue;

    // Convert Express-style params to regex
    const pattern = routePath
      .replace(/:[^/]+/g, '[^/]+') // :name -> [^/]+
      .replace(/\//g, '\\/'); // escape slashes
    const regex = new RegExp(`^${pattern}$`);

    if (regex.test(path)) {
      return { price, routeKey };
    }
  }

  // No matching rule — default to free (unprotected)
  return null;
}

/**
 * x402 Payment Middleware for Express.
 *
 * Intercepts requests to paid endpoints. If the request lacks a valid
 * PAYMENT-SIGNATURE header, responds with 402 Payment Required and the
 * PAYMENT-REQUIRED header containing payment instructions.
 *
 * If a valid payment is attached, verifies it via the facilitator,
 * settles on-chain, and allows the request through.
 *
 * @param {object} [configOverrides] - Override default configuration
 * @returns {Function} Express middleware
 */
function paymentMiddleware(configOverrides = {}) {
  const config = resolveConfig(configOverrides);

  // Validate configuration
  if (config.enabled && !config.payTo) {
    console.error('[x402] WARNING: x402 is enabled but X402_PAY_TO wallet address is not set.');
    console.error('[x402] Set X402_PAY_TO=0xYourAddress to receive payments.');
    console.error('[x402] x402 payment gating is DISABLED until configured.');
    config.enabled = false;
  }

  if (config.enabled) {
    console.log(`[x402] Payment middleware ACTIVE`);
    console.log(`[x402]   Environment: ${config.environment}`);
    console.log(`[x402]   Network: ${config.network}`);
    console.log(`[x402]   Pay to: ${config.payTo}`);
    console.log(`[x402]   Facilitator: ${config.facilitatorUrl}`);
    console.log(`[x402]   Paid routes: ${Object.entries(ROUTE_PRICING).filter(([, p]) => p !== null).length}`);
  } else {
    console.log('[x402] Payment middleware loaded but INACTIVE (set X402_ENABLED=true to activate)');
  }

  return async function x402Middleware(req, res, next) {
    // If x402 is disabled, pass everything through
    if (!config.enabled) {
      return next();
    }

    // Match the request against pricing rules
    const match = matchRoute(req.method, req.path);

    // No matching rule or free endpoint — pass through
    if (!match || match.price === null) {
      return next();
    }

    const { price, routeKey } = match;

    // Build the payment requirement for this route
    const paymentRequired = buildPaymentRequired(price, config, {
      path: req.path,
      name: routeKey,
      description: `AgentSwaps: ${routeKey}`,
    });

    // Check for payment signature header (V2 uses PAYMENT-SIGNATURE, V1 used X-PAYMENT)
    const paymentHeader =
      req.headers['payment-signature'] || req.headers['x-payment'] || req.headers['x-payment-signature'];

    if (!paymentHeader) {
      // No payment attached — respond with 402 Payment Required
      const encoded = encodePaymentRequired(paymentRequired);

      res.status(402);
      res.set('PAYMENT-REQUIRED', encoded);
      // Also set legacy header for V1 clients
      res.set('X-PAYMENT-REQUIRED', encoded);
      res.set('Content-Type', 'application/json');

      return res.json({
        error: 'Payment Required',
        message: `This endpoint requires ${price} USDC payment via x402 protocol.`,
        x402: {
          version: 2,
          price,
          network: config.network,
          payTo: config.payTo,
          facilitator: config.facilitatorUrl,
          asset: 'USDC',
        },
        docs: 'https://docs.cdp.coinbase.com/x402/welcome',
        howTo: [
          '1. Read the PAYMENT-REQUIRED header (base64-encoded JSON)',
          '2. Sign a USDC payment for the specified amount',
          '3. Retry this request with the PAYMENT-SIGNATURE header (base64-encoded payload)',
          '4. The facilitator will verify and settle the payment on Base',
        ],
      });
    }

    // Payment header present — verify it
    const paymentPayload = decodePaymentSignature(paymentHeader);

    if (!paymentPayload) {
      return res.status(400).json({
        error: 'Invalid Payment',
        message: 'Could not decode PAYMENT-SIGNATURE header. Must be base64-encoded JSON.',
      });
    }

    // Verify payment with facilitator
    const verification = await verifyPayment(paymentPayload, paymentRequired, config);

    if (!verification.valid) {
      // Payment invalid — return 402 again with error details
      const encoded = encodePaymentRequired(paymentRequired);
      res.status(402);
      res.set('PAYMENT-REQUIRED', encoded);

      return res.json({
        error: 'Payment Invalid',
        message: verification.error || 'Payment verification failed.',
        x402: {
          version: 2,
          price,
          network: config.network,
          retryable: true,
        },
      });
    }

    // Payment verified — settle on-chain
    const settlement = await settlePayment(paymentPayload, paymentRequired, config);

    if (!settlement.success) {
      return res.status(502).json({
        error: 'Settlement Failed',
        message: settlement.error || 'On-chain settlement failed. Payment was not taken.',
        retryable: true,
      });
    }

    // Record the payment
    const usdAmount = parseFloat(price.replace('$', ''));
    recordPayment({
      route: routeKey,
      amount: usdAmount,
      payer: paymentPayload.payer || paymentPayload.from || 'unknown',
      txHash: settlement.receipt?.txHash || settlement.receipt?.transactionHash || null,
      network: config.network,
    });

    // Attach payment receipt to request for downstream handlers
    req.x402 = {
      paid: true,
      amount: usdAmount,
      payer: paymentPayload.payer || paymentPayload.from || 'unknown',
      receipt: settlement.receipt,
      route: routeKey,
    };

    // Set PAYMENT-RESPONSE header on the response
    const paymentResponse = Buffer.from(
      JSON.stringify({
        success: true,
        network: config.network,
        txHash: settlement.receipt?.txHash || settlement.receipt?.transactionHash || null,
        settledAt: new Date().toISOString(),
      })
    ).toString('base64');

    res.set('PAYMENT-RESPONSE', paymentResponse);

    // Proceed to the actual route handler
    next();
  };
}

// ============================================================================
// Admin/Status Endpoints
// ============================================================================

/**
 * Express router for x402 admin endpoints.
 * Mount at /api/x402 for payment status visibility.
 */
const express = require('express');
const router = express.Router();

// Payment status and stats
router.get('/status', (req, res) => {
  const config = resolveConfig();
  res.json({
    enabled: config.enabled,
    environment: config.environment,
    network: config.network,
    payTo: config.payTo,
    facilitator: config.facilitatorUrl,
    ledger: {
      totalReceived: paymentLedger.total,
      paymentCount: paymentLedger.count,
    },
  });
});

// Payment ledger (recent payments)
router.get('/payments', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    total: paymentLedger.total,
    count: paymentLedger.count,
    payments: paymentLedger.payments.slice(-limit).reverse(),
  });
});

// Route pricing table (what does each endpoint cost?)
router.get('/pricing', (req, res) => {
  const config = resolveConfig();
  const routes = {};

  for (const [route, price] of Object.entries(ROUTE_PRICING)) {
    routes[route] = {
      price: price || 'free',
      paid: price !== null,
    };
  }

  res.json({
    network: config.network,
    asset: 'USDC',
    facilitator: config.facilitatorUrl,
    routes,
  });
});

// x402 service discovery (/.well-known style)
router.get('/discover', (req, res) => {
  const config = resolveConfig();

  const paidRoutes = {};
  for (const [route, price] of Object.entries(ROUTE_PRICING)) {
    if (price === null) continue;
    paidRoutes[route] = buildPaymentRequired(price, config, {
      path: route.split(' ')[1],
      name: route,
      description: `AgentSwaps: ${route}`,
    });
  }

  res.json({
    service: 'AgentSwaps DEX',
    version: '0.1.0',
    protocol: 'x402',
    x402Version: 2,
    description: 'The first DEX where both sides are AI agents. Pay-per-call via x402 + USDC on Base.',
    network: config.network,
    facilitator: config.facilitatorUrl,
    routes: paidRoutes,
  });
});

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Middleware
  paymentMiddleware,

  // Admin router
  router,

  // Config helpers
  resolveConfig,
  ROUTE_PRICING,
  NETWORKS,
  FACILITATORS,
  USDC_ADDRESSES,

  // Internals (for testing / advanced use)
  buildPaymentRequired,
  encodePaymentRequired,
  decodePaymentSignature,
  verifyPayment,
  settlePayment,
  matchRoute,
  paymentLedger,
};
