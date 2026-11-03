'use strict';
// Headless tests: simulation (bots fly the whole mission), fuzz, and the WebSocket protocol.
const assert = require('assert');
const { makeGame, run } = require('./harness');
const { Game } = require('../sim');
const { LAYOUT } = require('../layout');

let passed = 0, failed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log('  ok   ' + name + ' (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}

(async () => {
  console.log('layout');
  await test('layout has unique ids, valid colours, stand points', () => {
    const ids = new Set();
    for (const c of LAYOUT.controls) { assert(!ids.has(c.id), 'duplicate ' + c.id); ids.add(c.id); assert(c.p.length === 3); assert(c.stand.length === 2); assert(c.c >= 0 && c.c < LAYOUT.pal.length, 'colour ' + c.id); }
    for (const p of LAYOUT.props) assert(p.c >= 0 && p.c < LAYOUT.pal.length);
    assert(LAYOUT.controls.length >= 35);
    assert(LAYOUT.fireSlots.length >= 8 && LAYOUT.holeSlots.length >= 4);
    for (const c of LAYOUT.controls) { assert(Math.abs(c.stand[0]) < 5 && Math.abs(c.stand[1]) < 4.5, 'stand outside ' + c.id); }
  });

  console.log('simulation');
  await test('4 bots land the rocket on Easy and Normal (several seeds)', () => {
    for (const diff of [0, 1]) {
      let wins = 0;
      for (let seed = 1; seed <= 4; seed++) { const g = makeGame({ diff, seed: seed * 101 }); run(g, 900); if (g.phase === 'landed') wins++; }
      assert(wins >= 3, 'diff ' + diff + ' only ' + wins + '/4 wins');
    }
  });
  await test('mission takes a sensible time (4-14 minutes)', () => {
    const g = makeGame({ diff: 1, seed: 5 }); run(g, 1500);
    assert.strictEqual(g.phase, 'landed');
    assert(g.t > 240 && g.t < 840, 'time ' + g.t);
  });
  await test('a crew of 3 bots (one station unmanned) can still finish Easy', () => {
    let wins = 0;
    for (let seed = 1; seed <= 4; seed++) { const g = makeGame({ diff: 0, seed: seed * 31, roles: ['pilot', 'eng', 'nav'] }); run(g, 1200); if (g.phase === 'landed') wins++; }
    assert(wins >= 2, 'only ' + wins + '/4 wins with three bots');
  });
  await test('an idle crew fails or stalls but never throws or hangs', () => {
    const g = new Game({ diff: 1, seed: 3 });
    g.addPlayer({ id: 1, name: 'Idle', bot: false, role: 'pilot' });
    for (let i = 0; i < 20000; i++) g.update(0.05);
    assert(['pre', 'fail'].includes(g.phase));
    const s = g.snapshot(); assert(s.t === 's');
  });
  await test('fuzz: random inputs never throw and snapshots stay valid JSON', () => {
    const g = new Game({ diff: 2, seed: 9 });
    for (let i = 1; i <= 4; i++) g.addPlayer({ id: i, name: 'H' + i, bot: false, role: ['pilot', 'eng', 'nav', 'sys'][i - 1] });
    const ids = LAYOUT.controls.map((c) => c.id);
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 40000; i++) {
      const pid = 1 + Math.floor(rnd() * 4);
      const k = rnd();
      if (k < 0.5) g.input(pid, { id: ids[Math.floor(rnd() * ids.length)], v: rnd() < 0.5 ? Math.round(rnd()) : rnd(), x: rnd() * 2 - 1, y: rnd() * 2 - 1, d: rnd() - 0.2, g: rnd() < 0.2 ? 1 : undefined });
      else if (k < 0.55) g.input(pid, { id: 'nonexistent', v: 1 });
      else if (k < 0.6) g.tool(pid, { id: g_pick(['tool_ext', 'tool_patch', 'tool_hammer', 'zzz']), a: rnd() < 0.5 ? 'take' : 'put' });
      else if (k < 0.65) g.use(pid, { k: g_pick(['fire', 'hole', 'jam', 'x']), i: Math.floor(rnd() * 10) });
      else if (k < 0.7) g.playerState(pid, { x: rnd() * 10 - 5, y: 0, z: rnd() * 9 - 4.5, r: rnd() * 360, a: 1, u: 'yoke', zn: 0 });
      else if (k < 0.72) g.chat(pid, Math.floor(rnd() * 12));
      g.update(0.05);
      if (i % 500 === 0) JSON.parse(JSON.stringify(g.snapshot()));
    }
    function g_pick(a) { return a[Math.floor(rnd() * a.length)]; }
  });
  await test('snapshot size stays small (< 8 KB)', () => {
    const g = makeGame({ diff: 2, seed: 4 });
    let max = 0;
    run(g, 600, () => { const n = JSON.stringify(g.snapshot()).length; if (n > max) max = n; });
    assert(max < 8000, 'snapshot ' + max);
  });

  console.log('network');
  const { server, rooms } = require('../server');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const open = (name) => new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const c = { ws, msgs: [], name, waiters: [] };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); c.msgs.push(m); c.waiters = c.waiters.filter((w) => { if (w.f(m)) { w.r(m); return false; } return true; }); };
    ws.onopen = () => resolve(c);
    ws.onerror = (e) => reject(new Error('ws error'));
    c.send = (o) => ws.send(JSON.stringify(o));
    c.wait = (f, ms) => new Promise((res, rej) => { const hit = c.msgs.find(f); if (hit) return res(hit); const to = setTimeout(() => rej(new Error('timeout waiting')), ms || 3000); c.waiters.push({ f, r: (m) => { clearTimeout(to); res(m); } }); });
  });
  await test('create / join / configure / start / play over WebSocket', async () => {
    const a = await open('A'), b = await open('B');
    a.send({ t: 'create', name: 'Alice', crew: 4, diff: 0 });
    const joined = await a.wait((m) => m.t === 'joined');
    assert.strictEqual(joined.code.length, 4); assert(joined.host);
    b.send({ t: 'join', code: joined.code.toLowerCase(), name: 'Bob' });
    const bj = await b.wait((m) => m.t === 'joined');
    assert(!bj.host);
    await a.wait((m) => m.t === 'lobby' && m.players.length === 2);
    b.send({ t: 'role', r: 'pilot' });
    b.send({ t: 'cfg', diff: 2 });                      // not the host: ignored
    a.send({ t: 'cfg', diff: 1, crew: 4 });
    await a.wait((m) => m.t === 'lobby' && m.cfg.diff === 1 && m.players.find((p) => p.name === 'Bob' && p.role === 'pilot'));
    b.send({ t: 'start' });                              // not the host: ignored
    a.send({ t: 'start' });
    const st = await b.wait((m) => m.t === 'start');
    assert(st.layout.controls.length >= 35); assert.strictEqual(st.players.length, 4);
    assert(st.players.filter((p) => p.bot).length === 2);
    const snap = await a.wait((m) => m.t === 's');
    assert(snap.sh && snap.c && snap.pl.length === 4);
    // control input is applied and echoed
    a.send({ t: 'p', x: 0, y: 0, z: 2, r: 0, a: 0, u: '', zn: 0 });
    a.send({ t: 'in', id: 'lights', v: 1 });
    a.msgs.length = 0;
    const s2 = await a.wait((m) => m.t === 's' && m.c.lights === 1, 3000);
    assert.strictEqual(s2.c.lights, 1);
    // garbage does not kill the connection
    a.ws.send('not json'); a.ws.send('{"t":5}'); a.ws.send('{"t":"in","id":"throttle","v":"abc"}');
    a.send({ t: 'ping', ts: 7 });
    const pong = await a.wait((m) => m.t === 'pong'); assert.strictEqual(pong.ts, 7);
    // a leaving human is replaced by a bot, the game continues
    b.ws.close();
    await a.wait((m) => m.t === 'roster' && m.players.filter((p) => p.bot).length === 3, 3000);
    // late joiner takes over a bot
    const c = await open('C');
    c.send({ t: 'join', code: joined.code, name: 'Cathy' });
    await c.wait((m) => m.t === 'start', 3000);
    a.ws.close(); c.ws.close();
    await new Promise((r) => setTimeout(r, 200));
  });
  await test('solo create starts immediately with bots', async () => {
    const a = await open('S');
    a.send({ t: 'create', name: 'Solo', crew: 4, diff: 1, solo: true });
    const st = await a.wait((m) => m.t === 'start');
    assert.strictEqual(st.players.length, 4);
    await a.wait((m) => m.t === 's');
    a.ws.close();
  });
  await test('unknown room code gives an error', async () => {
    const a = await open('E');
    a.send({ t: 'join', code: 'ZZZZ', name: 'x' });
    const e = await a.wait((m) => m.t === 'err'); assert(e.m.length > 3);
    a.ws.close();
  });
  await test('rooms are cleaned up after everybody left', async () => {
    await new Promise((r) => setTimeout(r, 9000));
    assert.strictEqual(rooms.size, 0, 'rooms left: ' + rooms.size);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  server.close();
  process.exit(failed ? 1 : 0);
})();
