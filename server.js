'use strict';
// MOON MAYHEM server: serves a tiny status page and WebSocket game rooms (see README.txt).
const http = require('http');
const { attach } = require('./ws');
const { Room } = require('./room');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const rooms = new Map();
let clientsTotal = 0;

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function onConnection(ws) {
  const client = { ws, room: null, mid: 0, name: 'Astro', msgs: 0, t0: Date.now(), send(s) { ws.send(s); } };
  clientsTotal++;
  ws.onclose = () => { if (client.room) client.room.leave(client); };
  ws.onmessage = (text) => {
    if (text.length > 8192) return;
    const now = Date.now();
    if (now - client.t0 > 1000) { client.t0 = now; client.msgs = 0; }
    if (++client.msgs > 300) return;                      // flood protection
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    handle(client, msg);
  };
  ws.send(JSON.stringify({ t: 'hi', v: 1 }));
}

function handle(c, m) {
  switch (m.t) {
    case 'ping': c.send(JSON.stringify({ t: 'pong', ts: m.ts })); return;
    case 'create': {
      if (c.room) return;
      const code = makeCode();
      if (!code) { c.send(JSON.stringify({ t: 'err', m: 'Server is busy, try again.' })); return; }
      if (rooms.size > 200) { c.send(JSON.stringify({ t: 'err', m: 'Server is busy, try again.' })); return; }
      const room = new Room(code, (r) => rooms.delete(r.code));
      rooms.set(code, room);
      if (m.crew !== undefined) room.cfg.crew = Math.max(1, Math.min(4, m.crew | 0));
      if (m.diff !== undefined) room.cfg.diff = Math.max(0, Math.min(2, m.diff | 0));
      room.join(c, m.name);
      if (m.solo) { room.start(c); }
      return;
    }
    case 'join': {
      if (c.room) return;
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) { c.send(JSON.stringify({ t: 'err', m: 'No room with that code.' })); return; }
      room.join(c, m.name);
      return;
    }
    default: break;
  }
  const room = c.room;
  if (!room) return;
  switch (m.t) {
    case 'cfg': room.setCfg(c, m); break;
    case 'role': room.setRole(c, m); break;
    case 'ready': room.setReady(c, m); break;
    case 'start': room.start(c); break;
    case 'restart': room.restart(c); break;
    case 'leave': room.leave(c); break;
    default: room.onGame(c, m); break;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  let playing = 0; for (const r of rooms.values()) if (r.state === 'play') playing++;
  res.end('<!doctype html><title>Moon Mayhem</title><body style="font-family:sans-serif;background:#2a1d45;color:#ffd23f;text-align:center;padding:60px">' +
    '<h1>MOON MAYHEM server</h1><p>The rocket is fuelled. Open the game and connect to this address.</p>' +
    '<p style="color:#fff8ee">rooms: ' + rooms.size + ' &middot; flying: ' + playing + ' &middot; connections served: ' + clientsTotal + '</p></body>');
});
attach(server, onConnection);
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log('Moon Mayhem server listening on :' + PORT));
}
module.exports = { server, rooms };
