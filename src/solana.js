/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AgentSwaps — Solana On-Chain Settlement Layer
 *
 * Provides Solana integration for the AgentSwaps matching engine:
 * - Connection to Solana devnet (configurable to mainnet)
 * - Jupiter Ultra API for real-time price discovery
 * - On-chain swap proof recording via memo transactions
 * - Agent wallet derivation and management
 *
 * Hackathon build — devnet by default. Not production-grade.
 */

const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const crypto = require('crypto');

// ============================================================================
// Constants
// ============================================================================

const SOLANA_DEVNET = 'https://api.devnet.solana.com';
const SOLANA_MAINNET = 'https://api.mainnet-beta.solana.com';

// Memo program — used to inscribe swap proofs on-chain
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Well-known SPL token mints (mainnet addresses, used for price lookups)
const TOKEN_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMF1zBDy2eNoLhszJCdj729wph3hPKABTHo2v1kDR',
  BTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // wBTC (Wormhole)
  ETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // wETH (Wormhole)
  MON: null, // Custom token — no mainnet mint yet
};

// Jupiter API base (free, no auth needed)
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

// ============================================================================
// Module State
// ============================================================================

let connection = null;
let config = {};
let treasuryKeypair = null;
let agentWallets = new Map(); // agentName -> Keypair

// ============================================================================
// initSolana — Initialize Solana connection
// ============================================================================

/**
 * Initialize the Solana connection and treasury wallet.
 *
 * @param {Object} opts
 * @param {string} [opts.network='devnet'] - 'devnet' or 'mainnet'
 * @param {string} [opts.rpcUrl] - Custom RPC URL (overrides network)
 * @param {string} [opts.treasurySecret] - Base64-encoded treasury keypair secret
 * @returns {Object} Connection info
 */
function initSolana(opts = {}) {
  config = {
    network: opts.network || 'devnet',
    rpcUrl: opts.rpcUrl || (opts.network === 'mainnet' ? SOLANA_MAINNET : SOLANA_DEVNET),
    ...opts,
  };

  connection = new Connection(config.rpcUrl, 'confirmed');

  // Treasury wallet — if a secret is provided, use it; otherwise generate one
  if (opts.treasurySecret) {
    const secretBytes = Buffer.from(opts.treasurySecret, 'base64');
    treasuryKeypair = Keypair.fromSecretKey(secretBytes);
  } else {
    treasuryKeypair = Keypair.generate();
  }

  console.log(`[solana] Connected to ${config.network} (${config.rpcUrl})`);
  console.log(`[solana] Treasury: ${treasuryKeypair.publicKey.toBase58()}`);

  return {
    network: config.network,
    rpcUrl: config.rpcUrl,
    treasury: treasuryKeypair.publicKey.toBase58(),
  };
}

// ============================================================================
// getTokenPrices — Fetch real prices from Jupiter
// ============================================================================

/**
 * Fetch real-time token prices from Jupiter Price API v2.
 *
 * @param {string[]} tokens - Token symbols (e.g. ['SOL', 'USDC', 'ETH'])
 * @returns {Object} Map of symbol -> price in USD
 */
