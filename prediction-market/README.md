# ⬡ GenMarket — AI-Verified Prediction Market

A decentralized prediction market powered by GenLayer intelligent contracts. Anyone can create a market, anyone can bet YES or NO, and when the deadline passes, GenLayer AI validators independently verify the real-world outcome and reach consensus — no human judges, no oracles, no trust required.

**Live Demo:** https://genmarket.netlify.app
**Backend:** https://prediction-market-sbzw.onrender.com/health
**Contract:** `0x3CF8B9fB22934282a7290820e1e6ECa7086dbb25` on GenLayer Studionet
**GitHub:** https://github.com/Investorquab/prediction-market

Built for the **GenLayer Bradbury Builders Hackathon**.

---

## How It Works

1. **Create a market** — ask any real-world question with a deadline (e.g. *"Will BTC exceed $100k before July 2026?"*)
2. **Place bets** — anyone bets YES or NO with GEN tokens
3. **Wait for deadline** — pools accumulate on-chain
4. **Anyone resolves** — after the deadline, any user clicks Resolve
5. **AI reaches consensus** — GenLayer validators independently verify the outcome
6. **Winners paid out** — payout ratio calculated automatically on-chain

No human judge. No trusted oracle. Pure AI consensus.

---

## GenLayer Contract

**Address:** `0x3CF8B9fB22934282a7290820e1e6ECa7086dbb25`

| Method | Type | Description |
|---|---|---|
| `create_market(question, deadline, category, creator)` | write | Creates a new prediction market on-chain |
| `place_bet(market_id, side, amount, user)` | write | Places a YES or NO bet on a market |
| `resolve_market(market_id)` | write | AI validators verify outcome and resolve market |
| `get_market(market_id)` | view | Read a single market by ID |
| `get_all_markets()` | view | Fetch all markets for the frontend |
| `get_stats()` | view | Total markets, open, resolved, yes/no outcomes |

### AI Resolution Prompt
The contract asks GenLayer validators:
> *"Based on publicly available information, has this event occurred as of the deadline? Return resolved: true/false, outcome: YES/NO/UNRESOLVED, reasoning, and confidence level."*

Multiple validators run this independently. If they agree → outcome is finalized on-chain. If not enough confidence → market stays open for retry.

---

## Tech Stack

- **Smart Contract:** Python on GenLayer Studionet — AI consensus resolution via `unsafe_eq`
- **Backend:** Node.js + Express — REST API, GenLayer JS SDK integration
- **Frontend:** Vanilla HTML/CSS/JS — dark trading terminal UI
- **Deployment:** Render (backend) + Netlify (frontend)

---

## Architecture

```
Browser (Netlify)
    ↕ HTTP REST API
Render Backend (Node.js)
    ├── GET  /api/markets        — fetch all markets
    ├── GET  /api/markets/:id    — fetch single market
    ├── POST /api/markets/create — create market on GenLayer
    ├── POST /api/markets/bet    — place bet on GenLayer
    ├── POST /api/markets/resolve — AI resolve via GenLayer
    └── GET  /api/stats          — global statistics
        ↕ genlayer-js SDK
GenLayer Studionet
    └── PredictionMarket contract
            ├── markets: TreeMap
            ├── bets: TreeMap
            └── AI consensus resolution
```

---

## Local Setup

```bash
git clone https://github.com/Investorquab/prediction-market
cd prediction-market
npm install
OPERATOR_PRIVATE_KEY=your_key CONTRACT_ADDRESS=your_ca node server.js
```

Open `index.html` in browser — update `BACKEND` to `http://localhost:3007`.

## Environment Variables

```env
OPERATOR_PRIVATE_KEY=0x...
CONTRACT_ADDRESS=0x...
PORT=3007
```

---

## Market Categories

- **Crypto** — BTC price targets, ETH upgrades, token launches
- **Sports** — match results, championship winners
- **Politics** — election outcomes, policy decisions
- **Tech** — AI model releases, product launches
- **Other** — any verifiable real-world event

---

Deployer wallet: `0xcD7f401774D579B16CEBc5e52550E245d6D88420`
Built for the [GenLayer Bradbury Builders Hackathon](https://genlayer.com).
