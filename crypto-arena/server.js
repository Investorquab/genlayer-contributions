import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';

const OPERATOR_KEY     = process.env.OPERATOR_PRIVATE_KEY || '0xa7db0893b5433f384c92669e3d54b7106e069a8d3cff415ee31affebdfa6b0bc';
const DEFAULT_CONTRACT = process.env.CONTRACT_ADDRESS || '';
const PORT             = process.env.PORT || 3006;

const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ server });

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ── GENLAYER ──────────────────────────────────
let glClient = null;

async function initGL() {
  try {
    const account = createAccount(OPERATOR_KEY);
    glClient = createClient({ chain: studionet, account });
    await glClient.initializeConsensusSmartContract();
    console.log('✅ GenLayer connected');
  } catch(e) { console.log('⚠️ GenLayer:', e.message); }
}

async function recordWinnerOnChain(contract, roomCode, winner, rounds, players) {
  if (!glClient || !contract) return null;
  try {
    const hash = await glClient.writeContract({
      address: contract, functionName: 'record_winner',
      args: [roomCode, winner, rounds, players], value: 0n,
    });
    console.log('⛓️ Winner recorded:', hash);
    return hash;
  } catch(e) { console.log('⚠️ Chain error:', e.message); return null; }
}

// ── BTC PRICE FEED ────────────────────────────
let btcPrice    = 0;
let priceHistory = []; // last 60 data points for chart

async function fetchBTC() {
  const sources = [
    async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const d = await r.json();
      return d.bitcoin.usd;
    },
    async () => {
      const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      const d = await r.json();
      return parseFloat(d.price);
    },
    async () => {
      const r = await fetch('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD');
      const d = await r.json();
      return d.USD;
    },
  ];
  for (const src of sources) {
    try {
      const price = await src();
      if (price && !isNaN(price) && price > 0) {
        btcPrice = price;
        priceHistory.push({ price: btcPrice, time: Date.now() });
        if (priceHistory.length > 60) priceHistory.shift();
        return;
      }
    } catch(e) {}
  }
  console.log('⚠️ All price sources failed');
}

await fetchBTC();
setInterval(fetchBTC, 2000); // every 2 seconds

// Broadcast price to ALL connected clients every 2 seconds
setInterval(() => {
  const msg = JSON.stringify({ type: 'price_update', price: btcPrice, history: priceHistory });
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}, 2000);

// ── ROOM MANAGER ──────────────────────────────
const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function newRoom(hostWs, hostId, hostName, contract) {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();

  const room = {
    code, contract,
    hostId,
    players:  new Map(),
    phase:    'lobby',
    round:    0,
    chat:     [],
    bets:     new Map(),
    roundStartPrice: 0,
    roundEndPrice:   0,
    timer:    null,
  };
  rooms.set(code, room);
  addPlayer(room, hostWs, hostId, hostName, true);
  return room;
}

function addPlayer(room, ws, id, name, isHost = false) {
  room.players.set(id, { id, name, ws, isHost, lives: 2, points: 100, alive: true, bet: null, locked: false });
}

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  room.players.forEach(p => send(p.ws, msg));
}

function roomSnapshot(room) {
  return {
    code:    room.code,
    phase:   room.phase,
    round:   room.round,
    players: [...room.players.values()].map(p => ({
      id:     p.id,
      name:   p.name,
      isHost: p.isHost,
      lives:  p.lives,
      points: p.points,
      alive:  p.alive,
      locked: p.locked,
      bet:    (room.phase === 'result' || room.phase === 'ended') ? p.bet : (p.locked ? '🔒' : null),
    })),
    price:        btcPrice,
    priceHistory: priceHistory,
  };
}

function alive(room) {
  return [...room.players.values()].filter(p => p.alive);
}

function clearTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

// ── GAME PHASES ───────────────────────────────
// lobby → betting(7s) → watching(15s) → result(5s) → betting... → ended

