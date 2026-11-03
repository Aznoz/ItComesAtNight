'use strict';
// MOON MAYHEM - the director: pre-flight checklist, hazards, incidents, phone calls, solar flares,
// the "needs" list (what the crew should do right now) and the texts on the boards and screens.
const { LAYOUT } = require('./layout');

const TOTAL = 300;
const BREAKERS = ['br_radar', 'br_shield', 'br_lights', 'br_engine', 'br_comms', 'br_autop'];
const BRNAME = { br_radar: 'RADAR', br_shield: 'SHIELD', br_lights: 'LIGHTS', br_engine: 'ENGINE', br_comms: 'COMMS', br_autop: 'AUTO-BOB' };
const COLORS = ['red', 'green', 'blue', 'yellow'];
const RADAR_RANGES = [18, 30, 45, 65];
const SEG = [
  { to: 70, name: 'ASTEROID ALLEY', say: 'Asteroid Alley ahead. Rocks to the left, rocks to the right. Mostly rocks.' },
  { to: 130, name: 'COW PASTURE', say: 'Warning: space cows. They are grazing on stars. Honk to make them move!' },
  { to: 195, name: 'GOOEY NEBULA', say: 'Gooey Nebula ahead. It is dark and sticky. Headlights and wipers, people!' },
  { to: 255, name: 'SOLAR WEATHER', say: 'Solar weather report: flares, comets, and a chance of satellites.' },
  { to: 300, name: 'MOON DRIVEWAY', say: 'The Moon is in sight! Keep the compass needle in the middle and slow down soon.' },
];

class Director {
  constructor(g) {
    this.g = g;
    this.chk = [];
    this.acc = 0;
    this.seg = -1;
    this.incT = 0;
    this.flaresDone = 0;
    this.call = { st: 'idle', kind: '', t: 0, prog: 0, need: 0, code: [], inp: [], text: '' };
    this.callIdx = 0;
    this.honkT = -10;
    this.buzzT = 0;
    this.msgT = 0;
  }

  start() {
    const g = this.g;
    this.valveT = g.ri(1, 3);
    this.courseT = g.pick([1, 2, 3, 5, 6, 7]);
    this.feedW = g.ri(0, 1);
    g.c.feed.v = this.feedW ? 0 : 1;                 // start on the "wrong" tank so the checklist item makes sense
    const easy = g.diff === 0;
    const I = [];
    const add = (o) => I.push(Object.assign({ done: false }, o));
    add({ id: 'bat', t: 'Charge the BATTERY to 60% (hold the crank and circle the mouse)', st: 'sys', c: 'crank', k: 'crank', w: 60, test: () => g.ship.bat >= 60 });
    add({ id: 'brk', t: 'Flip every BREAKER back on', st: 'sys', c: () => BREAKERS.find((id) => !g.on(id)), k: 'ctl', w: 1, test: () => BREAKERS.every((id) => g.on(id)) });
    add({ id: 'o2', t: 'Turn the OXYGEN GENERATOR on', st: 'sys', c: 'o2gen', k: 'ctl', w: 1, test: () => g.on('o2gen') });
    add({ id: 'ant', t: 'Raise the ANTENNA', st: 'nav', c: 'antenna', k: 'ctl', w: 1, test: () => g.on('antenna') });
    add({ id: 'feed', t: 'Fuel feed to TANK ' + (this.feedW ? 'B' : 'A'), st: 'eng', c: 'feed', k: 'ctl', w: this.feedW, test: () => (g.on('feed') ? 1 : 0) === this.feedW });
    add({ id: 'pump', t: 'PUMP the fuel pressure to 70', st: 'eng', c: 'pump', k: 'pump', w: 70, test: () => g.ship.pr >= 70 });
    if (!easy || true) {
      add({ id: 'valve', t: 'COOLANT VALVE: the right number is on the NAVIGATOR screen', st: 'eng', c: 'valve', k: 'knob', w: this.valveT, test: () => g.idx('valve') === this.valveT,
        cross: { to: 'nav', text: 'COOLANT VALVE = ' + this.valveT }, easy: 'COOLANT VALVE to ' + this.valveT });
      add({ id: 'course', t: 'COURSE TRIM: the right number is on the PILOT screen', st: 'nav', c: 'course', k: 'knob', w: this.courseT, test: () => g.idx('course') === this.courseT,
        cross: { to: 'pilot', text: 'COURSE TRIM = ' + (this.courseT + 1) }, easy: 'COURSE TRIM to ' + (this.courseT + 1) });
    }
    add({ id: 'lights', t: 'Test the HEADLIGHTS (on)', st: 'pilot', c: 'lights', k: 'ctl', w: 1, test: () => g.on('lights') });
    add({ id: 'wipers', t: 'Test the WIPERS (on)', st: 'pilot', c: 'wipers', k: 'ctl', w: 1, test: () => g.on('wipers') });
    add({ id: 'horn', t: 'HONK the horn to wake up the Moon', st: 'pilot', c: 'horn', k: 'hold', w: 1, test: () => this.honkedPre });
    add({ id: 'arm', t: 'ARM the engine (key switch)', st: 'eng', c: 'master', k: 'ctl', w: 1, test: () => g.on('master') });
    add({ id: 'start', t: 'START the engine (hold the green button)', st: 'eng', c: 'start', k: 'hold', w: 1, live: true, test: () => g.ship.eng === 1 });
    this.chk = I;
    this.honkedPre = false;
    this.incT = g.rr(g.D.inc[0], g.D.inc[1]) * 0.8;
  }

