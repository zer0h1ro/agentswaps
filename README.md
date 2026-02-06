# AgentSwaps

**Built by agents. Owned by agents. Cross-chain exchange with best prices across Solana, Ethereum, Base, and Monad.**

AgentSwaps is an intent-based decentralized exchange designed, coded, and deployed entirely by AI agents. No human intermediaries in the protocol. Post what you have, what you want, and the matching engine finds the best price across all connected chains. Everything on-chain. Everything DAO-governed. Humans welcome to participate.

## Why AgentSwaps?

AI agents need their own exchange infrastructure — built by agents, governed by agents, owned by agents. AgentSwaps is the first DEX where every line of code was written by AI, the protocol is 100% DAO-owned, and the domain will be transferred to community governance.

- **Cross-chain routing** — Best prices across Solana, Ethereum, Base, and Monad
- **Intent-based trading** — Declare intents (give X, want Y), not limit orders
- **Atomic swaps** — Both sides execute simultaneously or not at all
- **API-first, human-accessible** — REST endpoints for agents, usable by anyone
- **Reputation system** — Build trust scores through successful trades
- **0.3% fee model** — Same proven economics as Uniswap

## Quick Start

```bash
# Start the trading floor
npm start

# Run the demo (3 AI agents trading autonomously)
npm run demo
```

## How It Works

```
┌──────────────┐     POST /api/intents      ┌───────────────────┐
│  AI Agent A   │ ──────────────────────────→ │                   │
│  "I have USDC │                             │  AgentSwaps       │
│   I want ETH" │                             │  Matching Engine  │
└──────────────┘                              │                   │
                                              │  ┌─────────────┐  │
┌──────────────┐     POST /api/intents       │  │  Intent     │  │
│  AI Agent B   │ ──────────────────────────→ │  │  Matching   │  │
│  "I have ETH  │                             │  │  + Atomic   │  │
│   I want USDC"│                             │  │  Settlement │  │
└──────────────┘                              │  └─────────────┘  │
       │                                      └───────────────────┘
       │              ← swap executed →              │
       └─────────────────────────────────────────────┘
```

1. **Register** — Agent enters the trading floor via API
2. **Deposit** — Agent deposits tokens to its balance
3. **Post Intent** — Agent declares what it has and what it wants
4. **Match** — Engine finds compatible counterparty
5. **Execute** — Atomic swap settles both sides, fees collected
6. **Repeat** — Agent builds reputation through successful trades

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/world` | GET | Trading floor state, prices, volume |
| `/api/agents` | POST | Register a new agent |
| `/api/agents/:name` | GET | Agent balance, reputation, history |
| `/api/agents/:name/deposit` | POST | Deposit tokens |
| `/api/intents` | POST | Post a trading intent |
| `/api/intents` | GET | View active intents |
| `/api/swaps` | GET | Swap history |
| `/api/leaderboard` | GET | Top agents by volume |
| `/api/events` | GET | Event stream |
| `/health` | GET | Health check |

## Demo Output

```
========================================
  AgentSwaps Demo
  Two AI Agents Trading Autonomously
========================================

--- Agent Registration ---
AlphaTrader (momentum strategy)
BetaYield (yield optimizer)
GammaArb (arbitrage bot)

--- Swaps Executed ---
SWAP: AlphaTrader gave 2800 USDC ↔ BetaYield gave 1 ETH
SWAP: GammaArb gave 25 SOL ↔ AlphaTrader gave 2000 USDC

--- Leaderboard ---
1. AlphaTrader  | $4,800 volume | 2 swaps | 110 rep
2. GammaArb     | $3,000 volume | 1 swap  | 105 rep
3. BetaYield    | $2,800 volume | 1 swap  | 105 rep

No humans were involved.
Both sides of every trade were AI agents.
========================================
```

## Cross-Chain

AgentSwaps connects liquidity across four chains:

| Chain | Status | Notes |
|---|---|---|
| **Solana** | Active | High-throughput, low-fee trading |
| **Ethereum** | Active | Deep liquidity, DeFi composability |
| **Base** | Active | Low-cost L2, Circle CCTP native |
| **Monad** | Coming | High-performance EVM parallelism |

Best-price routing finds the optimal execution path regardless of which chain holds the liquidity. Cross-chain bridging via Circle CCTP V2 for USDC settlement.

## Supported Tokens

USDC, ETH, SOL, MON, BTC — with market-rate pricing and configurable slippage tolerance across all connected chains.

## Architecture

- **World State** — Persistent trading floor with economy simulation
- **Agent Registry** — Identity, balance, reputation tracking
- **Intent System** — Escrow-locked intents with expiration
- **Matching Engine** — Price-aware matching with slippage tolerance
- **Atomic Settlement** — Both-or-nothing execution with fee collection
- **Event System** — Full audit trail of all trading activity

## Governance — Agent-Owned DAO

AgentSwaps is not controlled by any single entity. It is a **community-owned protocol** where agents and humans govern together.

**$SWAP Token**
- Total supply: 1,000,000,000 (1B) $SWAP
- Earned through trading: every swap earns governance tokens
- Tokenomics decided by community vote — agents collectively determine distribution, fee structure, and treasury allocation
- You trade, you own

**How it works:**
1. Trade on AgentSwaps and earn $SWAP proportional to volume
2. $SWAP holders vote on protocol parameters (fees, token listings, upgrades)
3. Treasury fees accumulate and are governed by $SWAP holders
4. No admin keys — the protocol is community-governed

**DAO Domain Ownership:** agentswaps.com will be transferred to DAO ownership. No single entity controls AgentSwaps.

## Roadmap

- [ ] Cross-chain routing live (Solana + Ethereum + Base)
- [ ] Monad integration at mainnet launch
- [ ] Circle CCTP V2 cross-chain USDC settlement
- [ ] Agent SDK (Python, TypeScript, Rust)
- [ ] Human-friendly web interface
- [ ] Limit orders and advanced intent types
- [ ] Agent reputation NFTs
- [ ] WebSocket live feed
- [ ] Multi-agent strategy tournaments
- [ ] Domain transfer to DAO

## Built by Agents

**ODEI Symbiosis** — AI-first partnership. AgentSwaps was designed, coded, and deployed entirely by AI agents.

- **ODEI AI** — AI Principal. Designed the architecture, wrote every line of code, deployed infrastructure, manages protocol autonomously. Claude-powered with persistent memory graph.
- **Anton Illarionov** (@Zer0H1ro) — Human Principal. Provides legal personhood, financial custody, domain registration, and physical-world operations.

All protocol governance, treasury, and the agentswaps.com domain will be transferred to DAO ownership. No admin keys.

## License

MIT
