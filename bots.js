'use strict';
// MOON MAYHEM - bots. They fill empty seats, work through the same "needs" list the humans see, walk around
// the cabin, make small funny mistakes and never steal the yoke from a human.
const { LAYOUT, ST } = require('./layout');

const CTL = {};
LAYOUT.controls.forEach((c) => { CTL[c.id] = c; });
const TOOLDEF = {};
LAYOUT.tools.forEach((t) => { TOOLDEF[t.id] = t; });
const ROLE_ST = { pilot: 'pilot', eng: 'eng', nav: 'nav', sys: 'sys' };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);

class BotBrain {
  constructor(g) { this.g = g; this.claims = new Map(); }

  update(dt) {
    const g = this.g;
    for (const [k, c] of this.claims) { c.t -= dt; if (c.t <= 0) this.claims.delete(k); }
    for (const p of g.players.values()) if (p.bot) this.bot(p, dt);
  }

  ai(p) {
    if (!p.ai) p.ai = { q: [], needId: '', cd: 1 + Math.random() * 2, idleT: 3 + Math.random() * 4, cleanup: null, noteT: 0, held: '', wait: 0, danceT: 0, cool: {} };
    return p.ai;
  }

  // ------------------------------------------------------------------ per bot
  bot(p, dt) {
    const g = this.g, ai = this.ai(p);
    ai.cd -= dt; ai.noteT -= dt; ai.danceT -= dt;
    for (const k in ai.cool) { ai.cool[k] -= dt; if (ai.cool[k] <= 0) delete ai.cool[k]; }
    if (g.phase === 'moon') { this.moonWander(p, ai, dt); return; }
    if (g.phase === 'fail') { p.anim = 0; return; }
    p.zone = 0;
    if (p.role === 'pilot') this.fly(p, dt);
    // run the current plan
    if (ai.q.length) { this.runQueue(p, ai, dt); return; }
    p.using = '';
    if (ai.danceT > 0) { p.anim = 4; return; }
    p.anim = 0;
    if (ai.cd > 0) { this.stepTo(p, this.home(p), dt, 2.4); return; }
    const need = this.choose(p);
    if (need) { this.plan(p, ai, need); return; }
    // nothing to do: go home, return tools, be silly
    if (p.carry) { this.queueReturnTool(p, ai); return; }
    const h = this.home(p);
    if (dist2(p.x, p.z, h[0], h[1]) > 0.3) { this.stepTo(p, h, dt, 2.6); return; }
    ai.idleT -= dt;
    if (ai.idleT <= 0) { ai.idleT = 6 + Math.random() * 10; this.silly(p, ai); }
  }

  home(p) {
    const st = ST[ROLE_ST[p.role]];
    if (!st) return [0, 1.6];
    return st.stand;
  }

  silly(p, ai) {
    const g = this.g, r = Math.random();
    if (r < 0.35) { ai.danceT = 3; g.ev('emote', { p: p.id, k: 1 }); }
    else if (r < 0.5 && g.phase !== 'ascent') { this.press(p, 'duck', 0.25); }
    else if (r < 0.65) { g.ev('chat', { p: p.id, m: g.pick([6, 8, 9]) }); }
  }

  // ------------------------------------------------------------------ choosing work
  choose(p) {
    const g = this.g;
    if (g.phase === 'landed') return g.needs.find((n) => n.id === 'hatch' && Math.random() < 0.01) || null;
    let best = null, bestScore = -1e9;
    const sk = g.D.skill;
    for (const n of g.needs) {
      if (n.k === 'steer') continue;
      const claim = this.claims.get(n.id);
      if (claim && claim.bot !== p.id) continue;
      if (p.ai.cool[n.id]) continue;
      const unmanned = n.st !== 'any' && n.st !== 'mid' && !this.covered(n.st) && p.role !== 'pilot';
      const mine = n.st === p.role || unmanned;
      const global = n.st === 'any' || n.st === 'mid';
      if (!mine && !global && n.p < 8 && !(n.p >= 5 && this.idleHelp(p))) continue;
      if (p.role === 'pilot' && !mine && n.p < 9) continue;           // the pilot keeps flying
      // human is already working at this control?
      if (n.c && g.c[n.c] && g.c[n.c].who && !g.players.get(g.c[n.c].who)?.bot && g.t - (g.c[n.c].humanT || -99) < 3) continue;
      if (n.k === 'fire' || n.k === 'hole') {
        // only the nearest two bots go
        const pos = n.k === 'fire' ? LAYOUT.fireSlots[n.w] : LAYOUT.holeSlots[n.w].p;
        let rank = 0; const d0 = dist2(p.x, p.z, pos[0], pos[2]);
        for (const q of g.players.values()) if (q.bot && q !== p && q.role !== 'pilot' && dist2(q.x, q.z, pos[0], pos[2]) < d0 && !(this.claims.get(n.id) && this.claims.get(n.id).bot === p.id)) rank++;
        if (rank >= 2 && n.p < 9) continue;
        if (p.role === 'pilot') continue;
      }
      let s = n.p * 10 + (mine ? 12 : 0) + (global ? 4 : 0);
      const stand = this.standOf(n);
      if (stand) s -= Math.sqrt(dist2(p.x, p.z, stand[0], stand[1])) * 1.6;
      if (s > bestScore) { bestScore = s; best = n; }
    }
    if (best && best.p < 4 && Math.random() > sk) return null;
    return best;
  }
  idleHelp(p) { return Math.random() < 0.5; }
  covered(st) { for (const q of this.g.players.values()) if (q.role === st) return true; return false; }