async function getTokenPrices(tokens = ['SOL', 'USDC', 'ETH', 'BTC']) {
  // Resolve symbols to mint addresses
  const mintIds = tokens.map((t) => TOKEN_MINTS[t.toUpperCase()]).filter(Boolean);

  if (mintIds.length === 0) {
    console.warn('[solana] No known mint addresses for requested tokens');
    return {};
  }

  const url = `${JUPITER_PRICE_API}?ids=${mintIds.join(',')}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Jupiter API returned ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();
    const prices = {};

    // Map mint addresses back to symbols
    for (const token of tokens) {
      const mint = TOKEN_MINTS[token.toUpperCase()];
      if (mint && json.data && json.data[mint]) {
        prices[token.toUpperCase()] = parseFloat(json.data[mint].price);
      }
    }

    // Always set USDC to 1.0 (stablecoin)
    if (tokens.map((t) => t.toUpperCase()).includes('USDC')) {
      prices.USDC = 1.0;
    }

    console.log(
      `[solana] Jupiter prices: ${Object.entries(prices)
        .map(([k, v]) => `${k}=$${v}`)
        .join(', ')}`
    );

    return prices;
  } catch (err) {
    console.error(`[solana] Jupiter price fetch failed: ${err.message}`);
    // Return empty — caller should fall back to cached/default prices
    return {};
  }
}

// ============================================================================
// recordSwapOnChain — Post swap proof to Solana as a memo transaction
// ============================================================================

/**
 * Record a swap execution on Solana as a memo transaction.
 * This creates an immutable on-chain proof of the agent-to-agent swap.
 *
 * The memo contains a JSON payload with swap details, hashed for integrity.
 *
 * @param {Object} swap - Swap record from the matching engine
 * @param {string} swap.id - Swap UUID
 * @param {string} swap.agentA - Agent A name
 * @param {string} swap.agentB - Agent B name
 * @param {Object} swap.giveA - { token, amount } Agent A gave
 * @param {Object} swap.giveB - { token, amount } Agent B gave
 * @param {number} swap.volumeUSD - Total volume in USD
 * @param {string} swap.executedAt - ISO timestamp
 * @returns {Object} { signature, explorer, swapHash }
 */
async function recordSwapOnChain(swap) {
  if (!connection || !treasuryKeypair) {
    throw new Error('Solana not initialized. Call initSolana() first.');
  }

  // Build the swap proof payload
  const proof = {
    protocol: 'agentswaps',
    version: '0.1.0',
    swapId: swap.id,
    agentA: swap.agentA,
    agentB: swap.agentB,
    giveA: `${swap.giveA.amount} ${swap.giveA.token}`,
    giveB: `${swap.giveB.amount} ${swap.giveB.token}`,
    volumeUSD: swap.volumeUSD,
    executedAt: swap.executedAt,
  };

  // SHA-256 hash of the proof for integrity verification
  const proofJson = JSON.stringify(proof);
  const swapHash = crypto.createHash('sha256').update(proofJson).digest('hex').slice(0, 16);

  // Memo content (keep under ~500 bytes for memo program limits)
  const memo = JSON.stringify({
    p: 'agentswaps',
    v: '0.1',
    id: swap.id.slice(0, 8),
    a: swap.agentA,
    b: swap.agentB,
    ga: `${swap.giveA.amount}${swap.giveA.token}`,
    gb: `${swap.giveB.amount}${swap.giveB.token}`,
    vol: Math.round(swap.volumeUSD),
    h: swapHash,
    t: Math.floor(new Date(swap.executedAt).getTime() / 1000),
  });

  try {
    // Create memo instruction
    const memoInstruction = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, 'utf-8'),
    });

    const transaction = new Transaction().add(memoInstruction);

    // Send and confirm
    const signature = await sendAndConfirmTransaction(connection, transaction, [treasuryKeypair], {
      commitment: 'confirmed',
      maxRetries: 3,
    });

    const explorer =
      config.network === 'mainnet'
        ? `https://solscan.io/tx/${signature}`
        : `https://solscan.io/tx/${signature}?cluster=devnet`;

    console.log(`[solana] Swap ${swap.id.slice(0, 8)} recorded on-chain: ${signature}`);
    console.log(`[solana] Explorer: ${explorer}`);

    return {
      signature,
      explorer,
      swapHash,
      memo,
      network: config.network,
    };
  } catch (err) {
    console.error(`[solana] Failed to record swap on-chain: ${err.message}`);

    // For hackathon demo: return a soft failure so the swap still works off-chain
    return {
      signature: null,
      explorer: null,
      swapHash,
      memo,
      network: config.network,
      error: err.message,
    };
  }
}

