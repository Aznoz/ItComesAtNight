'use strict';
// MOON MAYHEM - authoritative simulation of one rocket. No networking in here: rooms feed it inputs and read snapshots.
const { LAYOUT } = require('./layout');
const { Director, TOTAL } = require('./director');
const { BotBrain } = require('./bots');

const CTL = {};
LAYOUT.controls.forEach((c) => { CTL[c.id] = c; });
const BREAKERS = ['br_radar', 'br_shield', 'br_lights', 'br_engine', 'br_comms', 'br_autop'];
const LAT = 9;                // lateral limit of the flight tunnel

// difficulty: 0 easy, 1 normal, 2 chaos
const DIFF = [
  { name: 'Easy', inc: [26, 40], wind: 0.65, dmg: 0.7, drain: 0.7, gap: 1.3, heat: 0.8, skill: 0.9, fuel: 1.15 },
  { name: 'Normal', inc: [17, 28], wind: 1.0, dmg: 1.0, drain: 1.0, gap: 1.0, heat: 1.0, skill: 0.78, fuel: 1.0 },
  { name: 'Chaos', inc: [10, 18], wind: 1.5, dmg: 1.35, drain: 1.3, gap: 0.8, heat: 1.2, skill: 0.62, fuel: 0.9 },
];

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

class Game {
  constructor(o) {
    o = o || {};
    this.diff = clamp(o.diff | 0, 0, 2);
    this.D = DIFF[this.diff];
    this.help = o.help === undefined ? 2 : clamp(o.help | 0, 0, 2);
    this.rand = mulberry(o.seed === undefined ? (Date.now() & 0x7fffffff) : o.seed);
    this.players = new Map();
    this.t = 0; this.pt = 0; this.phase = 'pre';
    this.events = [];
    this.timers = [];
    this.seq = 0;
    this.nextOb = 1;
    this.obs = [];
    this.fires = [];
    this.holes = [];
    this.tools = {};
    LAYOUT.tools.forEach((t) => { this.tools[t.id] = { holder: 0 }; });
    this.c = {};
    LAYOUT.controls.forEach((def) => {
      const s = { v: 0, x: 0, y: 0, g: 0, gt: 0, jam: 0, ang: 0, who: 0, hold: 0 };
      if (def.id.startsWith('br_') || def.id === 'o2gen') s.v = 1;
      if (def.id === 'course') s.v = 0.5;
      this.c[def.id] = s;
    });
    // pre-tripped breakers: two of them are off at the start
    const off = this.pickN(BREAKERS, this.diff === 0 ? 1 : 2);
    off.forEach((id) => { this.c[id].v = 0; });
    this.ship = {
      alt: 0, trav: 0, spd: 0, h: 0, vs: 0, tx: 0, ty: 0, wx: 0, wy: 0, sx: 0, sy: 0, hd: 0, drift: 0, driftT: 0, driftTarget: 0,
      thr: 0, tmp: 22, fa: 55 * this.D.fuel, fb: 55 * this.D.fuel, bo: 100, staged: false, pr: 0, bat: 62, air: 100, hull: 100,
      eng: 0, engStart: 0, engWhy: '', slime: 0, dark: false, shake: 0, coins: 0, morale: 0, lowg: 0, flareT: 0, flare: 0, stun: 0,
      cd: 0, turbo: false, boEmpty: 0, gustT: 5, wideT: 0, maxq: false, sputter: false, cold: false, legs: false, bags: false,
      miss: 0, tumble: 0, lowT: 0, gl: 0, landed: false,
    };
    this.chk = [];
    this.needs = [];
    this.needT = 0;
    this.board = { title: '', sub: '', items: [] };
    this.scr = { pilot: [], eng: [], nav: [], sys: [] };
    this.end = null;
    this.stats = { honks: 0, coinsTotal: 0, cows: 0, hits: 0 };
    this.dir = new Director(this);
    this.bots = new BotBrain(this);
    this.dir.start();
    this.say('MISSION CONTROL', 'Welcome aboard the Banana One! Please do not touch anything you do not understand. (You will.)');
  }