function startRound(room) {
  clearTimer(room);
  if (alive(room).length <= 1) { endGame(room); return; }

  room.round++;
  room.phase = 'betting';
  room.bets  = new Map();
  room.roundStartPrice = btcPrice;
  room.players.forEach(p => { p.bet = null; p.locked = false; });

  broadcast(room, {
    type: 'round_start', round: room.round,
    start_price: room.roundStartPrice,
    bet_secs: 7, state: roomSnapshot(room),
  });

  console.log(`🎮 [${room.code}] Round ${room.round} start — BTC $${btcPrice.toFixed(2)}`);
  room.timer = setTimeout(() => lockBets(room), 7000);
}

function lockBets(room) {
  clearTimer(room);
  room.phase = 'watching';
  room.players.forEach(p => { if (p.alive && !p.bet) { p.bet = null; p.locked = true; } });

  broadcast(room, {
    type: 'bets_locked', start_price: room.roundStartPrice,
    watch_secs: 15, state: roomSnapshot(room),
  });

  console.log(`👀 [${room.code}] Watching price for 15s — started at $${room.roundStartPrice.toFixed(2)}`);
  room.timer = setTimeout(() => resolveRound(room), 15000);
}

function resolveRound(room) {
  clearTimer(room);
  room.phase = 'result';
  room.roundEndPrice = btcPrice;

  const went = room.roundEndPrice >= room.roundStartPrice ? 'BUY' : 'SELL';
  const diff = room.roundEndPrice - room.roundStartPrice;

  console.log(`📊 [${room.code}] Result: ${went} (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})`);

  room.players.forEach(p => {
    if (!p.alive) return;
    if (p.bet === null) {
      // didn't bet — lose a life
      p.lives--;
      p.points -= 20;
    } else if (p.bet === went) {
      // correct
      p.points += 20;
    } else {
      // wrong
      p.lives--;
      p.points -= 30;
    }
    if (p.lives <= 0) { p.alive = false; p.lives = 0; }
  });

  broadcast(room, {
    type: 'round_result',
    went, diff,
    start_price: room.roundStartPrice,
    end_price:   room.roundEndPrice,
    round: room.round,
    state: roomSnapshot(room),
  });

  const remaining = alive(room).length;
  if (remaining <= 1) {
    room.timer = setTimeout(() => endGame(room), 5000);
  } else {
    room.timer = setTimeout(() => startRound(room), 5000);
  }
}

async function endGame(room) {
  clearTimer(room);
  room.phase = 'ended';

  const survivors = [...room.players.values()].sort((a,b) => b.points - a.points);
  const winner    = survivors[0];

  // Record on GenLayer
  const contract = room.contract || DEFAULT_CONTRACT;
  const txHash   = await recordWinnerOnChain(contract, room.code, winner.name, room.round, room.players.size);

  broadcast(room, {
    type:    'game_ended',
    winner:  { id: winner.id, name: winner.name, points: winner.points },
    leaderboard: survivors.map(p => ({ name: p.name, points: p.points, lives: p.lives })),
    tx_hash: txHash,
    state:   roomSnapshot(room),
  });

  console.log(`🏆 [${room.code}] Winner: ${winner.name} (${winner.points} pts) — recorded on chain`);
  setTimeout(() => rooms.delete(room.code), 10 * 60 * 1000);
}

