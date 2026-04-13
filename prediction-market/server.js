import express from 'express';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';

const app = express();
const PORT = process.env.PORT || 3007;

const OPERATOR_KEY     = process.env.OPERATOR_PRIVATE_KEY || '0xa7db0893b5433f384c92669e3d54b7106e069a8d3cff415ee31affebdfa6b0bc';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS     || '0x3CF8B9fB22934282a7290820e1e6ECa7086dbb25';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ── GENLAYER CLIENT ───────────────────────────
let glClient = null;

async function getClient() {
  if (glClient) return glClient;
  const account = createAccount(OPERATOR_KEY);
  glClient = createClient({ chain: studionet, account });
  return glClient;
}

async function writeContract(functionName, args) {
  const client = await getClient();
  const hash   = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value: 0n,
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status:   TransactionStatus.FINALIZED,
    retries:  50,
    interval: 3000,
  });
  return extractResult(receipt);
}

async function readContract(functionName, args = []) {
  const client = await getClient();
  const result = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
  });
  return result;
}

function extractResult(receipt) {
  try {
    const lr       = receipt?.consensus_data?.leader_receipt?.[0];
    const readable = lr?.result?.payload?.readable;
    if (!readable) return null;
    const cleaned  = readable.replace(/^"|"$/g, '').replace(/\\"/g, '"').replace(/\\n/g, '');
    return JSON.parse(cleaned);
  } catch(e) {
    console.log('Extract error:', e.message);
    return null;
  }
}

// ── ROUTES ─────────────────────────────────────

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'alive', service: 'GenLayer Prediction Market', contract: CONTRACT_ADDRESS });
});

// GET all markets
app.get('/api/markets', async (req, res) => {
  try {
    const result = await readContract('get_all_markets');
    res.json({ success: true, ...result });
  } catch(e) {
    console.error('get_all_markets error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET single market
app.get('/api/markets/:id', async (req, res) => {
  try {
    const result = await readContract('get_market', [req.params.id]);
    res.json({ success: true, ...result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET stats
app.get('/api/stats', async (req, res) => {
  try {
    const result = await readContract('get_stats');
    res.json({ success: true, ...result });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST create market
app.post('/api/markets/create', async (req, res) => {
  const { question, deadline, category, creator } = req.body;
  if (!question || !deadline || !category || !creator) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  try {
    console.log(`📝 Creating market: "${question}"`);
    const result = await writeContract('create_market', [question, deadline, category, creator]);
    console.log(`✅ Market created:`, result);
    res.json({ success: true, ...result });
  } catch(e) {
    console.error('create_market error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST place bet
app.post('/api/markets/bet', async (req, res) => {
  const { market_id, side, amount, user } = req.body;
  if (!market_id || !side || !amount || !user) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  try {
    console.log(`💰 Bet: ${user} → ${side} on ${market_id} (${amount} GEN)`);
    const result = await writeContract('place_bet', [market_id, side, parseInt(amount), user]);
    console.log(`✅ Bet placed:`, result);
    res.json({ success: true, ...result });
  } catch(e) {
    console.error('place_bet error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST resolve market
app.post('/api/markets/resolve', async (req, res) => {
  const { market_id } = req.body;
  if (!market_id) {
    return res.status(400).json({ success: false, error: 'Missing market_id' });
  }
  try {
    console.log(`🤖 Resolving market: ${market_id}`);
    const result = await writeContract('resolve_market', [market_id]);
    console.log(`✅ Resolved:`, result);
    res.json({ success: true, ...result });
  } catch(e) {
    console.error('resolve_market error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Prediction Market API running on port ${PORT}`);
  console.log(`📌 Contract: ${CONTRACT_ADDRESS}`);
});