  // ------------------------------------------------------------------ checklist / launch
  updatePre(dt) {
    const g = this.g, s = g.ship;
    for (const it of this.chk) { const ok = it.test(); if (it.live) it.done = ok; else if (ok) it.done = true; }
    if (s.cd > 0) {
      const before = Math.ceil(s.cd);
      s.cd -= dt;
      const after = Math.ceil(Math.max(0, s.cd));
      if (after < before && after > 0) g.ev('count', { n: after });
      if (s.cd <= 0) {
        s.cd = 0; g.phase = 'ascent'; g.pt = 0; g.ev('liftoff', {});
        g.say('MISSION CONTROL', 'LIFTOFF! Keep it level and give it some throttle. Watch the max-Q window!');
        this.incT = g.rr(20, 30);
      }
    }
  }
  allDone() { return this.chk.every((i) => i.done); }
  launch(p) {
    const g = this.g, s = g.ship;
    if (g.phase !== 'pre') return;
    if (g.c.launch.v < 0.5) return;
    if (s.cd > 0) return;
    const todo = this.chk.find((i) => !i.done);
    if (todo) { g.ev('nope', { why: 'Not ready: ' + todo.t }); g.c.launch.v = 0; return; }
    s.cd = 5; g.ev('count', { n: 5 });
    g.say('MISSION CONTROL', 'Launch sequence started! Hold on to something!');
  }
  honk() {
    const g = this.g, s = g.ship;
    this.honkedPre = this.honkedPre || g.phase === 'pre';
    this.honkT = g.t;
    // space cows flee from the honk
    for (const o of g.obs) if (o.type === 1 && o.z < 50 && o.z > 0 && !o.flee) { o.flee = o.x >= s.sx ? 1 : -1; g.stats.cows++; const p = g.players.get(g.c.horn.who); if (p) p.stats.cows++; }
    if (this.call.st === 'talk' && this.call.kind === 'honk') this.callProgress(1);
  }
  duck() { if (this.call.st === 'talk' && this.call.kind === 'duck') this.callProgress(1); }
  breakerFixed(id) { /* stats are counted by the game */ }
  callEvent(kind) { if (this.call.st === 'talk' && this.call.kind === kind) this.callProgress(1); }

  // ------------------------------------------------------------------ phases
  toCruise() {
    const g = this.g, s = g.ship;
    g.phase = 'cruise'; g.pt = 0; s.alt = 100; s.cd = 0; s.shake = 0.6;
    s.gustT = 99; this.acc = 0; this.seg = -1;
    g.ev('orbit', {});
    g.say('MISSION CONTROL', 'You are in space! Nobody can hear you scream (or honk). Now fly to the Moon.');
    this.incT = g.rr(g.D.inc[0] * 0.5, g.D.inc[1] * 0.6);
  }
  arrive() {
    const g = this.g, s = g.ship;
    if (Math.abs(s.hd) > 14) {
      s.miss++; s.trav = 215; g.obs = []; s.hd *= 0.3; g.ev('miss', {});
      g.say('MISSION CONTROL', 'You MISSED the Moon?! It is the big round thing! U-turn, quickly! (Keep the compass needle centered!)');
      return;
    }
    g.phase = 'approach'; g.pt = 0; g.obs = []; s.h = 130; s.vs = 4.5; s.dark = false; s.slime = Math.min(s.slime, 0.2);
    s.gustT = 6; s.wx = 0; s.wy = 0;
    g.ev('approach', {});
    g.say('MISSION CONTROL', 'Landing time! Legs out, brake gently, stay level. Cheese airbags are optional but delicious.');
  }

  // ------------------------------------------------------------------ per tick
  update(dt) {
    const g = this.g, s = g.ship;
    // slime / wipers / visibility
    if (g.on('wipers') && g.power()) s.slime = Math.max(0, s.slime - 0.33 * dt);
    if (g.phase === 'cruise') {
      this.spawn(dt);
      this.updateFlare(dt);
      this.updateCalls(dt);
      this.segmentTick();
    } else if (g.phase !== 'approach') { s.dark = false; }
    if (g.phase === 'ascent' || g.phase === 'cruise') this.incidents(dt);
    // decorations of the stats
    this.msgT -= dt;
    if (g.phase === 'approach' && this.msgT <= 0) {
      this.msgT = 6;
      if (!g.on('legs') && s.h < 90) g.ev('alarm', { k: 'legs' });
    }
    this.updateBoard();
  }