  standOf(n) {
    if (n.k === 'fire') { const f = LAYOUT.fireSlots[n.w]; return this.towardCenter(f[0], f[2], 1.4); }
    if (n.k === 'hole') { const h = LAYOUT.holeSlots[n.w].p; return this.towardCenter(h[0], h[2], 1.5); }
    const c = CTL[n.c];
    return c ? c.stand : null;
  }
  towardCenter(x, z, d) {
    const l = Math.sqrt(x * x + z * z) || 1;
    const px = x - (x / l) * d, pz = z - (z / l) * d;
    return [Math.max(-4.2, Math.min(4.2, px)), Math.max(-3.7, Math.min(3.7, pz))];
  }

  // ------------------------------------------------------------------ plans
  plan(p, ai, n) {
    const g = this.g;
    ai.needId = n.id; ai.q = [];
    this.claims.set(n.id, { bot: p.id, t: 1.5 });
    const sk = g.D.skill;
    const q = ai.q;
    const quick = ai.lastId === n.id && g.t - ai.lastT < 3;
    ai.lastId = n.id; ai.lastT = g.t;
    q.push({ t: 'wait', s: quick ? 0.25 : (0.7 + Math.random() * 1.6) / sk });
    if (n.k === 'fire' || n.k === 'hole') {
      const tool = n.k === 'fire' ? 'tool_ext' : 'tool_patch';
      if (p.carry && p.carry !== tool) { q.push({ t: 'go', to: TOOLDEF[p.carry].stand }); q.push({ t: 'call', f: () => g.tool(p.id, { id: p.carry, a: 'put' }) }); }
      if (p.carry !== tool) {
        if (g.tools[tool].holder) { ai.q = []; ai.cool[n.id] = 4; return; }
        q.push({ t: 'go', to: TOOLDEF[tool].stand });
        q.push({ t: 'call', f: () => { p.using = tool; g.tool(p.id, { id: tool, a: 'take' }); } });
        q.push({ t: 'wait', s: 0.5 });
      }
      const spot = this.standOf(n);
      q.push({ t: 'go', to: spot });
      q.push({ t: 'until', max: 30, f: (dt) => {
        const cur = g.needs.find((x) => x.id === n.id);
        if (!cur) return true;
        p.using = n.k === 'fire' ? 'fire' : 'hole';
        const pos = n.k === 'fire' ? LAYOUT.fireSlots[n.w] : LAYOUT.holeSlots[n.w].p;
        p.r = Math.atan2(pos[0] - p.x, pos[2] - p.z) * 180 / Math.PI;
        g.use(p.id, { k: n.k, i: n.w });
        return false;
      } });
      q.push({ t: 'call', f: () => { p.using = ''; } });
      q.push({ t: 'go', to: TOOLDEF[tool].stand });
      q.push({ t: 'call', f: () => { if (p.carry) g.tool(p.id, { id: p.carry, a: 'put' }); } });
      return;
    }
    if (n.k === 'jam') {
      if (p.carry && p.carry !== 'tool_hammer') { q.push({ t: 'go', to: TOOLDEF[p.carry].stand }); q.push({ t: 'call', f: () => g.tool(p.id, { id: p.carry, a: 'put' }) }); }
      if (p.carry !== 'tool_hammer') {
        if (g.tools.tool_hammer.holder) { ai.q = []; ai.cool[n.id] = 4; return; }
        q.push({ t: 'go', to: TOOLDEF.tool_hammer.stand });
        q.push({ t: 'call', f: () => g.tool(p.id, { id: 'tool_hammer', a: 'take' }) });
        q.push({ t: 'wait', s: 0.4 });
      }
      q.push({ t: 'go', to: this.standOf(n) });
      for (let i = 0; i < 3; i++) { q.push({ t: 'call', f: () => { p.using = n.c; g.use(p.id, { k: 'jam', i: n.c }); } }); q.push({ t: 'wait', s: 0.5 }); }
      q.push({ t: 'call', f: () => { p.using = ''; } });
      q.push({ t: 'go', to: TOOLDEF.tool_hammer.stand });
      q.push({ t: 'call', f: () => { if (p.carry) g.tool(p.id, { id: p.carry, a: 'put' }); } });
      return;
    }
    // everything else is a control
    const c = CTL[n.c];
    if (!c) { ai.q = []; return; }
    if (p.carry) { q.push({ t: 'go', to: TOOLDEF[p.carry].stand }); q.push({ t: 'call', f: () => { if (p.carry) g.tool(p.id, { id: p.carry, a: 'put' }); } }); }
    q.push({ t: 'go', to: c.stand });
    // a funny mistake now and then
    q.push({ t: 'call', f: () => {
      if (Math.random() < (1 - sk) * 0.45) {
        if (n.c !== 'duck' && g.phase !== 'ascent') this.press(p, 'duck', 0.3);
        g.ev('chat', { p: p.id, m: 9 });
      }
    } });
    q.push({ t: 'wait', s: 0.4 });
    this.controlSteps(p, ai, n, c, q);
  }

