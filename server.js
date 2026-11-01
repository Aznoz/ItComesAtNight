// "It comes at night" - room relay server (Render / any Node host)
//
// The game itself is host-authoritative: one player (the room creator, id 0) runs
// the simulation. This server only creates rooms and relays messages:
//   client -> server : create / join / msg / lock / ping
//   host   -> server : msg { to: -1 (everybody) | id }
//   client -> server : msg { d }  (always delivered to the host only)
//
// Wire format: JSON text frames.

const http = require('http');
const { WebSocketServer } = require('./wsmini'); // dependency-free WebSocket implementation

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 4;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_MSGS_PER_SEC = 400;

/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  constructor(code, hostWs, hostName) {
    this.code = code;
    this.locked = false;
    this.created = Date.now();
    this.members = new Map(); // id -> { ws, name }
    this.members.set(0, { ws: hostWs, name: hostName });
  }
  get host() { return this.members.get(0); }
  freeId() {
    for (let i = 1; i < MAX_PLAYERS; i++) if (!this.members.has(i)) return i;
    return -1;
  }
  peerList() {
    const list = [];
    for (const [id, m] of this.members) list.push({ id, name: m.name });
    return list;
  }
}

function makeCode() {
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }
}

function cleanName(n) {
  n = String(n || 'Player').replace(/[^\p{L}\p{N} _\-\.]/gu, '').trim();
  if (!n) n = 'Player';
  return n.slice(0, 16);
}

const server = http.createServer((req, res) => {
  if (req.url === '/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('It comes at night - server OK\n');
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.pid = -1;
  ws.msgCount = 0;
  ws.msgWindow = Date.now();

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    // simple flood protection
    const now = Date.now();
    if (now - ws.msgWindow > 1000) { ws.msgWindow = now; ws.msgCount = 0; }
    if (++ws.msgCount > MAX_MSGS_PER_SEC) return;

    let m;
    try { m = JSON.parse(data.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'ping':
        send(ws, { t: 'pong' });
        break;

      case 'create': {
        if (ws.roomCode) return;
        const code = makeCode();
        if (!code) { send(ws, { t: 'err', m: 'Server is full, try again later.' }); return; }
        const room = new Room(code, ws, cleanName(m.name));
        rooms.set(code, room);
        ws.roomCode = code;
        ws.pid = 0;
        send(ws, { t: 'created', room: code, id: 0 });
        break;
      }

      case 'join': {
        if (ws.roomCode) return;
        const code = String(m.room || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) { send(ws, { t: 'err', m: 'Room ' + code + ' does not exist.' }); return; }
        if (room.locked) { send(ws, { t: 'err', m: 'The game has already started.' }); return; }
        const id = room.freeId();
        if (id < 0) { send(ws, { t: 'err', m: 'Room is full (4/4).' }); return; }
        const name = cleanName(m.name);
        room.members.set(id, { ws, name });
        ws.roomCode = code;
        ws.pid = id;
        send(ws, { t: 'joined', room: code, id, peers: room.peerList() });
        send(room.host.ws, { t: 'peer+', id, name });
        // let the other clients know too
        for (const [pid, mem] of room.members) {
          if (pid !== 0 && pid !== id) send(mem.ws, { t: 'peer+', id, name });
        }
        break;
      }

      case 'lock': {
        const room = rooms.get(ws.roomCode);
        if (room && ws.pid === 0) room.locked = !!m.v;
        break;
      }

      case 'msg': {
        const room = rooms.get(ws.roomCode);
        if (!room || typeof m.d !== 'string') return;
        if (ws.pid === 0) {
          // host -> clients
          const out = { t: 'msg', from: 0, d: m.d };
          if (m.to === -1 || m.to === undefined) {
            for (const [pid, mem] of room.members) if (pid !== 0) send(mem.ws, out);
          } else {
            const mem = room.members.get(m.to);
            if (mem) send(mem.ws, out);
          }
        } else {
          // client -> host
          send(room.host.ws, { t: 'msg', from: ws.pid, d: m.d });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (ws.pid === 0) {
      for (const [pid, mem] of room.members) if (pid !== 0) { send(mem.ws, { t: 'closed' }); }
      rooms.delete(room.code);
    } else {
      room.members.delete(ws.pid);
      send(room.host.ws, { t: 'peer-', id: ws.pid });
      for (const [pid, mem] of room.members) if (pid !== 0) send(mem.ws, { t: 'peer-', id: ws.pid });
    }
  });

  ws.on('error', () => { /* handled by close */ });
});

// Drop dead sockets (also keeps Render's proxy from idling the connection out)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 25000);

// Remove abandoned rooms older than 6 hours
setInterval(() => {
  const limit = Date.now() - 6 * 3600 * 1000;
  for (const [code, room] of rooms) {
    if (room.created < limit) {
      for (const [, mem] of room.members) { try { mem.ws.close(); } catch (e) { /* ignore */ } }
      rooms.delete(code);
    }
  }
}, 600000);

server.listen(PORT, () => console.log('It comes at night server listening on ' + PORT));
