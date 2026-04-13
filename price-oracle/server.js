import express from 'express';
import http from 'http';
import cors from 'cors';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus } from 'genlayer-js/types';

const OPERATOR_KEY       = process.env.OPERATOR_PRIVATE_KEY || '0xa7db0893b5433f384c92669e3d54b7106e069a8d3cff415ee31affebdfa6b0bc';
const DEFAULT_CONTRACT   = process.env.ORACLE_CONTRACT || '0xe8e79649057eF178C091E6533ade1A66E489C288';
const PORT         = process.env.PORT || 3002;
const STUDIO_RPC   = 'https://studio.genlayer.com/api';

const app        = express();
const httpServer = http.createServer(app);
app.use(cors({ origin: '*' }));
app.use(express.json());

let client          = null;
let operatorAccount = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function initializeClient() {
  try {
    operatorAccount = createAccount(OPERATOR_KEY);
    client = createClient({ chain: studionet, account: operatorAccount });
    await client.initializeConsensusSmartContract();
    console.log('✅ Connected! Operator:', operatorAccount.address);
    return true;
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    return false;
  }
}

// ── RPC HELPERS ───────────────────────────────────────────────────────────────
async function readContract(contractAddress, functionName, args = []) {
  try {
    const payload = {
      jsonrpc: '2.0', method: 'gen_call',
      params: [{ to: contractAddress, data: { method: functionName, args }, state_status: 'accepted' }],
      id: Date.now(),
    };
    const res  = await fetch(STUDIO_RPC, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    const raw = json.result;
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string' && raw.startsWith('0x')) {
      const decoded = Buffer.from(raw.slice(2), 'hex').toString('utf8');
      try { return JSON.parse(decoded); } catch(e) { return decoded; }
    }
    return raw;
  } catch (err) {
    throw err;
  }
}

async function writeContract(contractAddress, functionName, args = []) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`📝 ${functionName} (attempt ${attempt})`);
      const txHash = await client.writeContract({
        address: contractAddress, functionName, args, value: 0n, leaderOnly: true,
      });
      console.log('⏳ Waiting...', txHash);
      const receipt = await client.waitForTransactionReceipt({
        hash: txHash, status: TransactionStatus.ACCEPTED, retries: 30, interval: 3000,
      });
      console.log('✅ Done:', functionName);
      return receipt;
    } catch (err) {
      console.log(`Attempt ${attempt} failed: ${err.message.slice(0,80)}`);
      if (attempt < 3) await sleep(4000);
      else throw err;
    }
  }
}

function extractResult(receipt) {
  try {
    const lr = receipt?.consensus_data?.leader_receipt?.[0];

    // 1. Try result.payload.readable (GenLayer wraps return value here)
    const readable = lr?.result?.payload?.readable;
    if (readable) {
      console.log('📦 readable raw:', String(readable).slice(0, 200));
      // Could be: "{\"success\":true,...}" or {"success":true,...} or a plain string
      let str = readable;
      // Strip surrounding quotes if present
      if (typeof str === 'string' && str.startsWith('"') && str.endsWith('"')) {
        str = str.slice(1, -1);
      }
      // Unescape
      str = str.replace(/\\"/g, '"').replace(/\\n/g, '').replace(/\\t/g, '');
      try { const r = JSON.parse(str); console.log('✅ Parsed from readable'); return r; } catch(e) {}
      // Try as-is
      try { const r = JSON.parse(readable); console.log('✅ Parsed readable as-is'); return r; } catch(e) {}
    }

    // 2. Try stdout
    const stdout = lr?.genvm_result?.stdout;
    if (stdout && stdout.trim()) {
      console.log('📦 stdout:', stdout.trim().slice(0, 200));
      try { const r = JSON.parse(stdout.trim()); console.log('✅ Parsed from stdout'); return r; } catch(e) {}
    }

    // 3. Try eq_outputs (sometimes result is here)
    const eq = lr?.eq_outputs;
    if (eq && Object.keys(eq).length > 0) {
      const first = Object.values(eq)[0];
      console.log('📦 eq_outputs:', String(first).slice(0, 200));
      try { const r = JSON.parse(first); console.log('✅ Parsed from eq_outputs'); return r; } catch(e) {}
    }

    // Log full structure so we know what to look at
    console.log('⚠️  Full lr keys:', Object.keys(lr || {}));
    console.log('⚠️  lr.result:', JSON.stringify(lr?.result)?.slice(0, 300));
    console.log('⚠️  lr.genvm_result:', JSON.stringify(lr?.genvm_result)?.slice(0, 300));
    return null;
  } catch(e) {
    console.log('extractResult error:', e.message);
    return null;
  }
}

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'alive', service: 'GenLayer Price Feed Oracle', port: PORT });
});

// Proxy for CoinGecko live prices (avoids browser CORS issues)
// Price cache - store prices for 60 seconds to avoid rate limits
const priceCache = {};
const CACHE_TTL  = 60 * 1000; // 60 seconds

