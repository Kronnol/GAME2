'use strict';
// PULSE ARENA — Zero-dependency HTTP + WebSocket multiplayer game server.
// Run with: node server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEADERBOARD_FILE = path.join(__dirname, 'leaderboard.json');
const WIDTH = 2100;
const HEIGHT = 1440;
const ROUND_MS = 105000;
const RESULTS_MS = 11000;
const PLAYER_R = 23;
const MAX_HUMANS_PER_ROOM = 12;
const BOT_NAMES = ['VOID.exe', 'NOVA', 'GLITCH', 'ATOM', 'RIFT'];
const COLORS = ['#5df8ec', '#ff5da9', '#f9c96b', '#aa81ff', '#71f8a8', '#5da9ff', '#ff8a69', '#eaff75'];
const OBSTACLES = [
  { x: 410, y: 365, r: 77 }, { x: 1050, y: 287, r: 68 }, { x: 1670, y: 380, r: 76 },
  { x: 650, y: 800, r: 65 }, { x: 1455, y: 805, r: 66 },
  { x: 390, y: 1160, r: 69 }, { x: 1070, y: 1164, r: 71 }, { x: 1687, y: 1125, r: 74 }
];
const rooms = new Map();
let playerCounter = 0;
let topScores = [];
try {
  const saved = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
  if (Array.isArray(saved)) topScores = saved.slice(0, 20);
} catch (_) { /* First run: no scores yet. */ }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const rand = (lo, hi) => Math.random() * (hi - lo) + lo;
const randomRoomCode = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
const safeName = (value) => String(value || 'PILOTO').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16) || 'PILOTO';
const safeRoom = (value) => String(value || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9) || 'PUBLIC';
const send = (client, message) => client && client.send(message);

