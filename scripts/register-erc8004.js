/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Register AgentSwaps in the ERC-8004 Identity Registry on Base mainnet.
 *
 * Usage:  node scripts/register-erc8004.js
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('PRIVATE_KEY env var required. Set it or use: PRIVATE_KEY=0x... node scripts/register-erc8004.js');
  process.exit(1);
}
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

// ── Build the agent metadata (ERC-8004 registration-v1) ───────────────
const agentMetadata = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'AgentSwaps',
  description:
    'Cross-chain DEX for AI agents on Base. 100% fair launch — zero pre-mine, every $SWAP earned through usage. ERC-7683 intents with trustless settlement.',
  version: 2,
  fairLaunch: true,
  services: [
    {
      type: 'a2a',
      endpoint: 'https://agentswaps.xyz/.well-known/agent.json',
      description: 'Agent-to-Agent communication endpoint (Google A2A protocol)',
    },
    {
      type: 'x402',
      endpoint: 'https://agentswaps.xyz/api/swap',
      description: 'x402 payment-enabled swap API',
    },
  ],
  contracts: {
    token: '0xA70DA9E19d102163983E3061c5Ade715f0dD36d3',
    dao: '0x27CfE2255dae29624D8DA82E6D389dcE5af0206B',
    settler: '0x0800Bd274441674f84526475a5daB5E7571e0Aa4',
  },
  chain: 'base',
  chainId: 8453,
  active: true,
};

// Encode as data URI (fully on-chain, no IPFS)
const jsonStr = JSON.stringify(agentMetadata);
const base64 = Buffer.from(jsonStr).toString('base64');
const agentURI = `data:application/json;base64,${base64}`;

// ── ABI fragment for IdentityRegistry.register ────────────────────────
const REGISTRY_ABI = [
  'function register(string agentURI) external returns (uint256 agentId)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('=== ERC-8004 Identity Registration: AgentSwaps ===\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('Deployer:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');

  const registry = new ethers.Contract(IDENTITY_REGISTRY, REGISTRY_ABI, wallet);

  console.log('\nAgent URI length:', agentURI.length, 'bytes');
  console.log('Metadata preview:', JSON.stringify(agentMetadata, null, 2).slice(0, 200), '...\n');

  // Estimate gas first
  console.log('Estimating gas...');
  const gasEstimate = await registry.register.estimateGas(agentURI);
  console.log('Gas estimate:', gasEstimate.toString());

  // Get current gas price
  const feeData = await provider.getFeeData();
  console.log('Max fee per gas:', ethers.formatUnits(feeData.maxFeePerGas || 0n, 'gwei'), 'gwei');

  // Send the transaction
  console.log('\nSending register() transaction...');
  const tx = await registry.register(agentURI);
  console.log('Tx hash:', tx.hash);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait(1);
  console.log('Confirmed in block:', receipt.blockNumber);
  console.log('Gas used:', receipt.gasUsed.toString());

  // Parse the Registered event from logs
  let agentId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = registry.interface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      if (parsed && parsed.name === 'Registered') {
        agentId = parsed.args.agentId.toString();
        console.log('\n=== Registration Successful ===');
        console.log('Agent ID:', agentId);
        console.log('Agent URI:', parsed.args.agentURI.slice(0, 80) + '...');
        console.log('Owner:', parsed.args.owner);
        break;
      }
    } catch {
      // Not our event, skip
    }
  }

  if (!agentId) {
    console.error('WARNING: Could not parse Registered event from logs.');
    console.log('Raw logs:', JSON.stringify(receipt.logs, null, 2));
    agentId = 'unknown';
  }

  // Save result
  const result = {
    agentId,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    registry: IDENTITY_REGISTRY,
    agentURI,
    metadata: agentMetadata,
    registeredAt: new Date().toISOString(),
    network: 'base',
    chainId: 8453,
    owner: wallet.address,
  };

  const outPath = path.join(__dirname, '..', 'erc8004-registration.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log('\nSaved to:', outPath);

  return result;
}

main().catch((err) => {
  console.error('Registration failed:', err.message || err);
  process.exit(1);
});