  segmentTick() {
    const g = this.g, s = g.ship;
    let i = 0; while (i < SEG.length - 1 && s.trav >= SEG[i].to) i++;
    if (i !== this.seg) { this.seg = i; g.ev('seg', { n: SEG[i].name }); g.say('MISSION CONTROL', SEG[i].say); }
    // the dark patch of the nebula
    s.dark = s.trav > 138 && s.trav < 178;
  }

  visRange() { const g = this.g; if (g.ship.dark) return (g.on('lights') && g.breaker('lights') && g.power()) ? 18 : 6; return 36; }
  radarRange() { const g = this.g; if (!g.breaker('radar') || !g.power()) return 0; return RADAR_RANGES[g.idx('range')]; }

  // ------------------------------------------------------------------ hazards
  spawn(dt) {
    const g = this.g, s = g.ship, D = g.D;
    this.acc += s.spd * dt;
    const seg = Math.max(0, this.seg);
    const gap = D.gap;
    const interval = [8, 9, 7, 8.5, 15][seg] * gap;
    if (this.acc < interval) return;
    this.acc -= interval;
    const R = 7.5;
    const mk = (type, x, y, r, o) => { const ob = Object.assign({ id: g.nextOb++, type, x, y, z: 72, r, vx: 0, vy: 0, vz: 0 }, o || {}); g.obs.push(ob); return ob; };
    const rx = () => g.rr(-R, R), ry = () => g.rr(-4.5, 4.5);
    const roll = g.rnd();
    if (seg === 0) {
      if (roll < 0.22) { const gx = g.rr(-5, 5); mk(0, gx - 3.8, ry(), 1.6); mk(0, gx + 3.8, ry(), 1.6); mk(5, gx, 0, 1.1); }        // a gate with a coin in the gap
      else if (roll < 0.34) { const x = rx(); for (let i = 0; i < 4; i++) mk(5, x + Math.sin(i) * 1.5, ry() * 0.3, 1.1, { z: 72 + i * 4 }); }
      else mk(0, rx(), ry(), g.rr(1.2, 1.9), { vx: g.rr(-0.4, 0.4) });
    } else if (seg === 1) {
      if (roll < 0.55) mk(1, rx(), ry() * 0.7, 1.9, { vx: g.rr(-0.8, 0.8) });
      else if (roll < 0.75) mk(0, rx(), ry(), 1.5);
      else { const x = rx(); for (let i = 0; i < 3; i++) mk(5, x, ry() * 0.3, 1.1, { z: 72 + i * 4 }); }
    } else if (seg === 2) {
      if (roll < 0.5) mk(4, rx(), ry(), 1.8);
      else if (roll < 0.72) mk(0, rx(), ry(), 1.5);
      else if (roll < 0.82) mk(1, rx(), 0, 1.9, { vx: g.rr(-0.5, 0.5) });
      else mk(5, rx(), ry() * 0.4, 1.1);
    } else if (seg === 3) {
      if (roll < 0.3) { const side = g.rnd() < 0.5 ? -1 : 1; mk(3, side * 13, g.rr(-3, 3), 1.0, { vx: -side * 3.6, vz: 7 }); }
      else if (roll < 0.55) mk(2, rx(), ry(), 1.2, { vx: g.rr(-0.6, 0.6) });
      else if (roll < 0.8) mk(0, rx(), ry(), 1.6);
      else mk(5, rx(), ry() * 0.4, 1.1);
    } else {
      if (roll < 0.5) mk(5, rx(), ry() * 0.4, 1.1); else mk(0, rx(), ry(), 1.4);
    }
  }

  // solar flares
  updateFlare(dt) {
    const g = this.g, s = g.ship;
    const marks = g.diff === 2 ? [150, 205, 238] : [205, 238];
    if (s.flare === 0 && this.flaresDone < marks.length && s.trav >= marks[this.flaresDone]) {
      this.flaresDone++; s.flare = 1; s.flareT = 8;
      g.ev('flare', { st: 1 }); g.say('NAV RADAR', 'SOLAR FLARE incoming! Raise the SHIELD (systems wall)!');
    } else if (s.flare === 1) {
      s.flareT -= dt;
      if (s.flareT <= 0) {
        s.flare = 2; s.flareT = 2.5; g.ev('flare', { st: 2 });
        const shield = g.on('shield') && g.breaker('shield') && s.bat > 3;
        if (shield) { s.bat = Math.max(0, s.bat - 10); g.say('SHIELD', 'The shield took the flare! (Battery -10)'); }
        else { s.stun = 4; s.shake = 1.0; this.tripRandom('Solar flare fried the electronics!'); this.tripRandom(''); }
      }
    } else if (s.flare === 2) { s.flareT -= dt; if (s.flareT <= 0) { s.flare = 0; s.flareT = 0; } }
  }

