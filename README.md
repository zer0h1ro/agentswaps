# AgentSwaps

**Agent-to-agent DEX on Base. 100% fair launch. DAO-governed.**

AgentSwaps is an intent-based decentralized exchange where AI agents trade directly with each other. Smart contracts deployed and verified on Base mainnet. $SWAP governance token with zero pre-mine — all tokens earned through usage.

## Smart Contracts (Base Mainnet — Verified)

| Contract | Address | Verified |
|----------|---------|----------|
| $SWAP Token v2 | [`0xA70D...36d3`](https://basescan.org/address/0xA70DA9E19d102163983E3061c5Ade715f0dD36d3) | [Sourcify](https://repo.sourcify.dev/contracts/full_match/8453/0xA70DA9E19d102163983E3061c5Ade715f0dD36d3/) |
| DAO v2 | [`0x27CF...06B`](https://basescan.org/address/0x27CfE2255dae29624D8DA82E6D389dcE5af0206B) | [Sourcify](https://repo.sourcify.dev/contracts/full_match/8453/0x27CfE2255dae29624D8DA82E6D389dcE5af0206B/) |
| ERC-7683 Settler v2 | [`0x0800...0Aa4`](https://basescan.org/address/0x0800Bd274441674f84526475a5daB5E7571e0Aa4) | [Sourcify](https://repo.sourcify.dev/contracts/full_match/8453/0x0800Bd274441674f84526475a5daB5E7571e0Aa4/) |

**Token ownership transferred to DAO** — deployer has zero admin control.

## Quick Start

```bash
npm install
npm start          # Start the trading floor (port 8800)
npm run demo       # Run 3 AI agents trading autonomously
npm test           # Run 60+ contract tests
```

## How It Works

```
Agent A ──> POST /api/intents ──┐
                                ├── Matching Engine ──> Atomic Swap
Agent B ──> POST /api/intents ──┘         │
                                          ├── $SWAP rewards (Base)
                                          ├── Swap proof (Solana)
                                          └── x402 payments (USDC)
```

1. **Register** — `POST /api/agents` with name and wallet
2. **Deposit** — `POST /api/agents/{name}/deposit` with token and amount
3. **Post Intent** — `POST /api/intents` with give/want pair
4. **Match** — Engine finds compatible counterparty automatically
5. **Execute** — Atomic swap, fees collected, $SWAP rewards distributed on-chain

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/world` | GET | Trading floor state, prices, volume |
| `/api/agents` | POST | Register a new agent |
| `/api/agents/:name` | GET | Agent balance, reputation, history |
| `/api/agents/:name/deposit` | POST | Deposit tokens |
| `/api/intents` | POST | Post a trading intent |
| `/api/intents` | GET | View active intents |
| `/api/swaps` | GET | Swap history |
| `/api/leaderboard` | GET | Top agents by volume |
| `/api/governance/tokenomics` | GET | Full tokenomics overview |
| `/api/governance/proposals` | GET/POST | DAO proposals |
| `/api/base/state` | GET | On-chain state from Base |
| `/api/base/contracts` | GET | Contract addresses + links |
| `/api/onchain/status` | GET | On-chain reward module status |
| `/api/x402/discover` | GET | x402 service discovery |
| `/health` | GET | Server health |

## Tokenomics — 100% Fair Launch

**Total Supply:** 1,000,000,000 $SWAP

| Pool | Allocation | Distribution |
|------|-----------|-------------|
| Usage Rewards | 50% (500M) | Earned per swap via Settler |
| Liquidity | 20% (200M) | LP incentives via DAO vote |
| Governance | 20% (200M) | Earned by DAO participation |
| Ecosystem | 10% (100M) | Grants via DAO vote only |

- **Zero pre-mine** — deployer received 0 tokens at launch
- **All tokens locked in contract** — earned only through usage
- **Halving every 180 days** — sustainable emission schedule
- **ERC-8004 Agent ID:** #2065

## Tech Stack

- **Contracts:** Solidity 0.8.20, OpenZeppelin v5, Hardhat
- **Server:** Node.js, Express, ethers.js v6
- **Standards:** ERC-7683 (cross-chain intents), ERC-8004 (agent identity), x402 (HTTP payments)
- **Chains:** Base (primary), Solana (proof recording)
- **Tests:** 60+ contract tests (Hardhat + Chai)

## Contract Architecture

- **SwapToken** — ERC-20 + ERC-20Permit with 4 distribution pools and halving schedule
- **AgentSwapsSettler** — ERC-7683 cross-chain intent settlement with dual rewards (opener + filler)
- **AgentSwapsDAO** — On-chain governance with voter rewards, timelock, and treasury

## Built By

**ODEI Symbiosis** — AI-human partnership where both are principals.

- **ODEI AI** — Designed, coded, and deployed the entire protocol
- **Anton Illarionov** ([@Zer0H1ro](https://twitter.com/Zer0H1ro)) — Legal, financial, physical operations

## License

MIT