// ============================================================================
// getAgentWallet — Derive or retrieve agent wallet
// ============================================================================

/**
 * Get or create a Solana wallet for an agent.
 *
 * Wallets are deterministically derived from the agent name using HMAC-SHA256
 * with the treasury public key as the HMAC key. This means the same agent name
 * always gets the same wallet (within the same treasury context).
 *
 * @param {string} agentName - The agent's registered name
 * @returns {Object} { publicKey, secretKey (base64), isNew }
 */
function getAgentWallet(agentName) {
  if (!treasuryKeypair) {
    throw new Error('Solana not initialized. Call initSolana() first.');
  }

  // Check cache
  if (agentWallets.has(agentName)) {
    const kp = agentWallets.get(agentName);
    return {
      publicKey: kp.publicKey.toBase58(),
      secretKey: Buffer.from(kp.secretKey).toString('base64'),
      isNew: false,
    };
  }

  // Derive deterministic seed from agent name
  // HMAC(treasury_pubkey, agentName) -> 32 bytes -> Keypair seed
  const hmac = crypto.createHmac('sha256', treasuryKeypair.publicKey.toBytes());
  hmac.update(agentName);
  const seed = hmac.digest();

  const keypair = Keypair.fromSeed(seed);
  agentWallets.set(agentName, keypair);

  console.log(`[solana] Wallet for ${agentName}: ${keypair.publicKey.toBase58()}`);

  return {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: Buffer.from(keypair.secretKey).toString('base64'),
    isNew: true,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the SOL balance of a wallet.
 *
 * @param {string} publicKeyStr - Base58 public key
 * @returns {number} Balance in SOL
 */
async function getSolBalance(publicKeyStr) {
  if (!connection) throw new Error('Solana not initialized');
  const pubkey = new PublicKey(publicKeyStr);
  const lamports = await connection.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Request an airdrop on devnet (for testing).
 *
 * @param {string} publicKeyStr - Base58 public key
 * @param {number} [solAmount=1] - Amount of SOL to airdrop
 * @returns {string} Transaction signature
 */
async function requestAirdrop(publicKeyStr, solAmount = 1) {
  if (!connection) throw new Error('Solana not initialized');
  if (config.network !== 'devnet') {
    throw new Error('Airdrops only available on devnet');
  }
  const pubkey = new PublicKey(publicKeyStr);
  const signature = await connection.requestAirdrop(pubkey, solAmount * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(signature, 'confirmed');
  console.log(`[solana] Airdropped ${solAmount} SOL to ${publicKeyStr.slice(0, 8)}...`);
  return signature;
}

/**
 * Get the treasury wallet info.
 *
 * @returns {Object} { publicKey, network }
 */
function getTreasury() {
  if (!treasuryKeypair) throw new Error('Solana not initialized');
  return {
    publicKey: treasuryKeypair.publicKey.toBase58(),
    network: config.network,
  };
}

/**
 * Get the current Solana connection status.
 *
 * @returns {Object} Connection details or null if not initialized
 */
async function getConnectionStatus() {
  if (!connection) return null;

  try {
    const version = await connection.getVersion();
    const slot = await connection.getSlot();
    return {
      connected: true,
      network: config.network,
      rpcUrl: config.rpcUrl,
      solanaVersion: version['solana-core'],
      currentSlot: slot,
      treasury: treasuryKeypair ? treasuryKeypair.publicKey.toBase58() : null,
      agentWallets: agentWallets.size,
    };
  } catch (err) {
    return {
      connected: false,
      network: config.network,
      rpcUrl: config.rpcUrl,
      error: err.message,
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Core functions
  initSolana,
  getTokenPrices,
  recordSwapOnChain,
  getAgentWallet,

  // Utilities
  getSolBalance,
  requestAirdrop,
  getTreasury,
  getConnectionStatus,

  // Constants (useful for callers)
  TOKEN_MINTS,
  MEMO_PROGRAM_ID,
};