// CoinGecko ID -> CryptoCompare symbol mapping
const ID_TO_SYM = {
  'bitcoin':'BTC','ethereum':'ETH','solana':'SOL','binancecoin':'BNB',
  'ripple':'XRP','cardano':'ADA','dogecoin':'DOGE','polkadot':'DOT',
  'chainlink':'LINK','litecoin':'LTC','avalanche-2':'AVAX','uniswap':'UNI',
  'shiba-inu':'SHIB','pepe':'PEPE','tron':'TRX','near':'NEAR',
  'aptos':'APT','sui':'SUI','stellar':'XLM','dai':'DAI',
  'tether':'USDT','usd-coin':'USDC','matic-network':'MATIC',
};

app.get('/api/live-prices', async (req, res) => {
  const ids = (req.query.ids || 'bitcoin,ethereum,solana').split(',').map(s => s.trim());
  const result = {};
  const toFetch = [];

  // Check cache first
  for (const id of ids) {
    const cached = priceCache[id];
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      result[id] = cached.data;
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length > 0) {
    // Convert CoinGecko IDs to CryptoCompare symbols
    const syms = toFetch.map(id => ID_TO_SYM[id] || id.toUpperCase()).join(',');
    console.log('🌐 Fetching live prices for:', toFetch.join(', '));

    try {
      // Try CryptoCompare first (higher rate limits)
      const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${syms}&tsyms=USD`;
      const r   = await fetch(url);
      const raw = await r.json();
      const data = raw.RAW || {};

      for (const id of toFetch) {
        const sym     = ID_TO_SYM[id] || id.toUpperCase();
        const coinRaw = data[sym]?.USD;
        if (coinRaw) {
          const priceData = {
            usd:             coinRaw.PRICE,
            usd_24h_change:  coinRaw.CHANGEPCT24HOUR,
            usd_market_cap:  coinRaw.MKTCAP,
            usd_24h_vol:     coinRaw.VOLUME24HOURTO,
          };
          result[id]       = priceData;
          priceCache[id]   = { data: priceData, ts: Date.now() };
        }
      }

      const fetched = Object.keys(result);
      console.log('✅ Live prices fetched:', fetched.join(', ') || 'none');
    } catch(err) {
      console.log('❌ CryptoCompare error:', err.message);
      // Fallback: try CoinGecko with only first 3 to avoid rate limit
      try {
        const limited = toFetch.slice(0, 3).join(',');
        const cgUrl   = `https://api.coingecko.com/api/v3/simple/price?ids=${limited}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
        const cgr     = await fetch(cgUrl);
        if (cgr.ok) {
          const cgData = await cgr.json();
          for (const id of toFetch.slice(0, 3)) {
            if (cgData[id]) {
              result[id]     = cgData[id];
              priceCache[id] = { data: cgData[id], ts: Date.now() };
            }
          }
        }
      } catch(e2) {}
    }
  }

  res.json({ success: true, prices: result });
});

// Fetch live price via contract (on-chain verification)
app.post('/api/get-price', async (req, res) => {
  const { contract, coinId } = req.body;
  if (!contract || !coinId) return res.status(400).json({ success: false, error: 'contract and coinId required' });
  try {
    console.log(`🔍 get_price(${coinId}) via contract ${contract.slice(0,10)}...`);
    const receipt = await writeContract(contract, 'get_price', [coinId]);
    const data    = extractResult(receipt);
    res.json({ success: true, data });
  } catch (err) {
    console.error('get_price error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// Fetch multiple prices
app.post('/api/get-prices', async (req, res) => {
  const { contract, coinIds } = req.body;
  if (!contract || !coinIds) return res.status(400).json({ success: false, error: 'contract and coinIds required' });
  try {
    console.log(`🔍 get_prices(${coinIds}) via contract ${contract.slice(0,10)}...`);
    const receipt = await writeContract(contract, 'get_prices', [coinIds]);
    const data    = extractResult(receipt);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Record price on-chain
app.post('/api/record-price', async (req, res) => {
  const { contract, coinId } = req.body;
  if (!contract || !coinId) return res.status(400).json({ success: false, error: 'contract and coinId required' });
  try {
    console.log(`◈ record_price(${coinId}) — storing on-chain...`);
    const receipt = await writeContract(contract, 'record_price', [coinId]);
    const data    = extractResult(receipt);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Get on-chain price history
app.get('/api/price-history', async (req, res) => {
  const { contract, coinId } = req.query;
  if (!contract || !coinId) return res.status(400).json({ success: false, error: 'contract and coinId required' });
  try {
    const data = await readContract(contract, 'get_price_history', [coinId]);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Get oracle stats
app.get('/api/stats', async (req, res) => {
  const { contract } = req.query;
  if (!contract) return res.status(400).json({ success: false, error: 'contract required' });
  try {
    const data = await readContract(contract, 'get_stats', []);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Get tracked symbols
app.get('/api/tracked', async (req, res) => {
  const { contract } = req.query;
  if (!contract) return res.status(400).json({ success: false, error: 'contract required' });
  try {
    const data = await readContract(contract, 'get_tracked_symbols', []);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
async function main() {
  const ok = await initializeClient();
  if (!ok) { console.error('Failed to connect. Exiting.'); process.exit(1); }
  httpServer.listen(PORT, () => {
    console.log(`\n✅ Price Oracle Backend running on port ${PORT}`);
    console.log(`📌 Health: http://localhost:${PORT}/health`);
    console.log(`💡 Deploy price_feed_oracle.py to GenLayer Studio first!\n`);
  });
}

main();