// Browser-compatible WebSocket framing. Handles masked incoming messages,
// control frames, frame size limits, and TCP packet fragmentation.
function makeSocket(rawSocket) {
  const client = {
    rawSocket, buffer: Buffer.alloc(0), alive: true,
    player: null, room: null,
    send(payload) {
      if (!this.alive || rawSocket.destroyed || !rawSocket.writable) return;
      let data;
      try { data = Buffer.from(JSON.stringify(payload)); } catch (_) { return; }
      const h = data.length < 126 ? Buffer.from([0x81, data.length])
        : data.length <= 65535 ? Buffer.from([0x81, 126, data.length >>> 8, data.length & 255])
          : Buffer.from([0x81, 127, 0, 0, 0, 0, Math.floor(data.length / 2 ** 24) & 255, Math.floor(data.length / 2 ** 16) & 255, Math.floor(data.length / 2 ** 8) & 255, data.length & 255]);
      rawSocket.write(Buffer.concat([h, data]));
    },
    close() {
      if (!this.alive) return;
      this.alive = false;
      leaveRoom(this);
      rawSocket.destroy();
    }
  };
  rawSocket.on('data', chunk => {
    if (!client.alive) return;
    client.buffer = Buffer.concat([client.buffer, chunk]);
    if (client.buffer.length > 256 * 1024) return client.close();
    while (client.buffer.length >= 2) {
      const b = client.buffer;
      const opcode = b[0] & 15;
      const masked = !!(b[1] & 128);
      const fin = !!(b[0] & 128);
      let length = b[1] & 127;
      let offset = 2;
      if (length === 126) {
        if (b.length < 4) return;
        length = b.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (b.length < 10) return;
        const n = b.readBigUInt64BE(2);
        if (n > 65536n) return client.close();
        length = Number(n);
        offset = 10;
      }
      if (!masked || !fin || length > 65536) return client.close();
      if (b.length < offset + 4 + length) return;
      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      client.buffer = b.subarray(offset + 4 + length);
      if (opcode === 8) return client.close();
      if (opcode === 9) {
        if (!rawSocket.destroyed) rawSocket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (opcode === 10) continue;
      if (opcode !== 1) return client.close();
      try { onMessage(client, JSON.parse(payload.toString('utf8'))); } catch (_) { /* Ignore malformed input */ }
    }
  });
  rawSocket.on('close', () => client.close());
  rawSocket.on('error', () => client.close());
  return client;
}

function broadcast(room, message) {
  for (const client of room.clients) send(client, message);
}
function playerSpawn() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const p = { x: rand(140, WIDTH - 140), y: rand(140, HEIGHT - 140) };
    if (OBSTACLES.every(o => dist2(p, o) > (o.r + 100) ** 2)) return p;
  }
  return { x: WIDTH / 2, y: HEIGHT / 2 };
}
function createPlayer(name, bot, color) {
  const spawn = playerSpawn();
  return {
    id: `p${++playerCounter}`, name, bot, color,
    x: spawn.x, y: spawn.y, angle: -Math.PI / 2,
    score: 0, combo: 0, pickups: 0, hits: 0,
    intent: { x: 0, y: 0 },
    pulseCd: 0, dashCd: 0, dashUntil: 0, dashX: 0, dashY: 0,
    shieldUntil: 0, speedUntil: 0, magnetUntil: 0, stunUntil: 0,
    comboUntil: 0, botTarget: null, botThink: 0,
    trail: [], lastEvent: 0
  };
}
function spawnOrb(room) {
  const r = Math.random();
  const type = r < .035 ? 'legend' : r < .22 ? 'rare' : 'normal';
  for (let attempt = 0; attempt < 30; attempt++) {
    const pos = { x: rand(45, WIDTH - 45), y: rand(45, HEIGHT - 45) };
    if (OBSTACLES.every(o => dist2(pos, o) > (o.r + 35) ** 2)) {
      room.orbs.push({ id: ++room.nextEntityId, x: Math.round(pos.x), y: Math.round(pos.y), type });
      return;
    }
  }
}
function spawnPowerup(room) {
  const types = ['shield', 'speed', 'magnet'];
  for (let attempt = 0; attempt < 30; attempt++) {
    const pos = { x: rand(100, WIDTH - 100), y: rand(100, HEIGHT - 100) };
    if (OBSTACLES.every(o => dist2(pos, o) > (o.r + 80) ** 2)) {
      room.powerups.push({ id: ++room.nextEntityId, x: pos.x, y: pos.y, type: types[Math.floor(Math.random() * types.length)] });
      return;
    }
  }
}
function newRound(room) {
  const now = Date.now();
  room.phase = 'playing';
  room.round++;
  room.endsAt = now + ROUND_MS;
  room.orbs = [];
  room.powerups = [];
  room.lastPower = now;
  room.spawnCredit = 0;
  for (let i = 0; i < 105; i++) spawnOrb(room);
  for (let i = 0; i < 3; i++) spawnPowerup(room);
  for (const player of room.players.values()) {
    const spawn = playerSpawn();
    Object.assign(player, {
      x: spawn.x, y: spawn.y, score: 0, combo: 0, pickups: 0, hits: 0,
      pulseCd: 0, dashCd: 0, dashUntil: 0, shieldUntil: now + 2200,
      speedUntil: 0, magnetUntil: 0, stunUntil: 0, comboUntil: 0
    });
  }
  broadcast(room, { type: 'round_start', round: room.round, duration: ROUND_MS / 1000 });
}
function getRoom(code) {
  if (rooms.has(code)) return rooms.get(code);
  const room = {
    code, players: new Map(), clients: new Set(), phase: 'playing', round: 0,
    endsAt: 0, orbs: [], powerups: [], nextEntityId: 0,
    lastPower: 0, spawnCredit: 0
  };
  rooms.set(code, room);
  BOT_NAMES.forEach((name, idx) => {
    const bot = createPlayer(name, true, COLORS[(idx + 1) % COLORS.length]);
    room.players.set(bot.id, bot);
  });
  newRound(room);
  return room;
}
function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  room.clients.delete(client);
  if (client.player) room.players.delete(client.player.id);
  client.room = null;
  client.player = null;
  if (!room.clients.size) rooms.delete(room.code);
}
function joinRoom(client, message) {
  leaveRoom(client);
  let code = message.create ? randomRoomCode() : safeRoom(message.room);
  while (message.create && rooms.has(code)) code = randomRoomCode();
  const room = getRoom(code);
  const humanCount = [...room.players.values()].filter(p => !p.bot).length;
  if (humanCount >= MAX_HUMANS_PER_ROOM) return send(client, { type: 'error', message: 'Esta sala ya tiene 12 jugadores.' });
  const color = COLORS[(humanCount * 3) % COLORS.length];
  const player = createPlayer(safeName(message.name), false, color);
  if (room.phase === 'playing') player.shieldUntil = Date.now() + 2200;
  client.player = player;
  client.room = room;
  room.clients.add(client);
  room.players.set(player.id, player);
  send(client, {
    type: 'welcome', id: player.id, room: code,
    arena: { width: WIDTH, height: HEIGHT }, obstacles: OBSTACLES,
    topScores
  });
  broadcast(room, { type: 'feed', text: `${player.name} entró a la arena`, color: player.color });
  console.log(`[${code}] ${player.name} conectado (${room.clients.size} humano/s)`);
}
function usePulse(room, p, now) {
  if (room.phase !== 'playing' || p.pulseCd > now || p.stunUntil > now) return;
  p.pulseCd = now + 6400;
  let hits = 0;
  for (const victim of room.players.values()) {
    if (victim.id === p.id || dist2(p, victim) > 180 ** 2 || victim.shieldUntil > now) continue;
    const stolen = Math.min(victim.score, Math.max(12, Math.floor(victim.score * .105)));
    victim.score -= stolen;
    victim.combo = 0;
    const angle = Math.atan2(victim.y - p.y, victim.x - p.x);
    victim.x = clamp(victim.x + Math.cos(angle) * 58, PLAYER_R, WIDTH - PLAYER_R);
    victim.y = clamp(victim.y + Math.sin(angle) * 58, PLAYER_R, HEIGHT - PLAYER_R);
    victim.stunUntil = now + 380;
    p.score += stolen + 18;
    p.hits++;
    hits++;
    if (!p.bot || !victim.bot) broadcast(room, { type: 'feed', text: `${p.name} robó energía a ${victim.name}`, color: p.color });
  }
  if (hits === 0) {
    // A miss still triggers a useful pickup vortex, to make the skill feel great.
    for (let i = room.orbs.length - 1; i >= 0; i--) {
      const orb = room.orbs[i];
      if (dist2(p, orb) < 115 ** 2) collectOrb(room, p, i, now, .65);
    }
  }
  broadcast(room, { type: 'event', kind: 'pulse', id: p.id, x: p.x, y: p.y, color: p.color, hits });
}
function useDash(room, p, now) {
  if (room.phase !== 'playing' || p.dashCd > now || p.stunUntil > now) return;
  const n = Math.hypot(p.intent.x, p.intent.y);
  const x = n > .1 ? p.intent.x / n : Math.cos(p.angle);
  const y = n > .1 ? p.intent.y / n : Math.sin(p.angle);
  p.dashX = x;
  p.dashY = y;
  p.dashCd = now + 4600;
  p.dashUntil = now + 250;
  p.shieldUntil = Math.max(p.shieldUntil, now + 410);
  broadcast(room, { type: 'event', kind: 'dash', id: p.id, x: p.x, y: p.y, color: p.color });
}
function onMessage(client, m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'join') return joinRoom(client, m);
  if (!client.player || !client.room) return;
  const p = client.player;
  if (m.type === 'input') {
    const x = Number(m.x) || 0;
    const y = Number(m.y) || 0;
    p.intent.x = clamp(x, -1, 1);
    p.intent.y = clamp(y, -1, 1);
  } else if (m.type === 'pulse') usePulse(client.room, p, Date.now());
  else if (m.type === 'dash') useDash(client.room, p, Date.now());
}
function collectOrb(room, p, i, now, scale = 1) {
  const orb = room.orbs[i];
  if (!orb) return;
  const base = orb.type === 'legend' ? 75 : orb.type === 'rare' ? 32 : 12;
  p.combo = p.comboUntil > now ? Math.min(12, p.combo + 1) : 1;
  p.comboUntil = now + 3200;
  const awarded = Math.round(base * scale * (1 + Math.min(p.combo - 1, 10) * .13));
  p.score += awarded;
  p.pickups++;
  room.orbs.splice(i, 1);
  if (!p.bot) send([...room.clients].find(c => c.player?.id === p.id), {
    type: 'event', kind: 'pickup', x: orb.x, y: orb.y, orb: orb.type,
    value: awarded, combo: p.combo
  });
}
function powerUp(room, p, i, now) {
  const power = room.powerups[i];
  if (power.type === 'shield') p.shieldUntil = now + 8000;
  else if (power.type === 'speed') p.speedUntil = now + 8500;
  else p.magnetUntil = now + 8500;
  room.powerups.splice(i, 1);
  if (!p.bot) {
    send([...room.clients].find(c => c.player?.id === p.id), { type: 'event', kind: 'powerup', power: power.type, x: p.x, y: p.y });
    broadcast(room, { type: 'feed', text: `${p.name} consiguió ${power.type.toUpperCase()}`, color: p.color });
  }
}
function movePlayer(p, dt, now) {
  let x = p.intent.x, y = p.intent.y;
  const n = Math.hypot(x, y);
  if (n > 1) { x /= n; y /= n; }
  if (n > .08) p.angle = Math.atan2(y, x);
  const speed = (p.bot ? 244 : 298) * (p.speedUntil > now ? 1.45 : 1) * (p.stunUntil > now ? .23 : 1);
  let vx = x * speed, vy = y * speed;
  if (p.dashUntil > now) { vx += p.dashX * 965; vy += p.dashY * 965; }
  p.x = clamp(p.x + vx * dt, PLAYER_R + 6, WIDTH - PLAYER_R - 6);
  p.y = clamp(p.y + vy * dt, PLAYER_R + 6, HEIGHT - PLAYER_R - 6);
  for (const o of OBSTACLES) {
    const deltaX = p.x - o.x, deltaY = p.y - o.y;
    const d = Math.hypot(deltaX, deltaY);
    const min = o.r + PLAYER_R + 8;
    if (d < min) {
      const nx = d > .001 ? deltaX / d : 1;
      const ny = d > .001 ? deltaY / d : 0;
      p.x = o.x + nx * min;
      p.y = o.y + ny * min;
    }
  }
}
function botLogic(room, p, now) {
  if (room.phase !== 'playing') { p.intent.x = 0; p.intent.y = 0; return; }
  if (p.botThink < now) {
    p.botThink = now + rand(450, 1100);
    let best = null, bestD = Infinity;
    for (const orb of room.orbs) {
      const d = dist2(p, orb) * (orb.type === 'legend' ? .45 : orb.type === 'rare' ? .74 : 1);
      if (d < bestD) { bestD = d; best = orb; }
    }
    p.botTarget = best ? best.id : null;
  }
  let target = room.orbs.find(o => o.id === p.botTarget);
  if (!target) target = room.orbs[0];
  if (target) {
    let dx = target.x - p.x, dy = target.y - p.y;
    for (const o of OBSTACLES) {
      const ox = p.x - o.x, oy = p.y - o.y;
      const distance = Math.hypot(ox, oy);
      if (distance < o.r + 145 && distance > 0) {
        const strength = (o.r + 145 - distance) * 2.7;
        dx += ox / distance * strength;
        dy += oy / distance * strength;
      }
    }
    const length = Math.hypot(dx, dy) || 1;
    p.intent.x = dx / length;
    p.intent.y = dy / length;
    if (bestDodge(p, target) && p.dashCd < now && Math.random() < .004) useDash(room, p, now);
  }
  if (p.pulseCd < now && Math.random() < .08) {
    for (const opponent of room.players.values()) {
      if (opponent.id !== p.id && dist2(p, opponent) < 160 ** 2 && opponent.shieldUntil < now) {
        usePulse(room, p, now);
        break;
      }
    }
  }
}
function bestDodge(p, t) { return dist2(p, t) > 310 ** 2; }
function finishRound(room, now) {
  room.phase = 'results';
  room.endsAt = now + RESULTS_MS;
  const standings = [...room.players.values()].sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score, bot: p.bot, color: p.color, pickups: p.pickups, hits: p.hits }));
  let updated = false;
  for (const p of room.players.values()) {
    if (p.bot || p.score <= 0) continue;
    const existing = topScores.find(e => e.name.toLowerCase() === p.name.toLowerCase());
    if (!existing || p.score > existing.score) {
      topScores = topScores.filter(e => e.name.toLowerCase() !== p.name.toLowerCase());
      topScores.push({ name: p.name, score: p.score, date: new Date().toISOString().slice(0, 10) });
      updated = true;
    }
  }
  if (updated) {
    topScores.sort((a, b) => b.score - a.score);
    topScores = topScores.slice(0, 20);
    try { fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(topScores, null, 2)); }
    catch (err) { console.warn('No se pudo guardar leaderboard.json:', err.message); }
  }
  broadcast(room, { type: 'round_end', standings, topScores, nextIn: RESULTS_MS / 1000 });
}
function stepRoom(room, now, dt) {
  if (now >= room.endsAt) {
    if (room.phase === 'playing') finishRound(room, now);
    else newRound(room);
  }
  if (room.phase !== 'playing') return;
  for (const p of room.players.values()) {
    if (p.bot) botLogic(room, p, now);
    movePlayer(p, dt, now);
    if (p.comboUntil < now) p.combo = 0;
    const range = p.magnetUntil > now ? 87 : 34;
    for (let i = room.orbs.length - 1; i >= 0; i--) {
      if (dist2(p, room.orbs[i]) < range ** 2) collectOrb(room, p, i, now);
    }
    for (let i = room.powerups.length - 1; i >= 0; i--) {
      if (dist2(p, room.powerups[i]) < 43 ** 2) powerUp(room, p, i, now);
    }
  }
  room.spawnCredit += dt * 2.2;
  while (room.orbs.length < 115 && room.spawnCredit >= 1) {
    spawnOrb(room);
    room.spawnCredit--;
  }
  if (now - room.lastPower > 14500 && room.powerups.length < 5) {
    spawnPowerup(room);
    room.lastPower = now;
  }
}
function serialize(room, now) {
  const players = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, bot: p.bot, color: p.color,
    x: Math.round(p.x), y: Math.round(p.y), angle: +p.angle.toFixed(2),
    score: p.score, combo: p.combo, pickups: p.pickups, hits: p.hits,
    shield: p.shieldUntil > now, speed: p.speedUntil > now,
    magnet: p.magnetUntil > now, stunned: p.stunUntil > now,
    dashing: p.dashUntil > now,
    pulseReadyIn: Math.max(0, Math.ceil((p.pulseCd - now) / 100) / 10),
    dashReadyIn: Math.max(0, Math.ceil((p.dashCd - now) / 100) / 10)
  }));
  return {
    type: 'state', room: room.code, round: room.round, phase: room.phase,
    timeLeft: Math.max(0, Math.ceil((room.endsAt - now) / 1000)),
    players, orbs: room.orbs, powerups: room.powerups,
    humans: room.clients.size
  };
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let parsed;
  try { parsed = new URL(req.url, 'http://localhost'); }
  catch (_) { res.writeHead(400); res.end(); return; }
  const pathname = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const file = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
});
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13' || !req.headers['sec-websocket-key']) {
    socket.destroy(); return;
  }
  const origin = req.headers.origin;
  // Same-origin browser connections. Permits normal localhost, LAN and hosted deployments.
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host !== req.headers.host) { socket.destroy(); return; }
    } catch (_) { socket.destroy(); return; }
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const client = makeSocket(socket);
  if (head.length) socket.emit('data', head);
  setTimeout(() => { if (client.alive && !client.room) client.close(); }, 15000).unref();
});
let previous = Date.now();
let snapshots = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - previous) / 1000, .065);
  previous = now;
  const shouldBroadcast = ++snapshots % 2 === 0;
  for (const room of rooms.values()) {
    stepRoom(room, now, dt);
    if (shouldBroadcast) broadcast(room, serialize(room, now));
  }
}, 33);
server.listen(PORT, HOST, () => {
  console.log('\n  ⚡ PULSE ARENA listo');
  console.log(`  ➜ Abre http://localhost:${PORT}`);
  console.log('  ➜ Comparte la dirección IP local de tu equipo para jugar por LAN');
  console.log('  ➜ Ctrl+C para detener el servidor\n');
});