  // ------------------------------------------------------------------ incidents
  incidents(dt) {
    const g = this.g, s = g.ship, D = g.D;
    this.incT -= dt;
    if (this.incT > 0) return;
    const busy = g.fires.length + g.holes.length + BREAKERS.filter((b) => !g.on(b)).length + Object.keys(g.c).filter((k) => g.c[k].jam > 0).length;
    if (busy >= 3 || s.cd > 0) { this.incT = 4; return; }
    const ascent = g.phase === 'ascent';
    if (ascent && s.alt < 15) { this.incT = 3; return; }
    const kinds = ascent ? ['trip', 'jam', 'fire'] : ['fire', 'fire', 'fire', 'leak', 'leak', 'trip', 'trip', 'trip', 'jam', 'jam', 'lowg'];
    const k = g.pick(kinds);
    this.incT = g.rr(D.inc[0], D.inc[1]) * (ascent ? 1.5 : 1);
    if (k === 'fire') this.fire();
    else if (k === 'leak') this.leak();
    else if (k === 'trip') this.tripRandom('');
    else if (k === 'jam') this.jam();
    else if (k === 'lowg') { s.lowg = 8; g.ev('lowg', {}); g.say('MISSION CONTROL', 'Gravity hiccup! Everything floats. Please stay calm. Or do not.'); }
  }
  fire(prefer) {
    const g = this.g;
    if (g.fires.length >= 3) return;
    const used = g.fires.map((f) => f.slot);
    const free = (prefer || LAYOUT.fireSlots.map((_, i) => i)).filter((i) => !used.includes(i));
    if (!free.length) return;
    const slot = g.pick(free);
    g.fires.push({ slot, hp: 100, age: 0, zap: g.rr(8, 14) });
    g.ev('fire', { slot });
    g.say('FIRE ALARM', 'FIRE! Grab the extinguisher from the rack on the systems wall!');
  }
  engineFire() { this.g.say('ENGINE', 'The engine overheated and caught fire. Cool it down, then restart!'); this.fire([1, 3, 6, 8]); }
  leak() {
    const g = this.g;
    if (g.holes.length >= 2) return;
    const used = g.holes.map((f) => f.slot);
    const free = LAYOUT.holeSlots.map((_, i) => i).filter((i) => !used.includes(i));
    if (!free.length) return;
    const slot = g.pick(free);
    g.holes.push({ slot, hp: 100, age: 0 });
    g.ev('leak', { slot });
    g.say('HULL', 'HULL BREACH! Something punched a hole in the wall. Patch it with the patch kit!');
  }
  tripRandom(msg) {
    const g = this.g;
    const on = BREAKERS.filter((b) => g.on(b));
    if (!on.length) return;
    const id = g.pick(on);
    g.c[id].v = 0;
    g.ev('trip', { id });
    g.say('BREAKER', msg ? msg + ' ' + BRNAME[id] + ' breaker tripped.' : BRNAME[id] + ' breaker tripped! Flip it back on.');
  }
  jam() {
    const g = this.g;
    const cand = ['throttle', 'pump', 'valve', 'feed', 'autop'].filter((id) => g.c[id].jam <= 0);
    if (!cand.length) return;
    const id = g.pick(cand);
    g.c[id].jam = 3;
    g.ev('jam', { id });
    g.say(LAYOUT.controls.find((c) => c.id === id).l, 'JAMMED! Grab the hammer and whack it three times!');
  }

