'use strict';
// MOON MAYHEM - a room: lobby, crew roles, bots and the running game.
const { LAYOUT, STATIONS } = require('./layout');
const { Game } = require('./sim');

const LAYOUT_JSON = JSON.stringify(LAYOUT);
const BOT_NAMES = ['Bob', 'Zorp', 'Mochi', 'Nugget', 'Pixel', 'Waffles', 'Captain Cheese', 'Blip', 'Gizmo', 'Turnip'];
const BOT_ROLE_ORDER = ['eng', 'sys', 'nav', 'pilot'];
const TICK_MS = 50;

class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.members = new Map();            // pid -> member {id, name, client, bot, role, ready, color}
    this.nextId = 1;
    this.cfg = { crew: 3, diff: 1, help: 2 };
    this.state = 'lobby';
    this.game = null;
    this.hostId = 0;
    this.timer = null;
    this.last = 0;
    this.tickN = 0;
    this.emptyTimer = null;
    this.created = Date.now();
  }

  humans() { let n = 0; for (const m of this.members.values()) if (!m.bot && m.client) n++; return n; }
  send(m, obj) { if (m.client) m.client.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  broadcast(obj) { const s = typeof obj === 'string' ? obj : JSON.stringify(obj); for (const m of this.members.values()) if (m.client) m.client.send(s); }

  // ------------------------------------------------------------------ membership
  join(client, name) {
    if (this.emptyTimer) { clearTimeout(this.emptyTimer); this.emptyTimer = null; }
    name = String(name || 'Astro').replace(/[^\w \-.!?]/g, '').slice(0, 14) || 'Astro';
    if (this.state === 'play') {
      // take over a bot
      for (const m of this.members.values()) {
        if (m.bot) {
          m.bot = false; m.client = client; m.name = name;
          client.room = this; client.mid = m.id;
          const p = this.game.players.get(m.id);
          if (p) { p.bot = false; p.name = name; p.ai = null; }
          this.send(m, { t: 'joined', code: this.code, you: m.id, host: m.id === this.hostId });
          this.sendStart(m);
          this.broadcastRoster();
          this.game.say('CREW', name + ' joined and took over from ' + (m.oldBot || 'a bot') + '!');
          return m;
        }
      }
      client.send(JSON.stringify({ t: 'err', m: 'This game is full and already flying. Try again later.' }));
      return null;
    }
    const humans = [...this.members.values()].filter((m) => !m.bot).length;
    if (humans >= 4) { client.send(JSON.stringify({ t: 'err', m: 'This room is full (4 players).' })); return null; }
    const id = this.nextId++;
    const m = { id, name, client, bot: false, role: 'any', ready: false, color: id % 6 };
    this.members.set(id, m);
    client.room = this; client.mid = id;
    if (!this.hostId || !this.members.get(this.hostId)) this.hostId = id;
    this.send(m, { t: 'joined', code: this.code, you: id, host: id === this.hostId });
    this.broadcastLobby();
    return m;
  }

  leave(client) {
    const m = this.members.get(client.mid);
    if (!m) return;
    client.room = null;
    if (this.state === 'play') {
      m.client = null; m.bot = true; m.oldBot = m.name; m.name = BOT_NAMES[(m.id + 3) % BOT_NAMES.length];
      const p = this.game.players.get(m.id);
      if (p) { p.bot = true; p.name = m.name; p.ai = null; p.using = ''; }
      this.game.say('CREW', m.oldBot + ' left. ' + m.name + ' the bot takes over!');
      if (this.hostId === m.id) this.pickHost();
      this.broadcastRoster();
    } else {
      this.members.delete(m.id);
      if (this.hostId === m.id) this.pickHost();
      this.broadcastLobby();
    }
    if (this.humans() === 0) {
      this.emptyTimer = setTimeout(() => this.destroy(), 8000);
    }
  }

  pickHost() {
    this.hostId = 0;
    for (const m of this.members.values()) if (!m.bot && m.client) { this.hostId = m.id; break; }
    this.broadcast({ t: 'host', id: this.hostId });
  }

  destroy() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.game = null;
    for (const m of this.members.values()) if (m.client) { m.client.room = null; }
    this.members.clear();
    if (this.onEmpty) this.onEmpty(this);
  }

  // ------------------------------------------------------------------ lobby
  lobbyMsg() {
    return {
      t: 'lobby', code: this.code, host: this.hostId, cfg: this.cfg, state: this.state,
      players: [...this.members.values()].map((m) => ({ id: m.id, name: m.name, bot: m.bot, role: m.role, ready: m.ready, color: m.color })),
    };
  }
  broadcastLobby() { this.broadcast(this.lobbyMsg()); }

  setCfg(client, msg) {
    if (client.mid !== this.hostId || this.state !== 'lobby') return;
    if (msg.crew !== undefined) this.cfg.crew = Math.max(1, Math.min(4, msg.crew | 0));
    if (msg.diff !== undefined) this.cfg.diff = Math.max(0, Math.min(2, msg.diff | 0));
    if (msg.help !== undefined) this.cfg.help = Math.max(0, Math.min(2, msg.help | 0));
    this.broadcastLobby();
  }
  setRole(client, msg) {
    const m = this.members.get(client.mid);
    if (!m || this.state !== 'lobby') return;
    const r = String(msg.r || 'any');
    m.role = STATIONS.includes(r) ? r : 'any';
    this.broadcastLobby();
  }
  setReady(client, msg) {
    const m = this.members.get(client.mid);
    if (!m || this.state !== 'lobby') return;
    m.ready = !!msg.v;
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------ game
  start(client) {
    if (client.mid !== this.hostId || this.state !== 'lobby') return;
    const humans = [...this.members.values()].filter((m) => !m.bot && m.client);
    // remove old bots
    for (const [id, m] of [...this.members]) if (m.bot) this.members.delete(id);
    // assign roles: preferences first
    const taken = new Set();
    for (const m of humans) if (m.role !== 'any' && !taken.has(m.role)) taken.add(m.role); else if (m.role !== 'any') m.role = 'any';
    const order = ['pilot', 'eng', 'nav', 'sys'];
    for (const m of humans) if (m.role === 'any') { const r = order.find((x) => !taken.has(x)); m.role = r || order[(m.id) % 4]; taken.add(m.role); }
    const crew = Math.max(humans.length, this.cfg.crew);
    const g = new Game({ diff: this.cfg.diff, help: this.cfg.help });
    for (const m of humans) g.addPlayer({ id: m.id, name: m.name, bot: false, role: m.role, color: m.color });
    let botN = 0;
    for (const role of BOT_ROLE_ORDER) {
      if (this.members.size >= crew) break;
      if (taken.has(role)) continue;
      const id = this.nextId++;
      const name = BOT_NAMES[(id + botN++) % BOT_NAMES.length];
      const m = { id, name, client: null, bot: true, role, ready: true, color: id % 6 };
      this.members.set(id, m);
      g.addPlayer({ id, name, bot: true, role, color: m.color });
      taken.add(role);
    }
    // if there are still free seats (crew > roles available) add generic bots without clashing roles
    this.game = g;
    this.state = 'play';
    this.last = Date.now(); this.tickN = 0;
    for (const m of this.members.values()) if (m.client) this.sendStart(m);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  roster() { return [...this.members.values()].map((m) => ({ id: m.id, name: m.name, bot: m.bot, role: m.role, color: m.color })); }
  sendStart(m) {
    const msg = '{"t":"start","you":' + m.id + ',"diff":' + this.cfg.diff + ',"help":' + this.cfg.help + ',"players":' + JSON.stringify(this.roster()) + ',"layout":' + LAYOUT_JSON + '}';
    this.send(m, msg);
  }
  broadcastRoster() { this.broadcast({ t: 'roster', players: this.roster(), host: this.hostId }); }

  tick() {
    const g = this.game;
    if (!g) return;
    const now = Date.now();
    let dt = (now - this.last) / 1000; this.last = now;
    let steps = 0;
    while (dt > 0.001 && steps < 4) { const d = Math.min(dt, 0.05); g.update(d); dt -= d; steps++; }
    this.tickN++;
    if (this.tickN % 2 === 0) {
      const snap = JSON.stringify(g.snapshot());
      for (const m of this.members.values()) if (m.client) m.client.send(snap);
    }
  }

  restart(client) {
    if (client.mid !== this.hostId || this.state !== 'play') return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.game = null; this.state = 'lobby';
    for (const [id, m] of [...this.members]) if (m.bot) this.members.delete(id);
    for (const m of this.members.values()) m.ready = false;
    this.broadcastLobby();
  }

  // ------------------------------------------------------------------ in-game messages
  onGame(client, msg) {
    const g = this.game;
    if (!g || this.state !== 'play') return;
    const id = client.mid;
    switch (msg.t) {
      case 'p': g.playerState(id, msg); break;
      case 'in': g.input(id, msg); break;
      case 'use': g.use(id, msg); break;
      case 'tool': g.tool(id, msg); break;
      case 'chat': g.chat(id, msg.m); break;
      case 'emote': g.emote(id, msg.e); break;
      default: break;
    }
  }
}

module.exports = { Room };