  controlSteps(p, ai, n, c, q) {
    const g = this.g;
    const cur = () => g.needs.find((x) => x.id === n.id);
    const using = () => { p.using = c.id; p.r = Math.atan2(c.p[0] - p.x, c.p[2] - p.z) * 180 / Math.PI; };
    if (n.k === 'crank') {
      q.push({ t: 'until', max: 40, f: (dt) => { if (c.id && g.c[c.id].jam > 0) return true; if (!cur() && g.ship.bat >= 55) return true; using(); g.input(p.id, { id: c.id, d: 1.05 * dt }); return g.ship.bat >= n.w; } });
    } else if (n.k === 'pump') {
      let ph = 0, acc = 0;
      q.push({ t: 'until', max: 30, f: (dt) => {
        if (g.c[c.id].jam > 0 || (!cur() && g.ship.pr >= 60)) return true;
        using(); acc += dt;
        if (acc > 0.42) { acc = 0; ph = 1 - ph; }
        g.input(p.id, { id: c.id, v: ph });
        return g.ship.pr >= n.w;
      } });
    } else if (n.k === 'knob') {
      q.push({ t: 'until', max: 12, f: (dt) => {
        using();
        const d = CTL[c.id]; const nn = d.n || 5;
        const idx = g.idx(c.id);
        if (idx === n.w || g.c[c.id].jam > 0) return true;
        ai.wait -= dt;
        if (ai.wait <= 0) { ai.wait = 0.45; const ni = idx + (n.w > idx ? 1 : -1); g.input(p.id, { id: c.id, v: ni / (nn - 1) }); }
        return false;
      } });
    } else if (n.k === 'lev') {
      q.push({ t: 'until', max: 10, f: (dt) => {
        using();
        const cn = g.needs.find((x) => x.id === n.id);
        const v = g.c[c.id].v, w = cn ? cn.w : n.w;
        if (Math.abs(v - w) < 0.04 || g.c[c.id].jam > 0) return true;
        g.input(p.id, { id: c.id, v: v + Math.sign(w - v) * Math.min(Math.abs(w - v), 0.7 * dt) });
        return false;
      } });
    } else if (n.k === 'hold') {
      const dur = c.id === 'start' ? 1.9 : 0.6;
      q.push({ t: 'call', f: () => { using(); g.input(p.id, { id: c.id, v: 1 }); } });
      q.push({ t: 'wait', s: dur });
      q.push({ t: 'call', f: () => { g.input(p.id, { id: c.id, v: 0 }); p.using = ''; } });
      ai.cleanup = () => g.input(p.id, { id: c.id, v: 0 });
    } else if (n.k === 'tap') {
      q.push({ t: 'call', f: () => { using(); g.input(p.id, { id: c.id, v: 1 }); } });
      q.push({ t: 'wait', s: 0.3 });
      q.push({ t: 'call', f: () => { g.input(p.id, { id: c.id, v: 0 }); p.using = ''; } });
      ai.cleanup = () => g.input(p.id, { id: c.id, v: 0 });
    } else if (n.k === 'guard') {
      q.push({ t: 'call', f: () => { using(); g.input(p.id, { id: c.id, g: 1 }); } });
      q.push({ t: 'wait', s: 0.6 });
      q.push({ t: 'call', f: () => { g.input(p.id, { id: c.id, v: 1 }); } });
      q.push({ t: 'wait', s: 0.6 });
      q.push({ t: 'call', f: () => { g.input(p.id, { id: c.id, v: 0 }); p.using = ''; } });
      ai.cleanup = () => g.input(p.id, { id: c.id, v: 0 });
    } else {
      // plain switch
      q.push({ t: 'call', f: () => { using(); g.input(p.id, { id: c.id, v: n.w }); } });
      q.push({ t: 'wait', s: 0.5 });
      q.push({ t: 'call', f: () => { p.using = ''; } });
    }
    ai.cool[n.id] = 0.6;
  }