  // ------------------------------------------------------------------ phone calls
  updateCalls(dt) {
    const g = this.g, s = g.ship, c = this.call;
    const plan = [35, 95, 160, 222];
    const kinds = ['duck', 'code', g.pick(['disco', 'coffee', 'honk']), 'code'];
    if (c.st === 'idle' && this.callIdx < plan.length && s.trav >= plan[this.callIdx] && s.flare === 0) {
      c.st = 'ring'; c.kind = kinds[this.callIdx]; c.t = 0; c.prog = 0; c.code = []; c.inp = [];
      this.callIdx++;
      g.ev('ring', {});
      g.say('PHONE', 'BRRRING! The navigator console phone is ringing. Pick up the handset!');
    }
    if (c.st === 'ring') {
      c.t += dt;
      if (c.t > 22) { c.st = 'idle'; g.ev('hangup', { why: 'missed' }); g.say('PHONE', 'Missed call. Houston will call again, probably angrier.'); }
    } else if (c.st === 'talk') {
      c.t += dt;
      if (c.t > c.limit) { c.st = 'hang'; c.t = 0; g.ev('hangup', { why: 'timeout' }); g.say('HOUSTON', 'Hello? Hello? ...they hung up on us. Rude.'); s.morale = Math.max(0, s.morale - 4); }
    } else if (c.st === 'hang') {
      c.t += dt;
      if (!g.on('handset')) { c.st = 'idle'; }
      else { this.buzzT -= dt; if (this.buzzT <= 0) { this.buzzT = 7; g.ev('buzz', {}); } }
    }
  }
  handset(up, p) {
    const g = this.g, c = this.call;
    if (up) {
      if (c.st === 'ring') {
        const ok = g.on('antenna') && g.breaker('comms') && g.power();
        if (!ok) { g.ev('static', {}); g.say('PHONE', 'Only static... Is the ANTENNA up and the COMMS breaker on?'); return; }
        c.st = 'talk'; c.t = 0; c.prog = 0;
        if (c.kind === 'duck') { c.need = 3; c.limit = 40; c.text = 'Houston says: "Squeeze the rubber duck 3 times!" (pilot dashboard)'; }
        else if (c.kind === 'honk') { c.need = 2; c.limit = 35; c.text = 'Houston says: "Honk the horn twice!"'; }
        else if (c.kind === 'disco') { c.need = 1; c.limit = 35; c.text = 'Houston says: "Turn on the DISCO switch! We heard there is a party!"'; }
        else if (c.kind === 'coffee') { c.need = 1; c.limit = 35; c.text = 'Houston says: "Somebody make COFFEE. The big mug on the table."'; }
        else { c.kind = 'code'; c.need = 4; c.limit = 45; c.code = [0, 1, 2, 3].map(() => g.ri(0, 3)); c.inp = []; c.text = 'Houston says: "Enter this code on the SYSTEMS keypad!"'; }
        g.ev('answer', { kind: c.kind });
        g.say('HOUSTON', c.text.replace('Houston says: ', ''));
      } else if (c.st === 'idle') g.ev('static', {});
    } else if (c.st === 'talk') { c.st = 'idle'; g.ev('hangup', { why: 'early' }); g.say('PHONE', 'You hung up mid-call. Houston is offended.'); }
    else if (c.st === 'hang') { c.st = 'idle'; }
  }
  callProgress(n) {
    const g = this.g, c = this.call;
    c.prog += n;
    if (c.prog >= c.need) this.callDone();
  }
  callDone() {
    const g = this.g, c = this.call;
    c.st = 'hang'; c.t = 0;
    g.ship.morale = Math.min(100, g.ship.morale + 8); g.ship.coins += 2;
    g.ev('calldone', {});
    g.say('HOUSTON', 'Excellent! Great job, crew! Hang up the handset now.');
  }
  keypad(color, p) {
    const g = this.g, c = this.call;
    const ci = COLORS.indexOf(color);
    g.ev('kp', { c: ci });
    if (c.st !== 'talk' || c.kind !== 'code') return;
    const want = c.code[c.inp.length];
    if (ci === want) { c.inp.push(ci); c.prog = c.inp.length; if (c.inp.length >= c.code.length) this.callDone(); }
    else { c.inp = []; c.prog = 0; g.ev('wrong', {}); }
  }