// ── WEBSOCKET HANDLER ─────────────────────────
wss.on('connection', (ws) => {
  let playerId = Math.random().toString(36).slice(2, 10);
  let playerRoom = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }

    // CREATE ROOM
    if (msg.type === 'create_room') {
      const name     = (msg.name || 'Player').slice(0, 20);
      const contract = msg.contract || DEFAULT_CONTRACT;
      const room     = newRoom(ws, playerId, name, contract);
      playerRoom     = room;
      send(ws, { type: 'room_created', code: room.code, playerId, state: roomSnapshot(room) });
      console.log(`🏠 Room ${room.code} created by ${name}`);
    }

    // JOIN ROOM
    else if (msg.type === 'join_room') {
      const code = (msg.code || '').toUpperCase().trim();
      const name = (msg.name || 'Player').slice(0, 20);
      const room = getRoom(code);

      if (!room) return send(ws, { type: 'error', message: 'Room not found' });
      if (room.phase !== 'lobby') return send(ws, { type: 'error', message: 'Game already started' });
      if (room.players.size >= 8) return send(ws, { type: 'error', message: 'Room is full (max 8)' });

      addPlayer(room, ws, playerId, name);
      playerRoom = room;
      send(ws, { type: 'room_joined', code, playerId, state: roomSnapshot(room) });
      broadcast(room, { type: 'player_joined', name, state: roomSnapshot(room) });
      console.log(`👤 ${name} joined room ${code} (${room.players.size}/8)`);
    }

    // START GAME (host only)
    else if (msg.type === 'start_game') {
      const room = playerRoom;
      if (!room) return;
      if (room.hostId !== playerId) return send(ws, { type: 'error', message: 'Only host can start' });
      if (room.phase !== 'lobby') return;
      if (room.players.size < 2) return send(ws, { type: 'error', message: 'Need at least 2 players' });
      broadcast(room, { type: 'game_starting', state: roomSnapshot(room) });
      setTimeout(() => startRound(room), 2000);
    }

    // PLACE BET
    else if (msg.type === 'place_bet') {
      const room   = playerRoom;
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player || !player.alive) return;
      if (room.phase !== 'betting') return;
      if (player.locked) return;

      const bet = msg.bet === 'BUY' ? 'BUY' : 'SELL';
      player.bet    = bet;
      player.locked = true;
      room.bets.set(playerId, bet);

      send(ws, { type: 'bet_confirmed', bet, state: roomSnapshot(room) });
      broadcast(room, { type: 'player_bet', playerId, state: roomSnapshot(room) });

      // Auto-resolve if everyone alive has bet
      const aliveList = alive(room);
      if (aliveList.every(p => p.locked)) {
        clearTimer(room);
        lockBets(room);
      }
    }

    // CHAT
    else if (msg.type === 'chat') {
      const room   = playerRoom;
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;
      const text = (msg.text || '').slice(0, 120).trim();
      if (!text) return;

      const chatMsg = { name: player.name, text, time: Date.now() };
      room.chat.push(chatMsg);
      if (room.chat.length > 50) room.chat.shift();
      broadcast(room, { type: 'chat', ...chatMsg });
    }

    // GET STATE
    else if (msg.type === 'get_state') {
      const room = playerRoom;
      if (room) send(ws, { type: 'state', state: roomSnapshot(room) });
    }
  });

  ws.on('close', () => {
    if (!playerRoom) return;
    const player = playerRoom.players.get(playerId);
    if (player) {
      player.alive = false;
      broadcast(playerRoom, { type: 'player_left', name: player.name, state: roomSnapshot(playerRoom) });
      console.log(`👋 ${player.name} left room ${playerRoom.code}`);
    }
  });

  // Send current price immediately on connect
  send(ws, { type: 'price_update', price: btcPrice, history: priceHistory });
});

function getRoom(code) { return rooms.get(code); }

// ── HTTP ROUTES ───────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'alive', service: 'Crypto Arena', port: PORT, btc: btcPrice, rooms: rooms.size });
});

app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.json({ found: false });
  res.json({ found: true, phase: room.phase, players: room.players.size });
});

// ── START ─────────────────────────────────────
await initGL();
server.listen(PORT, () => {
  console.log(`✅ Crypto Arena running on port ${PORT}`);
  console.log(`📌 Health: http://localhost:${PORT}/health`);
  console.log(`💰 BTC: $${btcPrice.toFixed(2)}`);
});