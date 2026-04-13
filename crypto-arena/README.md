# ⬡ Crypto Arena — BTC Prediction Battle

A real-time multiplayer BTC price prediction game built on GenLayer. Up to 8 players compete by predicting whether Bitcoin will go UP or DOWN. Last player standing wins — result permanently recorded on-chain by GenLayer AI consensus.

**Live Demo:** https://gen-crypto-arena.netlify.app
**Backend:** https://crypto-arena-production.up.railway.app/health
**Contract:** `0x345A504a4609A584405805cbd923bf67Dd0DB939` on GenLayer Studionet
**GitHub:** https://github.com/Investorquab/crypto-arena

---

## How to Play

1. Go to the live demo and enter your name
2. Click **Create Room** — share the 4-letter room code with friends
3. Friends join using the code — up to 8 players per room
4. Host clicks **Start Game** when everyone is ready
5. Each round:
   - **7 seconds** to place your BUY or SELL bet on BTC
   - **15 seconds** watching the live BTC price chart
   - Price goes UP → BUY voters win, SELL voters lose a life
   - Price goes DOWN → SELL voters win, BUY voters lose a life
6. Each player starts with **2 lives** — lose both and you're eliminated
7. Last player standing **wins** — recorded permanently on GenLayer!

---

## GenLayer Integration

| Feature | Usage |
|---|---|
| `record_winner()` | AI validators verify and store the game result on-chain |
| `get_game(room_code)` | Read any stored game result |
| `get_wins(player)` | Check a player's all-time win count |
| `get_stats()` | Total games and players recorded |

The winner of each game is verified by GenLayer AI consensus and stored permanently on-chain. The transaction hash is displayed to all players at the end of the game — provable, tamper-proof game history.

---

## Tech Stack

- **Smart Contract:** Python on GenLayer Studionet — AI consensus winner verification
- **Backend:** Node.js + Express + WebSockets — real-time multiplayer game engine
- **Price Feed:** CoinGecko API — live BTC/USD price every 2 seconds
- **Frontend:** Vanilla HTML/CSS/JS — dark trading terminal aesthetic, Canvas chart
- **Deployment:** Railway (backend) + Netlify (frontend)

---

## Game Rules

- Up to **8 players** per room
- Each player starts with **2 lives** ❤️❤️
- **7 seconds** to bet BUY or SELL each round
- **15 seconds** watching live BTC price
- Correct call: **+20 points**
- Wrong call: **-30 points** + lose a life
- Miss a bet: **-20 points** + lose a life
- 0 lives = eliminated
- Last player alive wins and is **recorded on GenLayer**

---

## Local Setup
```bash
git clone https://github.com/Investorquab/crypto-arena
cd crypto-arena
npm install
OPERATOR_PRIVATE_KEY=your_key CONTRACT_ADDRESS=your_ca node server.js
```

## Environment Variables
```env
OPERATOR_PRIVATE_KEY=0x...
CONTRACT_ADDRESS=0x...
PORT=3006
```

Built for the GenLayer multiplayer games contribution program.
Deployer: 0xcD7f401774D579B16CEBc5e52550E245d6D88420