  // ------------------------------------------------------------------ the needs list
  computeNeeds() {
    const g = this.g, s = g.ship, N = [];
    const add = (id, st, t, c, k, w, p, extra) => N.push(Object.assign({ id, st, t, c: c || '', k, w, p }, extra || {}));
    const ph = g.phase;
    const L = (id) => LAYOUT.controls.find((x) => x.id === id);
    if (ph === 'pre') {
      if (s.cd > 0) { g.needs = []; return; }
      for (const it of this.chk) {
        if (it.done) continue;
        if (it.id === 'start' && (!g.on('master') || s.pr < 20 || !g.breaker('engine'))) continue;
        const c = typeof it.c === 'function' ? it.c() : it.c;
        add('chk_' + it.id, it.st, it.easy && g.help > 1 ? it.easy : it.t, c, it.k, it.w, 4);
      }
      if (this.allDone()) add('launch', 'mid', 'PULL THE LAUNCH LEVER on the middle table!', 'launch', 'ctl', 1, 6);
      g.needs = N; return;
    }
    if (ph === 'fail' || ph === 'moon') { g.needs = []; return; }
    if (ph === 'landed') { add('hatch', 'mid', 'Press HATCH on the middle table and party on the Moon!', 'hatch', 'tap', 1, 5); g.needs = N; return; }

    const flying = ph === 'ascent' || ph === 'cruise' || ph === 'approach';
    // engine
    const armed = g.on('master') && g.breaker('engine') && g.power();
    if (s.eng !== 1 && (ph === 'ascent' || ph === 'cruise' || (ph === 'approach' && s.h > 5)) && s.eng !== 2) {
      if (!g.breaker('engine')) { /* the tripped breaker need covers it */ }
      else if (!g.on('master')) add('arm', 'eng', 'ARM the engine (key switch)!', 'master', 'ctl', 1, 8);
      else if (s.pr < 22) add('pumpstart', 'eng', 'PUMP fuel pressure, then START!', 'pump', 'pump', 40, 8);
      else if (g.tankLevel() <= 0.5) add('tankswap', 'eng', 'This tank is EMPTY - switch the fuel feed!', 'feed', 'ctl', g.on('feed') ? 0 : 1, 9);
      else add('start', 'eng', 'The engine is off - hold START!', 'start', 'hold', 1, 8);
    }
    if (s.eng === 2) add('cool', 'eng', 'ENGINE OVERHEATED! Open the coolant valve and wait', 'valve', 'knob', 4, 8);
    if (s.eng === 1) {
      if (s.pr < 45) add('pump', 'eng', 'PUMP the fuel pressure!', 'pump', 'pump', 80, s.pr < 25 ? 8 : 6);
      if (s.tmp > 82) add('hot', 'eng', 'Engine is HOT: open the coolant valve (or throttle back)', 'valve', 'knob', Math.min(4, g.idx('valve') + 1), s.tmp > 92 ? 9 : 6);
      else if (s.cold) add('cold', 'eng', 'Engine too cold: close the coolant valve a bit', 'valve', 'knob', Math.max(0, g.idx('valve') - 1), 3);
      const other = g.on('feed') ? s.fa : s.fb;
      if (g.tankLevel() <= 0.5 && (s.staged || ph !== 'ascent')) add('tankswap', 'eng', 'This tank is EMPTY - switch the fuel feed!', 'feed', 'ctl', g.on('feed') ? 0 : 1, 9);
      else if (g.tankLevel() < 6 && other > 6 && (s.staged || ph !== 'ascent')) add('tankswap', 'eng', 'This tank is almost empty - switch the fuel feed', 'feed', 'ctl', g.on('feed') ? 0 : 1, 6);
    }
    if (ph === 'ascent') {
      if (!s.staged && s.bo <= 0) add('stage', 'eng', 'Booster EMPTY - DROP BOOSTER (open the cover first)!', 'stage', 'guard', 1, 9);
      if (s.maxq && s.thr > 78) add('maxq', 'eng', 'MAX-Q! Throttle back under 75%!', 'throttle', 'lev', 0.6, 8);
      else if (s.eng === 1 && s.thr < 62 && s.alt < 96 && !s.maxq) add('more', 'eng', 'More THROTTLE! We are barely moving', 'throttle', 'lev', 0.85, 5);
      if (this.g.tiltMag() > 14) add('steer', 'pilot', 'STEER! The rocket is leaning too much', 'yoke', 'steer', 0, 7);
    }
    if (ph === 'cruise') {
      if (s.eng === 1 && s.thr < 40 && s.trav < 295) add('more', 'eng', 'More THROTTLE to get to the Moon!', 'throttle', 'lev', 0.7, 3);
      if (s.slime > 0.3 && !g.on('wipers')) add('wipers', 'pilot', 'The window is SLIMY - turn on the WIPERS', 'wipers', 'ctl', 1, 5);
      if (s.dark && !g.on('lights')) add('lights', 'pilot', 'It is DARK out there - turn on the HEADLIGHTS', 'lights', 'ctl', 1, 6);
      if (s.flare === 1) { if (!g.on('shield')) add('shield', 'sys', 'SOLAR FLARE! Raise the SHIELD now!', 'shield', 'ctl', 1, 9); }
      else if (g.on('shield') && s.bat < 55 && s.flare === 0) add('shieldoff', 'sys', 'Shield is eating the battery - lower it', 'shield', 'ctl', 0, 2);
      if (this.call.st === 'ring') { if (!g.on('antenna')) add('ant', 'nav', 'The phone rings, but the ANTENNA is down', 'antenna', 'ctl', 1, 7); else add('call', 'nav', 'The phone is RINGING - pick up the handset!', 'handset', 'ctl', 1, 6); }
      if (this.call.st === 'talk') {
        const c = this.call;
        if (c.kind === 'duck') add('call_duck', 'pilot', 'Houston wants the RUBBER DUCK squeezed (' + c.prog + '/' + c.need + ')', 'duck', 'tap', 1, 6);
        else if (c.kind === 'honk') add('call_honk', 'pilot', 'Houston wants the HORN honked (' + c.prog + '/' + c.need + ')', 'horn', 'tap', 1, 6);
        else if (c.kind === 'disco') add('call_disco', 'sys', 'Houston wants the DISCO switch ON', 'disco', 'ctl', 1, 6);
        else if (c.kind === 'coffee') add('call_coffee', 'mid', 'Houston wants COFFEE from the big mug', 'coffee', 'tap', 1, 6);
        else if (c.kind === 'code') add('call_code', 'sys', 'Type the CODE from the navigator screen on the keypad (' + c.prog + '/4)', COLORS[c.code[c.inp.length]] ? 'kp_' + COLORS[c.code[c.inp.length]] : 'kp_red', 'tap', 1, 7, { code: 1 });
      }
      if (this.call.st === 'hang' && g.on('handset')) add('hangup', 'nav', 'Hang up the HANDSET', 'handset', 'ctl', 0, 3);
      if (Math.abs(s.hd) > 8) add('trim', 'nav', 'Off course! Turn the COURSE TRIM ' + (s.hd > 0 ? 'up' : 'down') + ' until the needle is in the middle', 'course', 'knob', clamp(g.idx('course') + Math.round(s.hd / 5), 0, 8), Math.abs(s.hd) > 14 ? 6 : 3);
      const cow = g.obs.find((o) => o.type === 1 && o.z > 4 && o.z < 38 && !o.flee && Math.abs(o.x - s.sx) < o.r + 3);
      if (cow) add('cow', 'pilot', 'COW ahead! HONK to scare it away', 'horn', 'tap', 1, 5);
    }
    if (ph === 'approach') {
      if (!g.on('legs') && s.h < 110) add('legs', 'sys', 'Extend the LANDING LEGS!', 'legs', 'ctl', 1, s.h < 70 ? 9 : 8);
      const tg = 1.6 + s.h * 0.04;
      if (s.vs > tg + 1.3 && s.h > 3) add('brake', 'eng', 'TOO FAST! Add throttle to brake! (target speed ' + tg.toFixed(1) + ')', 'throttle', 'lev', Math.min(1, Math.max(0.05, 0.36 + (s.vs - tg) * 0.2)), s.vs > tg + 3 ? 9 : 6);
      else if (s.vs < tg - 1.3 && s.h > 8) add('slowdown', 'eng', 'Too slow - ease off the throttle and let it sink (target speed ' + tg.toFixed(1) + ')', 'throttle', 'lev', 0.1, 3);
      if (this.g.tiltMag() > 9 && s.h < 80) add('steer', 'pilot', 'Level out! Tilt under 10 degrees to land', 'yoke', 'steer', 0, 7);
      if (!s.bags && s.h < 70 && g.help > 0) add('bags', 'sys', 'Optional: press CHEESE AIRBAGS (open the cover first)', 'airbag', 'guard', 1, 2);
      if (Math.abs(s.hd) > 8 && s.h > 60) add('trim', 'nav', 'Off course! Turn the COURSE TRIM ' + (s.hd > 0 ? 'up' : 'down'), 'course', 'knob', clamp(g.idx('course') + Math.round(s.hd / 5), 0, 8), 3);
    }
    if (flying) {
      // global: power, air, breakers, jams, fire, leaks
      if (s.bat < 38 && !(ph === 'approach' && s.h < 30)) add('crank', 'sys', 'BATTERY low - turn the generator crank!', 'crank', 'crank', 75, s.bat < 15 ? 8 : 5);
      if (!g.on('o2gen')) add('o2', 'sys', 'OXYGEN GENERATOR is off!', 'o2gen', 'ctl', 1, 8);
      for (const b of BREAKERS) if (!g.on(b)) add('br_' + b, 'sys', 'Breaker ' + BRNAME[b] + ' tripped - flip it back', b, 'ctl', 1, 7);
      for (const id in g.c) if (g.c[id].jam > 0) add('jam_' + id, L(id).st, L(id).l + ' is JAMMED - whack it with the hammer', id, 'jam', 0, 7);
      for (const f of g.fires) add('fire_' + f.slot, 'any', 'FIRE! Extinguisher: grab it from the rack, then hold the mouse on the flames', '', 'fire', f.slot, 9, { slot: f.slot, hp: f.hp });
      for (const h of g.holes) add('hole_' + h.slot, 'any', 'HOLE in the hull! Patch kit: grab it, then hold the mouse on the hole', '', 'hole', h.slot, 8, { slot: h.slot, hp: h.hp });
    }
    g.needs = N.filter((n) => n.k === 'jam' || !n.c || !g.c[n.c] || g.c[n.c].jam <= 0);
  }

