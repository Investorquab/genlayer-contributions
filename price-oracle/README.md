# 🔮 GenLayer Price Oracle

An on-chain cryptocurrency price feed built on [GenLayer](https://genlayer.com). Live crypto prices verified by AI consensus across multiple validators.

**Live Demo:** [price-oracle.netlify.app](https://price-oracle.netlify.app)  
**Backend:** [price-oracle-production.up.railway.app](https://price-oracle-production.up.railway.app/health)  
**Contract:** `0xe8e79649057eF178C091E6533ade1A66E489C288` on GenLayer Studionet  
**GitHub:** [github.com/Investorquab/price-oracle](https://github.com/Investorquab/price-oracle)

---

## What It Does

- Fetches live cryptocurrency prices via AI-powered GenLayer smart contracts
- Prices verified by consensus across multiple AI validators (Claude, GPT, Llama, etc.)
- Records price snapshots permanently on-chain for historical tracking
- Search any coin by name, ticker, or CoinGecko ID
- Bloomberg terminal aesthetic dashboard

## GenLayer Features Used

| Feature | Usage |
|---|---|
| `gl.nondet.exec_prompt()` | AI validators fetch price estimates |
| `gl.eq_principle.strict_eq()` | Validators must agree on price within tolerance |
| On-chain state | Price snapshots stored permanently in `TreeMap` |
| GenLayer Consensus | Multiple AI models verify each price query |

## Contract Methods

| Method | Type | Description |
|---|---|---|
| `get_price(coin_id)` | write | Fetch & verify price via AI consensus |
| `get_prices(coin_ids_csv)` | write | Batch fetch up to 6 coins |
| `record_price(coin_id)` | write | Fetch + store snapshot on-chain permanently |
| `get_price_history(coin_id)` | view | Read stored price snapshots |
| `get_stats()` | view | Oracle statistics |

## Tech Stack

- **Smart Contract:** Python on GenLayer Studionet
- **Backend:** Node.js + Express + genlayer-js
- **Frontend:** Vanilla HTML/CSS/JS — Bloomberg terminal aesthetic
- **Live Prices:** CryptoCompare API (60s cache)
- **Deployment:** Railway (backend) + Netlify (frontend)

## Local Setup

### 1. Deploy Contract
Open [studio.genlayer.com](https://studio.genlayer.com) → create new contract → paste `price_feed_oracle.py` → deploy → copy contract address.

### 2. Start Backend
```bash
cd backend
npm install
OPERATOR_PRIVATE_KEY=your_key CONTRACT_ADDRESS=your_ca node server.js
```

### 3. Open Frontend
Open `index.html` in your browser → paste contract address → search any coin.

## Environment Variables

```env
OPERATOR_PRIVATE_KEY=0x...   # Your GenLayer wallet private key
CONTRACT_ADDRESS=0x...        # Deployed price oracle contract address
PORT=3002
```

## Supported Coins

BTC, ETH, SOL, BNB, XRP, ADA, DOGE, DOT, LINK, LTC, AVAX, UNI, SHIB, PEPE, TRX, NEAR, APT, SUI, XLM, DAI, USDT + any CoinGecko ID

---

Built for the [GenLayer Mini-games & Tools](https://genlayer.com) contribution program.  
Deployer wallet: `0xcD7f401774D579B16CEBc5e52550E245d6D88420`