  // ------------------------------------------------------------------ helpers
  rnd() { return this.rand(); }
  rr(a, b) { return a + (b - a) * this.rand(); }
  ri(a, b) { return Math.floor(this.rr(a, b + 1)); }
  randn() { const u = Math.max(1e-9, this.rand()), v = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }
  pickN(arr, n) { const a = arr.slice(); const out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(this.rand() * a.length), 1)[0]); return out; }
  ev(e, o) { const x = { e }; if (o) Object.assign(x, o); this.events.push(x); if (this.events.length > 200) this.events.shift(); }
  say(from, text) { this.ev('say', { f: from, t: text }); }
  idx(id) { const d = CTL[id], s = this.c[id]; return Math.round(s.v * ((d.n || 2) - 1)); }
  on(id) { return this.c[id].v >= 0.5; }
  breaker(name) { return this.c['br_' + name].v >= 0.5; }
  power() { return this.ship.bat > 0.5; }
  later(sec, fn) { this.timers.push({ t: this.t + sec, fn }); }

  // ------------------------------------------------------------------ players
  addPlayer(p) {
    const sp = LAYOUT.spawns[(this.players.size) % LAYOUT.spawns.length];
    const pl = {
      id: p.id, name: p.name || 'Astro', bot: !!p.bot, role: p.role || 'any', x: sp[0], y: 0, z: sp[1], r: sp[2], anim: 0, using: '', carry: '', zone: 0,
      useK: '', useI: '', useT: 0, hitCd: 0, lastSeen: this.t, color: p.color === undefined ? this.players.size : p.color,
      stats: { honks: 0, fires: 0, leaks: 0, breakers: 0, cranks: 0, pumps: 0, hits: 0, steps: 0, chats: 0, duck: 0, coffee: 0, disco: 0, cows: 0 },
      lastX: sp[0], lastZ: sp[1],
    };
    this.players.set(p.id, pl);
    return pl;
  }
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.carry && this.tools[p.carry]) this.tools[p.carry].holder = 0;
    for (const k in this.c) if (this.c[k].who === id) { this.c[k].who = 0; if (CTL[k].k === 'btn') this.c[k].v = 0; }
    this.players.delete(id);
  }
  humans() { let n = 0; for (const p of this.players.values()) if (!p.bot) n++; return n; }

  playerState(id, m) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    const hx = LAYOUT.room.hx + 40, hz = LAYOUT.room.hz + 40;
    if (typeof m.x === 'number' && typeof m.z === 'number') {
      p.x = clamp(m.x, -hx, hx); p.z = clamp(m.z, -hz, hz);
      p.y = typeof m.y === 'number' ? clamp(m.y, -2, 30) : 0;
      p.r = typeof m.r === 'number' ? m.r : p.r;
      p.anim = m.a | 0;
      p.using = typeof m.u === 'string' ? m.u.slice(0, 16) : '';
      p.zone = m.zn | 0;
      const dx = p.x - p.lastX, dz = p.z - p.lastZ;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 3) p.stats.steps += d;
      p.lastX = p.x; p.lastZ = p.z;
    }
  }

  // ------------------------------------------------------------------ control input
  reach(p, def) {
    if (p.bot) return true;
    if (p.zone !== 0) return false;
    const dx = p.x - def.p[0], dz = p.z - def.p[2];
    return dx * dx + dz * dz < 6.5 * 6.5;
  }
  input(pid, m) {
    const p = this.players.get(pid);
    const def = CTL[m.id];
    if (!p || !def || this.phase === 'fail' || this.phase === 'moon') return false;
    if (!this.reach(p, def)) return false;
    const s = this.c[def.id];
    s.who = pid;
    if (!p.bot) s.humanT = this.t;
    if (m.g !== undefined && def.guard) {
      s.g = m.g ? 1 : 0; s.gt = s.g ? 9 : 0;
      this.ev('guard', { id: def.id, g: s.g });
      return true;
    }
    if (s.jam > 0 && def.k !== 'btn' && def.id !== 'launch') { this.ev('jammed', { id: def.id, p: pid }); return false; }
    switch (def.k) {
      case 'btn': {
        const v = m.v ? 1 : 0;
        if (def.guard && !s.g && v) { return false; }
        if (v && !s.v) { s.hold = 0; this.onPress(def.id, p); }
        if (!v && s.v) this.onRelease(def.id, p);
        s.v = v;
        if (v && def.guard) s.gt = 9;
        break;
      }
      case 'sw': {
        const n = def.n || 2;
        let v = Math.round(Number(m.v));
        if (!(v >= 0)) v = 0;
        v = clamp(v, 0, n - 1) / (n - 1);
        if (v !== s.v) { const old = s.v; s.v = v; this.onSwitch(def.id, p, old); }
        break;
      }
      case 'lev': case 'knob': {
        let v = clamp(Number(m.v) || 0, 0, 1);
        if (def.k === 'knob' && def.n > 0) v = Math.round(v * (def.n - 1)) / (def.n - 1);
        if (def.id === 'pump') { const dv = Math.abs(v - s.v); this.pumpTravel(dv, p); }
        if (def.id === 'valve' || def.id === 'range' || def.id === 'course' || def.id === 'radio') { if (v !== s.v) this.ev('click', { id: def.id }); }
        s.v = v;
        break;
      }
      case 'stick': s.x = clamp(Number(m.x) || 0, -1, 1); s.y = clamp(Number(m.y) || 0, -1, 1); break;
      case 'crank': {
        const d = clamp(Number(m.d) || 0, -0.5, 0.5);
        s.ang = ((s.ang + d) % 1 + 1) % 1;
        if (d !== 0) this.crankTurn(Math.abs(d), p);
        break;
      }
      default: return false;
    }
    return true;
  }
  onPress(id, p) {
    if (id === 'horn') { p.stats.honks++; this.stats.honks++; this.ev('honk', { p: p.id }); this.dir.honk(); }
    else if (id === 'duck') { p.stats.duck++; this.ev('duck', { p: p.id }); this.dir.duck(); this.ship.morale = Math.min(100, this.ship.morale + 0.8); }
    else if (id === 'coffee') { p.stats.coffee++; this.ev('coffee', { p: p.id }); this.ship.morale = Math.min(100, this.ship.morale + 2.5); this.dir.callEvent('coffee'); }
    else if (id === 'center') { this.c.yoke.x = 0; this.c.yoke.y = 0; this.ev('click', { id }); }
    else if (id === 'stage') this.stage(p);
    else if (id === 'airbag') { this.ship.bags = true; this.ev('bags', { p: p.id }); }
    else if (id.startsWith('kp_')) this.dir.keypad(id.slice(3), p);
    else if (id === 'hatch') this.hatch(p);
    else this.ev('click', { id });
  }
  onRelease(id, p) { if (id === 'start') { this.ship.engStart = 0; } }
  onSwitch(id, p, old) {
    const v = this.c[id].v;
    this.ev('sw', { id, v, p: p.id });
    if (id === 'launch') this.dir.launch(p);
    else if (id === 'disco') { p.stats.disco++; if (v >= 0.5) this.dir.callEvent('disco'); }
    else if (id === 'legs') { this.ship.legsT = 0; }
    else if (id === 'handset') this.dir.handset(v >= 0.5, p);
    else if (id.startsWith('br_') && v >= 0.5 && old < 0.5) { p.stats.breakers++; this.dir.breakerFixed(id); }
  }
  pumpTravel(dv, p) {
    if (dv <= 0) return;
    this.ship.pr = Math.min(100, this.ship.pr + dv * 9);
    p.stats.pumps += dv * 0.5;
  }
  crankTurn(d, p) {
    this.ship.bat = Math.min(100, this.ship.bat + d * 2.6);
    p.stats.cranks += d;
  }
  stage(p) {
    const s = this.ship;
    if (this.phase === 'cruise' || this.phase === 'approach' || this.phase === 'ascent') {
      if (s.staged) { this.ev('nope', { why: 'The booster is already gone.' }); return; }
      if (s.bo > 6) { this.ev('nope', { why: 'Too early! The booster still has fuel.' }); return; }
      s.staged = true; this.ev('stage', { p: p.id });
      this.say('MISSION CONTROL', 'Booster away! Say bye-bye, little booster.');
    } else this.ev('nope', { why: 'Nothing to drop right now.' });
  }
  hatch(p) {
    if (this.phase === 'landed') { this.phase = 'moon'; this.pt = 0; this.ev('hatch', {}); this.say('MISSION CONTROL', 'The hatch is open. One small step for cheese, one giant leap for the crew!'); }
    else this.ev('nope', { why: 'The hatch only opens on the Moon!' });
  }

  chat(pid, m) { const p = this.players.get(pid); if (!p) return; p.stats.chats++; this.ev('chat', { p: pid, m: m | 0 }); }
  emote(pid, e) { const p = this.players.get(pid); if (!p) return; this.ev('emote', { p: pid, k: e | 0 }); }

  // ------------------------------------------------------------------ tools and incidents
  tool(pid, m) {
    const p = this.players.get(pid);
    const t = this.tools[m.id];
    if (!p || !t) return;
    if (m.a === 'take') {
      if (p.carry || t.holder) return;
      if (!p.bot && p.zone === 0) {
        const def = LAYOUT.tools.find((x) => x.id === m.id);
        const dx = p.x - def.home[0], dz = p.z - def.home[2];
        if (dx * dx + dz * dz > 7 * 7) return;
      }
      t.holder = pid; p.carry = m.id; this.ev('tool', { id: m.id, p: pid, a: 'take' });
    } else if (m.a === 'put') {
      if (t.holder !== pid) return;
      t.holder = 0; p.carry = ''; p.useK = ''; this.ev('tool', { id: m.id, p: pid, a: 'put' });
    }
  }
  use(pid, m) {
    const p = this.players.get(pid);
    if (!p) return;
    const k = m.k;
    if (k === 'fire' && p.carry === 'tool_ext') { p.useK = 'fire'; p.useI = m.i | 0; p.useT = this.t + 0.4; }
    else if (k === 'hole' && p.carry === 'tool_patch') { p.useK = 'hole'; p.useI = m.i | 0; p.useT = this.t + 0.4; }
    else if (k === 'jam' && p.carry === 'tool_hammer') {
      const s = this.c[m.i];
      if (s && s.jam > 0 && this.t - p.hitCd > 0.3) {
        p.hitCd = this.t; s.jam -= 1;
        this.ev('whack', { id: m.i, p: pid });
        if (s.jam <= 0) { s.jam = 0; this.ev('unjam', { id: m.i, p: pid }); this.say(p.name, 'Got it!'); }
      }
    }
  }
  updateTools(dt) {
    for (const p of this.players.values()) {
      if (!p.useK || this.t > p.useT) { p.useK = ''; continue; }
      if (p.useK === 'fire') {
        const f = this.fires.find((x) => x.slot === p.useI);
        if (!f || !this.near(p, LAYOUT.fireSlots[f.slot], 5)) continue;
        f.hp -= 62 * dt;
        f.by = p.id;
        if (f.hp <= 0) { p.stats.fires++; this.ev('out', { slot: f.slot, p: p.id }); this.fires = this.fires.filter((x) => x !== f); }
      } else if (p.useK === 'hole') {
        const h = this.holes.find((x) => x.slot === p.useI);
        if (!h || !this.near(p, LAYOUT.holeSlots[h.slot].p, 5)) continue;
        h.hp -= 42 * dt;
        if (h.hp <= 0) { p.stats.leaks++; this.ev('patched', { slot: h.slot, p: p.id }); this.holes = this.holes.filter((x) => x !== h); }
      }
    }
  }
  near(p, pos, r) {
    if (p.bot) return true;
    const dx = p.x - pos[0], dz = p.z - (pos[2] === undefined ? pos[1] : pos[2]);
    return dx * dx + dz * dz < r * r;
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    dt = clamp(dt, 0, 0.1);
    if (this.phase === 'fail') { this.pt += dt; return; }
    this.t += dt; this.pt += dt;
    const s = this.ship;
    this.updateControls(dt);
    this.updatePower(dt);
    this.updateEngine(dt);
    this.updateTilt(dt);
    switch (this.phase) {
      case 'pre': this.dir.updatePre(dt); break;
      case 'ascent': this.updateAscent(dt); break;
      case 'cruise': this.updateCruise(dt); break;
      case 'approach': this.updateApproach(dt); break;
      default: break;
    }
    this.dir.update(dt);
    this.updateTools(dt);
    this.updateIncidents(dt);
    s.shake = Math.max(0, s.shake - dt * 1.4);
    s.stun = Math.max(0, s.stun - dt);
    s.lowg = Math.max(0, s.lowg - dt);
    s.morale = Math.min(100, s.morale + (this.on('disco') ? 0.7 : 0) * dt);
    if (this.timers.length) { const due = this.timers.filter((x) => x.t <= this.t); if (due.length) { this.timers = this.timers.filter((x) => x.t > this.t); due.forEach((x) => { try { x.fn(); } catch (e) { /* ignore */ } }); } }
    this.bots.update(dt);
    this.needT -= dt;
    if (this.needT <= 0) { this.needT = 0.4; this.dir.computeNeeds(); }
  }

  updateControls(dt) {
    for (const id in this.c) {
      const d = CTL[id], s = this.c[id];
      if (d.guard && s.g) { s.gt -= dt; if (s.gt <= 0 && !s.v) { s.g = 0; this.ev('guard', { id, g: 0 }); } }
      if (d.k === 'btn' && s.v) s.hold += dt;
    }
    // the launch lever springs back when it did nothing
    const L = this.c.launch;
    if (L.v >= 0.5 && this.phase === 'pre' && this.ship.cd <= 0) { L.t = (L.t || 0) + dt; if (L.t > 1.2) { L.v = 0; L.t = 0; } }
    // landing legs travel (visual only, the lever itself is the state)
    this.ship.legs = this.on('legs');
  }

  updatePower(dt) {
    const s = this.ship, D = this.D;
    let drain = 0.075;
    if (this.on('shield') && this.breaker('shield')) drain += 0.42;
    if (this.on('autop') && this.breaker('autop')) drain += 0.1;
    if (this.on('lights') && this.breaker('lights')) drain += 0.04;
    if (this.on('wipers')) drain += 0.03;
    if (s.eng === 1) drain += 0.07;
    if (this.on('o2gen')) drain += 0.02;
    if (this.on('disco')) drain += 0.05;
    s.bat = clamp(s.bat - drain * D.drain * dt, 0, 100);
    if (s.bat <= 0.01 && !s.blackout) { s.blackout = true; this.ev('blackout', {}); this.say('MISSION CONTROL', 'Battery dead! Everything is dark. Somebody crank the generator!'); }
    if (s.bat > 6) s.blackout = false;
    // air
    let air = 0;
    if (this.on('o2gen') && this.power()) air += 0.5; else air -= 0.45;
    air -= this.holes.length * 1.1;
    if (this.fires.length) air -= 0.1 * this.fires.length;
    s.air = clamp(s.air + air * dt, 0, 100);
  }

  tankLevel() { return this.on('feed') ? this.ship.fb : this.ship.fa; }

  updateEngine(dt) {
    const s = this.ship, D = this.D;
    const thrCmd = this.c.throttle.v;
    const armed = this.on('master') && this.breaker('engine') && this.power();
    const turbo = this.c.turbo.v >= 0.5 && s.eng === 1;
    s.turbo = turbo;
    // starter
    const st = this.c.start;
    if (st.v >= 0.5 && s.eng !== 1) {
      s.engStart += dt;
      const ok = armed && s.pr >= 20 && this.tankLevel() > 0.5 && s.tmp < 88 && s.eng !== 2 && !(s.engWhy === 'heat' && s.tmp >= 65);
      if (!ok) { if (s.engStart > 0.5 && !s.startFail) { s.startFail = true; this.ev('startfail', {}); } }
      else if (s.engStart > 1.1) { s.eng = 1; s.engStart = 0; s.startFail = false; this.ev('engine', { on: 1 }); }
    } else { s.startFail = false; }
    if (s.eng === 1) {
      let why = '';
      if (!armed) why = 'power';
      else if (this.tankLevel() <= 0.2) why = 'fuel';
      else if (s.pr < 4) why = 'pressure';
      else if (s.tmp >= 100) why = 'heat';
      if (why) { s.eng = why === 'heat' ? 2 : 0; s.engWhy = why; this.ev('engine', { on: 0, why }); if (why === 'heat') this.dir.engineFire(); }
    }
    if (s.eng === 2 && s.tmp < 62) { s.eng = 0; }
    // thrust
    const presEff = clamp(s.pr / 40, 0, 1);
    s.cold = s.tmp < 12 && thrCmd > 0.15;
    const coldEff = s.cold ? 0.78 : 1;
    let target = 0;
    if (s.eng === 1) target = thrCmd * 100 * (turbo ? 1.45 : 1) * presEff * coldEff;
    s.sputter = s.eng === 1 && s.pr < 25;
    s.thr += (target - s.thr) * Math.min(1, dt * 2.2);
    if (s.thr < 0.05) s.thr = 0;
    // fuel
    if (s.eng === 1) {
      const burn = (thrCmd * (turbo ? 1.9 : 1) * 0.5 + 0.02) * dt;
      if (this.phase === 'ascent' && !s.staged && s.bo > 0) s.bo = Math.max(0, s.bo - burn * 4.4);
      else if (this.on('feed')) s.fb = Math.max(0, s.fb - burn);
      else s.fa = Math.max(0, s.fa - burn);
    }
    // pressure decay
    s.pr = Math.max(0, s.pr - (s.eng === 1 ? 0.8 : 0.15) * dt);
    // temperature
    const L = this.idx('valve');
    const base = s.eng === 1 ? thrCmd * 85 * (turbo ? 1.15 : 1) * D.heat + (turbo ? 22 : 0) : 0;
    const tt = 18 + base - L * 11;
    s.tmp += (clamp(tt, 4, 130) - s.tmp) * (1 - Math.exp(-dt / 7));
    s.tmp = clamp(s.tmp, 0, 140);
  }

  // tilt: the yoke sets a target angle, wind pushes against it
  updateTilt(dt) {
    const s = this.ship, D = this.D;
    const amp = (this.phase === 'ascent' ? 8 : this.phase === 'approach' ? 7 : this.phase === 'cruise' ? 3.5 : 0) * D.wind;
    s.wx += (-s.wx * 0.18 + this.randn() * amp * 0.5) * dt;
    s.wy += (-s.wy * 0.18 + this.randn() * amp * 0.5) * dt;
    s.wx = clamp(s.wx, -amp * 1.6, amp * 1.6); s.wy = clamp(s.wy, -amp * 1.6, amp * 1.6);
    s.gustT -= dt;
    if (s.gustT <= 0 && (this.phase === 'ascent' || this.phase === 'approach')) {
      s.gustT = this.rr(5, 10) / D.wind;
      s.wx += this.rr(-1, 1) * 9 * D.wind; s.wy += this.rr(-1, 1) * 9 * D.wind;
      this.ev('gust', {});
    }
    const ap = this.on('autop') && this.breaker('autop') && this.power() && this.c.autop.jam <= 0;
    let tx, ty;
    if (ap) { tx = this.c.yoke.x * 28 * 0.3 + s.wx * 0.2; ty = this.c.yoke.y * 28 * 0.3 + s.wy * 0.2; }
    else { tx = this.c.yoke.x * 28 + s.wx; ty = this.c.yoke.y * 28 + s.wy; }
    const k = 1 - Math.exp(-dt / 0.55);
    s.tx += (tx - s.tx) * k; s.ty += (ty - s.ty) * k;
    // heading drift (solar wind): the compass needle shows drift minus the course trim, the navigator turns the knob
    s.driftT -= dt;
    if (s.driftT <= 0) { s.driftT = this.rr(14, 24); s.driftTarget = this.rr(-18, 18) * D.wind; }
    s.drift += (s.driftTarget - s.drift) * (1 - Math.exp(-dt / 5));
    if (this.phase === 'cruise' || this.phase === 'approach') {
      const trim = (this.idx('course') - 4) * 5;
      s.hd += ((s.drift - trim) - s.hd) * (1 - Math.exp(-dt / 1.6));
    }
  }

  tiltMag() { const s = this.ship; return Math.sqrt(s.tx * s.tx + s.ty * s.ty); }

  // ------------------------------------------------------------------ ascent
  updateAscent(dt) {
    const s = this.ship, D = this.D;
    const tm = this.tiltMag();
    const tiltEff = tm > 10 ? clamp(1 - (tm - 10) / 36, 0.15, 1) : 1;
    let f = s.thr / 100 * tiltEff;
    const boosted = !s.staged && s.bo > 0;
    if (boosted) f *= 1.22;
    let vUp = 2.7 * f - 0.7;
    if (!s.staged && s.bo <= 0) { s.boEmpty += dt; vUp *= 0.5; if (s.boEmpty > 0.1 && !s.boWarn) { s.boWarn = true; this.ev('alarm', { k: 'booster' }); this.say('MISSION CONTROL', 'Booster is empty! Drop it! The DROP BOOSTER button on the engineer console!'); } }
    if (s.alt <= 0.05 && vUp < 0) vUp = 0;                     // still on the pad
    if (s.alt < 0.5 && f < 0.3 && this.pt > 8 && !s.heavyWarn) { s.heavyWarn = true; this.say('MISSION CONTROL', 'We are not moving. The rocket is heavy. Add throttle!'); }
    s.alt = Math.max(0, s.alt + vUp * dt);
    s.spd = Math.max(0, vUp);
    // max-Q
    s.maxq = s.alt > 24 && s.alt < 42;
    if (s.maxq && s.thr > 78) { s.shake = Math.min(1.4, s.shake + dt * 2); this.damage(2.2 * dt * D.dmg, true); if (!s.maxqWarn) { s.maxqWarn = true; this.ev('alarm', { k: 'maxq' }); } }
    if (!s.maxq) s.maxqWarn = false;
    // failures
    if (tm > 42) { s.tumble += dt; if (s.tumble > 3) this.lose('tumble'); } else s.tumble = Math.max(0, s.tumble - dt);
    if (s.alt > 6) s.wasUp = true;
    if (s.wasUp && s.alt < 1.5 && vUp < 0) this.lose('fall');
    if (s.eng !== 1 && s.alt > 6) { s.lowT += dt; if (s.lowT > 14 && vUp < -0.2) this.lose('fall'); } else s.lowT = 0;
    if (this.fuelEmpty() && s.eng !== 1 && s.alt > 1) { s.dry = (s.dry || 0) + dt; if (s.dry > 12) this.lose('fuel'); } else s.dry = 0;
    if (s.alt >= 100) { this.dir.toCruise(); }
  }
  fuelEmpty() { const s = this.ship; return s.fa <= 0.2 && s.fb <= 0.2 && (s.staged || s.bo <= 0); }

  // ------------------------------------------------------------------ cruise
  updateCruise(dt) {
    const s = this.ship, D = this.D;
    const fr = s.thr / 100;
    const hdF = Math.max(0.35, 1 - Math.abs(s.hd) / 60);
    s.spd = 2.4 * fr * hdF;
    s.trav = Math.min(TOTAL, s.trav + s.spd * dt);
    // lateral position follows the tilt
    s.sx = clamp(s.sx + s.tx * 0.3 * dt, -LAT, LAT);
    s.sy = clamp(s.sy + s.ty * 0.3 * dt, -LAT * 0.7, LAT * 0.7);
    this.moveObstacles(dt);
    if (this.fuelEmpty() && s.eng !== 1) { s.dry = (s.dry || 0) + dt; if (s.dry > 20) this.lose('fuel'); } else s.dry = 0;
    if (s.trav >= TOTAL) this.dir.arrive();
  }
  closing() { return 3.0 + this.ship.spd * 3.0; }
  moveObstacles(dt) {
    const s = this.ship;
    const cv = this.closing();
    for (const o of this.obs) {
      const oldz = o.z;
      o.z -= (cv + (o.vz || 0)) * dt;
      o.x += (o.vx || 0) * dt; o.y += (o.vy || 0) * dt;
      if (o.type === 1 && o.flee) { o.vx = o.flee * 3.2; }
      if (oldz > 0 && o.z <= 0 && !o.done) this.collide(o);
    }
    this.obs = this.obs.filter((o) => o.z > -6 && Math.abs(o.x) < 40 && !o.dead);
  }
  collide(o) {
    const s = this.ship, D = this.D;
    o.done = true;
    const dx = o.x - s.sx, dy = o.y - s.sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const reach = o.r + 1.0;
    if (d > reach) {
      if (o.type === 4 && d < reach + 3.5) { s.slime = Math.min(1, s.slime + 0.5); this.ev('splat', { x: o.x }); }
      else if (o.type === 5 && d < reach + 0.6) { /* near miss with coin: nothing */ }
      return;
    }
    if (o.type === 5) { s.coins++; this.stats.coinsTotal++; s.morale = Math.min(100, s.morale + 1.2); this.ev('coin', {}); o.dead = true; return; }
    if (o.type === 4) { s.slime = Math.min(1, s.slime + 0.7); this.ev('splat', { x: o.x }); o.dead = true; return; }
    const shield = this.on('shield') && this.breaker('shield') && s.bat > 3;
    this.stats.hits++;
    if (shield) { s.bat = Math.max(0, s.bat - 6); s.shake = Math.max(s.shake, 0.4); this.ev('bonk', { t: o.type }); this.say('SHIELD', 'BONK! Shield absorbed it (and some battery).'); o.dead = true; return; }
    const dmg = ({ 0: 14, 1: 5, 2: 10, 3: 12 })[o.type] || 8;
    this.damage(dmg * D.dmg);
    s.shake = 1.2;
    this.ev('hit', { t: o.type, x: o.x, y: o.y });
    if (o.type === 2 && this.rnd() < 0.7) this.dir.tripRandom('A satellite zapped the electronics!');
    if (o.type === 1) this.ev('moo', {});
    o.dead = true;
    for (const p of this.players.values()) p.stats.hits += 0;
  }
  damage(v, quiet) {
    const s = this.ship;
    s.hull = Math.max(0, s.hull - v);
    if (!quiet && s.hull <= 25 && !s.hullWarn) { s.hullWarn = true; this.ev('alarm', { k: 'hull' }); this.say('MISSION CONTROL', 'The hull is mostly tape now. Please stop hitting things.'); }
    if (s.hull <= 0) this.lose('hull');
  }

  // ------------------------------------------------------------------ approach and landing
  updateApproach(dt) {
    const s = this.ship, D = this.D;
    const tm = this.tiltMag();
    const f = s.thr / 100;
    const g = 1.0, a = f * 3.0;
    s.vs += (g - a) * dt;
    if (s.vs < -3) s.vs = -3;
    s.h -= s.vs * dt;
    s.spd = Math.abs(s.vs);
    if (tm > 42) { s.tumble += dt; if (s.tumble > 3.5) this.lose('tumble'); } else s.tumble = Math.max(0, s.tumble - dt);
    if (s.h > 400) s.h = 400;
    if (s.h <= 0) this.touchdown();
  }
  touchdown() {
    const s = this.ship, D = this.D;
    s.h = 0;
    const tm = this.tiltMag();
    const bags = s.bags || this.c.airbag.v >= 0.5;
    const limit = bags ? 6.5 : 3.6;
    let dmg = Math.max(0, s.vs - limit) * 15;
    if (tm > 10) dmg += (tm - 10) * 2.6;
    if (!this.on('legs')) dmg += 55;
    if (bags) dmg *= 0.55;
    dmg *= D.dmg;
    this.ev('touch', { dmg: r1(dmg), vs: r1(s.vs) });
    const vs = s.vs;
    s.vs = 0; s.thr = 0;
    s.hull = Math.max(0, s.hull - dmg);
    if (s.hull <= 0) { this.lose(!this.on('legs') ? 'belly' : vs > limit ? 'hard' : 'crash'); return; }
    this.win();
  }

  // ------------------------------------------------------------------ incidents (fire / leak damage)
  updateIncidents(dt) {
    const s = this.ship, D = this.D;
    for (const f of this.fires) {
      f.age += dt;
      this.damage(0.7 * D.dmg * dt, true);
      f.zap -= dt;
      if (f.zap <= 0) { f.zap = this.rr(14, 22); if (this.rnd() < 0.45) this.dir.tripRandom('Fire fried a breaker!'); }
    }
    for (const h of this.holes) { h.age += dt; if (h.age > 45) this.damage(0.25 * D.dmg * dt, true); }
    if (!this.fires.length && !this.holes.length && this.phase !== 'landed' && this.phase !== 'moon' && s.hull < 100) s.hull = Math.min(100, s.hull + 0.06 * dt);
    if (s.air <= 0) { s.noAir = (s.noAir || 0) + dt; if (s.noAir > 9) this.lose('air'); } else s.noAir = 0;
  }

  // ------------------------------------------------------------------ end
  lose(reason) {
    if (this.phase === 'fail' || this.phase === 'landed' || this.phase === 'moon') return;
    const texts = {
      tumble: 'The rocket tumbled like a drunk banana.',
      fall: 'Gravity won. Gravity usually does.',
      fuel: 'Out of fuel. The Moon is still very far away.',
      hull: 'The rocket fell apart. It was mostly tape anyway.',
      air: 'Everybody fainted from lack of air. Very peaceful. Very failed.',
      belly: 'You forgot the landing legs. Belly flop!',
      hard: 'That was not a landing, that was an arrival with extra steps.',
      crash: 'Boom. Crater. The Moon has a new hole.',
    };
    this.phase = 'fail'; this.pt = 0;
    this.end = { result: 'lose', reason, text: texts[reason] || 'The mission failed.', stars: 0, stats: this.finalStats() };
    this.ev('fail', { reason, text: this.end.text });
  }
  win() {
    this.phase = 'landed'; this.pt = 0;
    const s = this.ship;
    let stars = 1;
    if (s.hull >= 50) stars++;
    if (s.morale >= 25 || s.coins >= 8) stars++;
    this.end = { result: 'win', reason: 'landed', text: 'THE ROCKET LANDED ON THE MOON!', stars, stats: this.finalStats() };
    this.ev('win', { stars });
    this.say('MISSION CONTROL', 'We have touchdown! The Moon says hello. It tastes like cheese.');
  }
  finalStats() {
    const s = this.ship;
    const per = [];
    for (const p of this.players.values()) per.push({ id: p.id, name: p.name, bot: p.bot, st: p.stats });
    const awards = [];
    const best = (key, title, min) => {
      let b = null;
      for (const p of this.players.values()) if (!b || p.stats[key] > b.stats[key]) b = p;
      if (b && b.stats[key] >= min) awards.push({ t: title, n: b.name, v: Math.round(b.stats[key]) });
    };
    best('honks', 'Honk Master', 3); best('fires', 'Fire Chief', 1); best('cranks', 'Crank Champion', 6); best('breakers', 'Breaker Whisperer', 2);
    best('pumps', 'Pump Pro', 5); best('duck', 'Duck Squeezer', 2); best('steps', 'Marathon Runner', 60); best('leaks', 'Hole Patcher', 1);
    return {
      time: Math.round(this.t), hull: Math.round(s.hull), coins: s.coins, morale: Math.round(s.morale), hits: this.stats.hits, honks: this.stats.honks, per, awards, miss: s.miss,
    };
  }

  // ------------------------------------------------------------------ snapshot
  snapshot() {
    const s = this.ship;
    const c = {};
    for (const id in this.c) {
      const d = CTL[id], st = this.c[id];
      if (d.k === 'stick') c[id] = [r2(st.x), r2(st.y)];
      else if (d.k === 'crank') c[id] = r2(st.ang);
      else c[id] = r2(st.v);
    }
    const g = {}, jm = {};
    for (const id in this.c) { if (this.c[id].g) g[id] = 1; if (this.c[id].jam > 0) jm[id] = this.c[id].jam; }
    const pl = [];
    for (const p of this.players.values()) pl.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.r), p.anim, p.using, p.carry, p.zone]);
    const ob = [];
    for (const o of this.obs) if (o.z < 72) ob.push([o.id, o.type, r1(o.x), r1(o.y), r1(o.z), r2(o.r), o.flee ? 1 : 0]);
    const sh = {
      alt: r1(s.alt), tr: r1(s.trav), tot: TOTAL, spd: r2(s.spd), h: r1(s.h), vs: r2(s.vs), tx: r1(s.tx), ty: r1(s.ty), sx: r1(s.sx), sy: r1(s.sy), hd: r1(s.hd),
      thr: Math.round(s.thr), tmp: Math.round(s.tmp), fa: r1(s.fa), fb: r1(s.fb), bo: r1(s.bo), pr: Math.round(s.pr), bat: r1(s.bat), air: r1(s.air), hull: r1(s.hull),
      eng: s.eng, slime: r2(s.slime), dark: s.dark ? 1 : 0, shake: r2(s.shake), coins: s.coins, morale: Math.round(s.morale), lowg: s.lowg > 0 ? 1 : 0,
      stun: s.stun > 0 ? 1 : 0, cd: r1(s.cd), turbo: s.turbo ? 1 : 0, staged: s.staged ? 1 : 0, maxq: s.maxq ? 1 : 0, sput: s.sputter ? 1 : 0, cold: s.cold ? 1 : 0,
      flare: s.flare, flareT: r1(s.flareT), vw: this.dir.visRange(), rr: this.dir.radarRange(), blk: s.blackout ? 1 : 0, ap: this.on('autop') && this.breaker('autop') ? 1 : 0,
      shield: this.on('shield') && this.breaker('shield') && s.bat > 3 ? 1 : 0, bags: s.bags ? 1 : 0, miss: s.miss,
    };
    const fi = this.fires.map((f) => [f.slot, Math.round(f.hp)]);
    const ho = this.holes.map((h) => [h.slot, Math.round(h.hp)]);
    const tl = {};
    for (const id in this.tools) tl[id] = this.tools[id].holder;
    const ev = this.events; this.events = [];
    const o = {
      t: 's', n: ++this.seq, ph: this.phase, pt: r1(this.pt), tm: r1(this.t), sh, c, g, jm, pl, ob, fi, ho, tl,
      bd: this.board, nd: this.needs, sc: this.scr, ev,
    };
    if (this.end) o.end = this.end;
    return o;
  }
}

module.exports = { Game, DIFF, CTL, BREAKERS, TOTAL, LAT, clamp };