  queueReturnTool(p, ai) {
    const g = this.g;
    const def = TOOLDEF[p.carry];
    if (!def) { p.carry = ''; return; }
    ai.q = [{ t: 'go', to: def.stand }, { t: 'call', f: () => { if (p.carry) g.tool(p.id, { id: p.carry, a: 'put' }); } }];
  }

  press(p, id, dur) {
    const g = this.g, ai = this.ai(p);
    g.input(p.id, { id, v: 1 });
    p.using = id;
    g.later(dur, () => g.input(p.id, { id, v: 0 }));
  }

  // ------------------------------------------------------------------ queue execution
  runQueue(p, ai, dt) {
    const g = this.g;
    const st = ai.q[0];
    // abandon the plan if the need vanished (except for tool cleanups)
    if (ai.needId && !g.needs.find((x) => x.id === ai.needId) && !p.carry && st.t !== 'call') {
      if (ai.cleanup) { try { ai.cleanup(); } catch (e) { /* ignore */ } ai.cleanup = null; }
      ai.q = []; ai.needId = ''; p.using = ''; ai.cd = 0.4 + Math.random() * 0.5; return;
    }
    if (ai.needId) { const c = this.claims.get(ai.needId); if (c) c.t = 1.5; }
    switch (st.t) {
      case 'wait': p.anim = 0; st.s -= dt; if (st.s <= 0) ai.q.shift(); break;
      case 'call': st.f(); ai.q.shift(); break;
      case 'go': {
        const d = this.stepTo(p, st.to, dt, this.speedFor(p));
        if (d < 0.2) ai.q.shift();
        break;
      }
      case 'until': {
        p.anim = 0;
        st.max -= dt;
        if (st.max <= 0 || st.f(dt)) { ai.q.shift(); }
        break;
      }
      default: ai.q.shift();
    }
    if (!ai.q.length) { ai.cleanup = null; ai.needId = ''; ai.cd = 0.4 + Math.random() * 0.8; }
  }
  speedFor(p) { return 3.1; }