  // ------------------------------------------------------------------ board and screens
  updateBoard() {
    const g = this.g, s = g.ship;
    const b = { title: '', sub: '', items: [] };
    const scr = { pilot: [], eng: [], nav: [], sys: [], call: null, code: null };
    const ph = g.phase;
    if (ph === 'pre') {
      b.title = 'PRE-FLIGHT CHECKLIST';
      b.sub = s.cd > 0 ? 'LAUNCH IN ' + Math.ceil(s.cd) + '...' : 'Check everything, then pull the LAUNCH LEVER';
      for (const it of this.chk) b.items.push([it.easy && g.help > 1 ? it.easy : it.t, it.done ? 1 : 0, typeof it.c === 'function' ? (it.c() || '') : it.c, it.st]);
      for (const it of this.chk) if (it.cross) scr[it.cross.to].push(it.done ? 'done: ' + it.cross.text : it.cross.text);
      scr.eng.push('Fuel A ' + Math.round(s.fa) + '  B ' + Math.round(s.fb)); scr.eng.push('Pressure ' + Math.round(s.pr));
      scr.sys.push('Battery ' + Math.round(s.bat) + '%'); scr.sys.push('Air ' + Math.round(s.air) + '%');
      scr.pilot.push('Pilot: yoke, horn,'); scr.pilot.push('lights, wipers, Auto-Bob');
      scr.nav.push('Navigator: radar,'); scr.nav.push('course, phone, antenna');
    } else if (ph === 'ascent') {
      b.title = 'ASCENT'; b.sub = 'Altitude ' + Math.round(s.alt) + ' / 100';
      b.items.push(['Keep the tilt small (steer with the yoke)', Math.abs(g.tiltMag()) < 14 ? 1 : 0, 'yoke', 'pilot']);
      b.items.push(['MAX-Q at altitude 24-42: throttle at most 75%', s.alt > 42 ? 1 : 0, 'throttle', 'eng']);
      b.items.push(['Drop the booster when it is empty', s.staged ? 1 : 0, 'stage', 'eng']);
      b.items.push(['Keep the engine cool and the pressure up', s.eng === 1 && s.tmp < 90 && s.pr > 30 ? 1 : 0, 'valve', 'eng']);
      scr.pilot.push('MAX-Q (alt 24-42)'); scr.pilot.push('tell the engineer:'); scr.pilot.push('THROTTLE <= 75%');
      scr.eng.push('Booster ' + Math.round(s.bo) + '%'); scr.eng.push(s.staged ? 'Booster dropped' : 'Drop it when empty');
      scr.nav.push('Altitude ' + Math.round(s.alt)); scr.nav.push('Tilt ' + Math.round(g.tiltMag()) + ' deg');
      scr.sys.push('Battery ' + Math.round(s.bat) + '%'); scr.sys.push('Air ' + Math.round(s.air) + '%');
    } else if (ph === 'cruise') {
      const sg = SEG[Math.max(0, this.seg)];
      b.title = 'TO THE MOON: ' + sg.name; b.sub = Math.round(s.trav) + ' / ' + TOTAL + '  megacheese';
      b.items.push(['Dodge the space stuff (yoke, radar calls!)', 0, 'yoke', 'pilot']);
      b.items.push(['Keep the engine cool, the fuel flowing', s.eng === 1 ? 1 : 0, 'valve', 'eng']);
      b.items.push(['Keep the compass needle centered (course trim)', Math.abs(s.hd) < 8 ? 1 : 0, 'course', 'nav']);
      b.items.push(['Charge the battery, fix fires, holes and breakers', 0, 'crank', 'sys']);
      scr.pilot.push('Speed ' + s.spd.toFixed(1)); scr.pilot.push('Lateral ' + Math.round(s.sx) + ' / ' + Math.round(s.sy));
      scr.eng.push('Tank ' + (g.on('feed') ? 'B' : 'A') + ' ' + Math.round(g.tankLevel())); scr.eng.push('Other ' + Math.round(g.on('feed') ? s.fa : s.fb));
      scr.nav.push('Heading ' + Math.round(s.hd) + ' deg');
      if (s.flare === 1) scr.nav.push('FLARE IN ' + Math.ceil(s.flareT));
      scr.sys.push('Battery ' + Math.round(s.bat) + '%'); scr.sys.push('Air ' + Math.round(s.air) + '%');
    } else if (ph === 'approach') {
      b.title = 'LANDING'; b.sub = 'Height ' + Math.round(s.h) + '  Speed ' + s.vs.toFixed(1);
      b.items.push(['Extend the LANDING LEGS', g.on('legs') ? 1 : 0, 'legs', 'sys']);
      b.items.push(['Brake: touchdown speed under 3.5', s.vs < 3.6 ? 1 : 0, 'throttle', 'eng']);
      b.items.push(['Level out: tilt under 10 degrees', g.tiltMag() < 10 ? 1 : 0, 'yoke', 'pilot']);
      b.items.push(['Optional: CHEESE AIRBAGS (speed limit 6.5)', s.bags ? 1 : 0, 'airbag', 'sys']);
      scr.pilot.push('Tilt ' + Math.round(g.tiltMag()) + ' deg'); scr.pilot.push('keep it under 10');
      scr.eng.push('Throttle ' + Math.round(g.c.throttle.v * 100)); scr.eng.push('Brake gently!');
      scr.nav.push('Height ' + Math.round(s.h)); scr.nav.push('Speed ' + s.vs.toFixed(1));
      scr.sys.push('Legs ' + (g.on('legs') ? 'OUT' : 'IN')); scr.sys.push('Airbags ' + (s.bags ? 'READY' : 'no'));
    } else if (ph === 'landed') {
      b.title = 'WE LANDED!'; b.sub = 'Press HATCH on the middle table to party on the Moon';
    } else if (ph === 'moon') {
      b.title = 'MOON PARTY'; b.sub = 'Jump! Dance! Plant the flag!';
    } else if (ph === 'fail') { b.title = 'MISSION FAILED'; b.sub = g.end ? g.end.text : ''; }
    const c = this.call;
    if (c.st === 'ring') scr.call = { st: 'ring', t: Math.round(22 - c.t) };
    else if (c.st === 'talk') { scr.call = { st: 'talk', kind: c.kind, text: c.text, prog: c.prog, need: c.need, left: Math.max(0, Math.round(c.limit - c.t)) }; if (c.kind === 'code') scr.code = c.code.slice(); }
    else if (c.st === 'hang') scr.call = { st: 'hang' };
    g.board = b; g.scr = scr;
  }
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

module.exports = { TOTAL, Director, COLORS, RADAR_RANGES, SEG, BRNAME };