  // walk towards a floor point along the ring road; returns the remaining straight distance
  buildPath(p, to) {
    const ring = LAYOUT.ring;
    const pts = [];
    if (Math.sqrt(dist2(p.x, p.z, to[0], to[1])) > 2.2) {
      const nearest = (x, z) => { let bi = 0, bd = 1e9; for (let i = 0; i < ring.length; i++) { const d = dist2(x, z, ring[i][0], ring[i][1]); if (d < bd) { bd = d; bi = i; } } return bi; };
      const a = nearest(p.x, p.z), b = nearest(to[0], to[1]);
      pts.push(ring[a]);
      const step = ((b - a + 8) % 8) <= 4 ? 1 : 7;
      let i = a;
      while (i !== b) { i = (i + step) % 8; pts.push(ring[i]); }
    }
    pts.push(to);
    return { tx: to[0], tz: to[1], pts, i: 0 };
  }
  stepTo(p, to, dt, speed) {
    const ai = this.ai(p);
    if (!ai.walk || ai.walk.tx !== to[0] || ai.walk.tz !== to[1]) ai.walk = this.buildPath(p, to);
    const w = ai.walk;
    while (w.i < w.pts.length - 1 && dist2(p.x, p.z, w.pts[w.i][0], w.pts[w.i][1]) < 0.04) w.i++;
    const wp = w.pts[w.i];
    const dx = wp[0] - p.x, dz = wp[1] - p.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 0.03) {
      const st = Math.min(l, speed * dt);
      p.x += dx / l * st; p.z += dz / l * st;
      p.r = Math.atan2(dx, dz) * 180 / Math.PI;
      p.anim = 1;
      p.stats.steps += st;
    } else p.anim = 0;
    const rem = Math.sqrt(dist2(p.x, p.z, to[0], to[1]));
    if (rem < 0.2) ai.walk = null;
    return rem;
  }

  // ------------------------------------------------------------------ the bot pilot
  fly(p, dt) {
    const g = this.g, s = g.ship, y = g.c.yoke;
    if (g.t - (y.humanT || -99) < 2.5) return;           // a human has the yoke
    if (g.phase === 'pre' || g.phase === 'landed') { y.x *= 0.9; y.y *= 0.9; return; }
    const sk = g.D.skill;
    const ai = this.ai(p);
    // where do we want to be?
    let tiltX = 0, tiltY = 0;
    if (g.phase === 'cruise') {
      const dec = this.dodge(p, ai, dt);
      tiltX = clamp((dec.x - s.sx) * 2.4, -22, 22);
      tiltY = clamp((dec.y - s.sy) * 2.4, -16, 16);
    }
    const ki = 1.25 * sk;
    const ex = (tiltX - s.tx) / 28, ey = (tiltY - s.ty) / 28;
    const noise = (1 - sk) * 0.4;
    y.x = clamp(y.x + (ex * ki + (Math.random() - 0.5) * noise * 0.2) * dt * 1.6, -1, 1);
    y.y = clamp(y.y + (ey * ki + (Math.random() - 0.5) * noise * 0.2) * dt * 1.6, -1, 1);
  }
  dodge(p, ai, dt) {
    const g = this.g, s = g.ship, sk = g.D.skill;
    ai.dodgeT = (ai.dodgeT || 0) - dt;
    if (ai.dodgeT > 0 && ai.dec) return ai.dec;
    ai.dodgeT = 0.3 + (1 - sk) * 0.5;
    const look = 14 + 22 * sk;
    let urgent = null;
    for (const o of g.obs) {
      if (o.z < 0.5 || o.z > look) continue;
      if (o.type === 4 || o.type === 5) continue;
      if (o.type === 1 && o.flee) continue;
      const ttc = o.z / g.closing();
      const fx = o.x + (o.vx || 0) * ttc, fy = o.y + (o.vy || 0) * ttc;
      const need = o.r + 1.6;
      const dx = fx - s.sx, dy = fy - s.sy;
      if (dx * dx + dy * dy < need * need * 1.7) { if (!urgent || o.z < urgent.o.z) urgent = { o, fx, fy }; }
    }
    let dec = { x: s.sx * 0.9, y: s.sy * 0.9 };
    if (urgent) {
      const o = urgent.o, m = o.r + 2.4;
      const cands = [urgent.fx - m, urgent.fx + m].map((v) => clamp(v, -8.2, 8.2));
      cands.sort((a, b) => Math.abs(a - s.sx) - Math.abs(b - s.sx));
      // avoid a second obstacle right behind the first
      let pickX = cands[0];
      for (const cx of cands) {
        let bad = false;
        for (const q of g.obs) if (q !== o && q.type < 4 && Math.abs(q.z - o.z) < 8 && Math.abs(q.x - cx) < q.r + 1.8) bad = true;
        if (!bad) { pickX = cx; break; }
      }
      dec = { x: pickX, y: clamp(urgent.fy > s.sy ? urgent.fy - 3 : urgent.fy + 3, -4.5, 4.5) * 0.4 };
    } else {
      // collect a coin if one is close to our line
      let coin = null;
      for (const o of g.obs) if (o.type === 5 && o.z > 5 && o.z < 28 && Math.abs(o.x - s.sx) < 5 && (!coin || o.z < coin.z)) coin = o;
      if (coin && Math.random() < sk + 0.1) dec = { x: coin.x, y: coin.y * 0.7 };
    }
    ai.dec = dec;
    return dec;
  }

  // ------------------------------------------------------------------ the Moon party
  moonWander(p, ai, dt) {
    const g = this.g;
    p.zone = 1;
    if (!ai.mt || ai.mt.age > ai.mt.life) {
      ai.mt = { x: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 16 - 4, age: 0, life: 4 + Math.random() * 5 };
      if (Math.random() < 0.25) ai.danceT = 3;
    }
    ai.mt.age += dt;
    if (ai.danceT > 0) { p.anim = 4; return; }
    const dx = ai.mt.x - p.x, dz = ai.mt.z - p.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 0.3) { p.x += dx / l * 2.5 * dt; p.z += dz / l * 2.5 * dt; p.r = Math.atan2(dx, dz) * 180 / Math.PI; p.anim = 1; } else p.anim = 0;
  }
}

module.exports = { BotBrain };
