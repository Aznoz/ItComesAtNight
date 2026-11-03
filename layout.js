'use strict';
// MOON MAYHEM - cockpit layout. One source of truth: the server uses it for reach checks and bots,
// and sends it to every client, which builds the whole cabin from it (props, controls, displays).
// Coordinates are metres. x = right, y = up, z = towards the front window. The cabin is 10 x 9 x 3.6.

const PAL = [
  ['ink', '#2a1d45'], ['white', '#fff8ee'], ['cream', '#ffe9b8'], ['yellow', '#ffd23f'], ['orange', '#ff8a1f'],
  ['red', '#ff4d5a'], ['pink', '#ff7fb5'], ['purple', '#8c5cff'], ['blue', '#3d8bff'], ['sky', '#8cc8ff'],
  ['cyan', '#37d6e8'], ['green', '#3ddc84'], ['lime', '#b7f23a'], ['teal', '#1fb5a0'], ['steel', '#9aa7c2'],
  ['dark', '#4a4568'], ['navy', '#34305e'], ['brown', '#b0703c'], ['skin', '#ffcfa3'], ['glass', '#9eeeff'],
  ['screen', '#10283a'], ['mint', '#a6f0d2'], ['sand', '#ecd39b'], ['grey', '#cdc9dc'], ['black', '#2b2840'],
  ['gold', '#ffb800'], ['magenta', '#e6459d'], ['lav', '#c9b6ff'],
];
const ci = (n) => { const i = PAL.findIndex((p) => p[0] === n); if (i < 0) throw new Error('no colour ' + n); return i; };
const r3 = (v) => Math.round(v * 1000) / 1000;

const ROOM = { hx: 5.0, hz: 4.5, h: 3.6 };

// station frames: front = centre of the console's front edge on the floor, d = direction the operator faces
const ST = {
  pilot: { name: 'PILOT', col: 'blue', front: [0, 3.0], d: [0, 1], depth: 1.5, half: 2.2, stand: [0, 2.05] },
  eng: { name: 'ENGINEER', col: 'orange', front: [3.9, 0], d: [1, 0], depth: 1.1, half: 2.6, stand: [3.0, 0] },
  nav: { name: 'NAVIGATOR', col: 'teal', front: [-3.9, 0], d: [-1, 0], depth: 1.1, half: 2.6, stand: [-3.0, 0] },
  sys: { name: 'SYSTEMS', col: 'purple', front: [0, -3.4], d: [0, -1], depth: 1.1, half: 4.4, stand: [0, -2.45] },
};
const STATIONS = ['pilot', 'eng', 'nav', 'sys'];

function P(st, u, y, w) {
  const f = ST[st], d = f.d, rt = [d[1], -d[0]];
  return [r3(f.front[0] + rt[0] * u + d[0] * w), r3(y), r3(f.front[1] + rt[1] * u + d[1] * w)];
}
function yawOut(st) { const d = ST[st].d; return Math.round(Math.atan2(-d[0], -d[1]) * 180 / Math.PI); }

const props = [];
const controls = [];
const displays = [];
const colliders = []; // [minx, minz, maxx, maxz, height]

function prop(s, p, z, c, o) {
  const e = { s, p: p.map(r3), z: z.map(r3), c: ci(c) };
  if (o) Object.assign(e, o);
  props.push(e);
  return e;
}
// box in a station frame (width along the operator's right, depth towards the wall)
function sbox(st, u, y, w, W, H, D, c, o) {
  const f = ST[st];
  const sw = Math.abs(f.d[0]) > 0 ? [D, H, W] : [W, H, D];
  return prop('rbox', P(st, u, y, w), sw, c, o);
}
function addCollider(st, u0, u1, w0, w1, h) {
  const a = P(st, u0, 0, w0), b = P(st, u1, 0, w1);
  colliders.push([r3(Math.min(a[0], b[0])), r3(Math.min(a[2], b[2])), r3(Math.max(a[0], b[0])), r3(Math.max(a[2], b[2])), h]);
}

function ctl(st, id, k, u, y, w, o) {
  const c = Object.assign({ id, k, st, p: P(st, u, y, w), ry: yawOut(st), l: id.toUpperCase() }, o || {});
  if (c.c) c.c = ci(c.c);
  if (c.c2) c.c2 = ci(c.c2);
  controls.push(c);
  return c;
}
function disp(st, id, look, u, y, w, sz, o) {
  const d = Object.assign({ id, st, look, p: P(st, u, y, w), ry: yawOut(st), sz }, o || {});
  displays.push(d);
  return d;
}

// ------------------------------------------------------------------ the shell of the cabin
prop('rbox', [0, -0.15, 0], [10.4, 0.3, 9.4], 'navy', { o: 0 });                 // floor slab (outline off: it is huge)
for (let ix = -4; ix < 4; ix++) for (let iz = -4; iz < 4; iz++) {
  if ((ix + iz) & 1) continue;                                                      // checker tiles on the floor
  prop('box', [ix * 1.25 + 0.625, 0.01, iz * 1.125 + 0.5625], [1.25, 0.02, 1.125], 'lav', { o: 0 });
}
prop('box', [0, 3.65, 0], [10.4, 0.3, 9.4], 'navy', { o: 0 });                    // ceiling
prop('box', [-5.15, 1.8, 0], [0.3, 3.6, 9.4], 'teal', { o: 0 });                   // left wall
prop('box', [5.15, 1.8, 0], [0.3, 3.6, 9.4], 'teal', { o: 0 });                    // right wall
prop('box', [0, 1.8, -4.65], [10.4, 3.6, 0.3], 'teal', { o: 0 });                  // back wall
prop('box', [0, 0.55, 4.65], [10.4, 1.1, 0.3], 'teal', { o: 0 });                  // front wall below the window
prop('box', [0, 3.4, 4.65], [10.4, 0.4, 0.3], 'teal', { o: 0 });                   // front wall above the window
prop('box', [-4.55, 1.8, 4.65], [1.3, 3.6, 0.3], 'teal', { o: 0 });
prop('box', [4.55, 1.8, 4.65], [1.3, 3.6, 0.3], 'teal', { o: 0 });
// window frame
prop('rbox', [0, 3.22, 4.42], [8.5, 0.18, 0.2], 'yellow');
prop('rbox', [0, 1.06, 4.42], [8.5, 0.18, 0.2], 'yellow');
prop('rbox', [-4.2, 2.14, 4.42], [0.18, 2.3, 0.2], 'yellow');
prop('rbox', [4.2, 2.14, 4.42], [0.18, 2.3, 0.2], 'yellow');
prop('rbox', [-1.4, 2.14, 4.44], [0.1, 2.1, 0.12], 'orange');
prop('rbox', [1.4, 2.14, 4.44], [0.1, 2.1, 0.12], 'orange');
for (let i = 0; i < 9; i++) prop('sph', [-4.05 + i * 1.01, 3.22, 4.3], [0.07], 'cream');
// wall stripes, rivets and pipes
for (const side of [-1, 1]) {
  prop('rbox', [side * 4.97, 1.05, 0], [0.08, 0.1, 9.0], 'yellow');
  prop('rbox', [side * 4.97, 3.2, 0], [0.08, 0.1, 9.0], 'yellow');
  prop('cyl', [side * 4.85, 3.05, -2.6], [0.1, 5.2], 'steel', { r: [90, 0, 0] });
  prop('cyl', [side * 4.85, 2.85, 2.5], [0.07, 4.5], 'orange', { r: [90, 0, 0] });
}
prop('rbox', [0, 1.05, -4.47], [9.0, 0.1, 0.08], 'yellow');
prop('rbox', [0, 3.2, -4.47], [9.0, 0.1, 0.08], 'yellow');
prop('cyl', [-2.5, 3.3, 0], [0.12, 8.6], 'steel', { r: [90, 0, 0] });
prop('cyl', [2.5, 3.3, 0], [0.09, 8.6], 'pink', { r: [90, 0, 0] });
prop('cyl', [0, 3.35, -2], [0.09, 9.6], 'cyan', { r: [0, 0, 90] });
// ceiling lamps
for (const [x, z] of [[-2.6, -2], [2.6, -2], [-2.6, 2], [2.6, 2], [0, 0]]) {
  prop('cyl', [x, 3.43, z], [0.45, 0.12], 'cream');
  prop('cyl', [x, 3.36, z], [0.32, 0.1], 'white', { o: 0 });
}
// decor: cat poster, plants, toy rocket, helmets
prop('rbox', [-4.97, 2.2, -3.2], [0.06, 0.95, 0.7], 'cream');
prop('sph', [-4.93, 2.2, -3.2], [0.22], 'orange');
prop('cone', [-4.93, 2.4, -3.3], [0.07, 0.14], 'orange', { r: [0, 0, 0] });
prop('cone', [-4.93, 2.4, -3.1], [0.07, 0.14], 'orange');
prop('rbox', [4.97, 2.3, -3.0], [0.06, 0.8, 1.1], 'sky');
prop('sph', [4.92, 2.4, -3.2], [0.18], 'yellow');
prop('cyl', [-4.3, 0.28, 3.9], [0.28, 0.56], 'brown');
prop('sph', [-4.3, 0.85, 3.9], [0.34], 'green');
prop('sph', [-4.15, 1.1, 3.9], [0.24], 'lime');
prop('cyl', [4.3, 0.28, 3.9], [0.28, 0.56], 'pink');
prop('cone', [4.3, 1.0, 3.9], [0.28, 0.9], 'green');
prop('sph', [-4.4, 1.28, -3.15], [0.2], 'white');                                  // helmet on the systems console
prop('cyl', [-4.4, 1.15, -3.15], [0.16, 0.12], 'steel');

// ------------------------------------------------------------------ consoles
for (const sid of STATIONS) {
  const f = ST[sid];
  sbox(sid, 0, 0.45, f.depth / 2, f.half * 2, 0.9, f.depth, f.col);                   // body
  sbox(sid, 0, 0.96, f.depth / 2, f.half * 2 + 0.08, 0.1, f.depth + 0.04, 'cream');   // top slab
  sbox(sid, 0, 0.07, 0.12, f.half * 2 - 0.1, 0.14, 0.2, 'navy');                      // toe kick
  addCollider(sid, -f.half, f.half, 0, f.depth, 1.0);
}
// back panels (vertical boards with the gauges)
sbox('pilot', 0, 1.3, 1.4, 4.4, 0.6, 0.18, 'navy');
sbox('eng', 0, 1.6, 1.0, 5.2, 1.3, 0.18, 'navy');
sbox('nav', 0, 1.6, 1.0, 5.2, 1.3, 0.18, 'navy');
sbox('sys', 0, 1.65, 1.0, 8.8, 1.4, 0.18, 'navy');
// station signs
for (const sid of STATIONS) {
  const f = ST[sid];
  const tall = sid === 'pilot' ? 3.5 : 2.5;
  const pos = P(sid, 0, tall, sid === 'pilot' ? 1.45 : 1.0);
  displays.push({ id: 'sign_' + sid, st: sid, look: 'sign', p: pos, ry: yawOut(sid), sz: [1.5, 0.3], text: f.name, c: ci(f.col) });
}

// ------------------------------------------------------------------ PILOT
ctl('pilot', 'yoke', 'stick', 0, 1.02, 0.75, { l: 'YOKE', c: 'red', hint: 'Hold the mouse button and drag to tilt the rocket', r: 0.5 });
ctl('pilot', 'center', 'btn', 0.7, 1.02, 0.45, { l: 'CENTER YOKE', c: 'yellow', hint: 'Click: put the yoke back to the middle' });
ctl('pilot', 'horn', 'btn', -1.65, 1.02, 0.5, { l: 'HORN', c: 'red', look: 'mushroom', hint: 'Hold: HONK! (scares space cows)' });
ctl('pilot', 'lights', 'sw', -1.1, 1.02, 0.5, { l: 'HEADLIGHTS', c: 'yellow', n: 2, hint: 'Click: toggle the headlights' });
ctl('pilot', 'wipers', 'sw', 1.2, 1.02, 0.5, { l: 'WIPERS', c: 'cyan', n: 2, hint: 'Click: toggle the windshield wipers' });
ctl('pilot', 'autop', 'sw', 1.75, 1.02, 0.6, { l: 'AUTO-BOB', c: 'green', n: 2, look: 'lever', hint: 'Click: let Auto-Bob steer (he is not very good)' });
ctl('pilot', 'duck', 'btn', -1.95, 1.55, 1.3, { l: 'RUBBER DUCK', c: 'yellow', look: 'duck', hint: 'Click: squeak!', r: 0.25 });
disp('pilot', 'd_att', 'horizon', -0.6, 1.3, 1.31, [0.46, 0.46], { l: 'TILT' });
disp('pilot', 'd_spd', 'gauge', 0.1, 1.3, 1.31, [0.46, 0.46], { l: 'SPEED', bind: 'spd', max: 3, c: 'cyan' });
disp('pilot', 'd_orders_pilot', 'orders', 1.1, 1.32, 1.31, [1.0, 0.42], { l: 'PILOT SCREEN', scr: 'pilot' });

// ------------------------------------------------------------------ ENGINEER
ctl('eng', 'throttle', 'lev', -2.1, 1.02, 0.22, { l: 'THROTTLE', c: 'red', look: 'slider', ax: 'w', len: 0.5, hint: 'Hold and drag up/down: more or less thrust' });
ctl('eng', 'master', 'sw', -1.45, 1.02, 0.45, { l: 'ENGINE ARM', c: 'orange', n: 2, look: 'key', hint: 'Click: arm the engine' });
ctl('eng', 'start', 'btn', -0.9, 1.02, 0.45, { l: 'START', c: 'green', hint: 'Hold: start the engine (armed, fuel pressure needed)' });
ctl('eng', 'pump', 'lev', -0.25, 1.02, 0.5, { l: 'FUEL PUMP', c: 'steel', look: 'pump', ax: 'y', len: 0.5, hint: 'Hold and drag up/down again and again to pump fuel pressure' });
ctl('eng', 'feed', 'sw', 0.45, 1.02, 0.45, { l: 'FUEL FEED A/B', c: 'blue', n: 2, hint: 'Click: switch between fuel tank A and B' });
ctl('eng', 'turbo', 'btn', 1.25, 1.02, 0.45, { l: 'TURBO', c: 'red', guard: 1, hint: 'Click the cover, then hold the button: extra speed, very hot' });
ctl('eng', 'stage', 'btn', 1.95, 1.02, 0.45, { l: 'DROP BOOSTER', c: 'orange', guard: 1, hint: 'Click the cover, then press: drops the empty booster' });
ctl('eng', 'valve', 'knob', 1.0, 1.3, 0.84, { l: 'COOLANT VALVE', c: 'cyan', n: 5, look: 'valve', hint: 'Drag left/right or scroll: coolant flow 0-4' });
disp('eng', 'd_fa', 'gauge', -2.0, 1.85, 0.88, [0.5, 0.5], { l: 'FUEL A', bind: 'fa', max: 100, c: 'green' });
disp('eng', 'd_fb', 'gauge', -1.35, 1.85, 0.88, [0.5, 0.5], { l: 'FUEL B', bind: 'fb', max: 100, c: 'green' });
disp('eng', 'd_bo', 'gauge', -0.7, 1.85, 0.88, [0.5, 0.5], { l: 'BOOSTER', bind: 'bo', max: 100, c: 'orange' });
disp('eng', 'd_pr', 'gauge', -0.05, 1.85, 0.88, [0.5, 0.5], { l: 'PRESSURE', bind: 'pr', max: 100, c: 'cyan', lo: 25 });
disp('eng', 'd_tmp', 'gauge', 0.6, 1.85, 0.88, [0.5, 0.5], { l: 'TEMP', bind: 'tmp', max: 120, c: 'red', hi: 80, lo: 15 });
disp('eng', 'd_thr', 'gauge', 1.25, 1.85, 0.88, [0.5, 0.5], { l: 'THRUST', bind: 'thr', max: 145, c: 'yellow' });
disp('eng', 'd_orders_eng', 'orders', 2.0, 1.85, 0.88, [0.95, 0.48], { l: 'ENGINEER SCREEN', scr: 'eng' });

// ------------------------------------------------------------------ NAVIGATOR
ctl('nav', 'range', 'knob', -1.9, 1.02, 0.5, { l: 'RADAR RANGE', c: 'green', n: 4, hint: 'Drag left/right or scroll: radar range 1-4' });
ctl('nav', 'course', 'knob', -1.2, 1.02, 0.5, { l: 'COURSE TRIM', c: 'yellow', n: 9, hint: 'Drag left/right or scroll: keep the compass needle in the middle' });
ctl('nav', 'handset', 'sw', 0.55, 1.02, 0.5, { l: 'HANDSET', c: 'red', n: 2, look: 'handset', hint: 'Click: pick up / hang up the phone' });
ctl('nav', 'antenna', 'sw', 1.55, 1.02, 0.6, { l: 'ANTENNA', c: 'cyan', n: 2, look: 'lever', hint: 'Click: raise / lower the antenna (needed for calls)' });
disp('nav', 'd_compass', 'compass', -1.55, 1.6, 0.88, [0.7, 0.7], { l: 'COMPASS' });
disp('nav', 'd_radar', 'radar', -0.2, 1.62, 0.88, [1.45, 1.0], { l: 'RADAR' });
disp('nav', 'd_alt', 'alt', 1.25, 1.62, 0.88, [0.85, 0.9], { l: 'ALTITUDE' });
disp('nav', 'd_orders_nav', 'orders', 2.1, 1.62, 0.88, [0.7, 0.9], { l: 'NAVIGATOR SCREEN', scr: 'nav' });

// ------------------------------------------------------------------ SYSTEMS
const BR = [['br_radar', 'RADAR'], ['br_shield', 'SHIELD'], ['br_lights', 'LIGHTS'], ['br_engine', 'ENGINE'], ['br_comms', 'COMMS'], ['br_autop', 'AUTO-BOB']];
BR.forEach((b, i) => {
  ctl('sys', b[0], 'sw', -2.7 + (i % 3) * 0.55, 1.45 + Math.floor(i / 3) * 0.5, 0.88, { l: 'BREAKER ' + b[1], c: 'red', n: 2, look: 'breaker', hint: 'Click: flip the breaker back on', r: 0.2 });
});
ctl('sys', 'crank', 'crank', -3.5, 1.02, 0.55, { l: 'GENERATOR CRANK', c: 'yellow', hint: 'Hold and move the mouse in circles to charge the battery', r: 0.5 });
ctl('sys', 'o2gen', 'sw', -1.0, 1.02, 0.5, { l: 'OXYGEN GENERATOR', c: 'mint', n: 2, hint: 'Click: oxygen generator on / off' });
ctl('sys', 'shield', 'sw', -0.4, 1.02, 0.5, { l: 'SHIELD', c: 'sky', n: 2, hint: 'Click: raise / lower the shield (uses battery)' });
ctl('sys', 'disco', 'sw', 0.2, 1.02, 0.5, { l: 'DISCO!', c: 'magenta', n: 2, hint: 'Click: party lights (more fun = more stars)' });
ctl('sys', 'radio', 'knob', 0.8, 1.02, 0.5, { l: 'RADIO', c: 'pink', n: 4, hint: 'Drag or scroll: change the music' });
ctl('sys', 'legs', 'sw', 1.75, 1.02, 0.6, { l: 'LANDING LEGS', c: 'orange', n: 2, look: 'lever', hint: 'Click: extend / retract the landing legs' });
ctl('sys', 'airbag', 'btn', 2.55, 1.02, 0.5, { l: 'CHEESE AIRBAGS', c: 'yellow', guard: 1, hint: 'Click the cover, then press: inflate the cheese airbags' });
for (const [id, c, u, y, name] of [['kp_red', 'red', 0.7, 1.9, 'RED'], ['kp_green', 'green', 1.2, 1.9, 'GREEN'], ['kp_blue', 'blue', 0.7, 1.45, 'BLUE'], ['kp_yellow', 'yellow', 1.2, 1.45, 'YELLOW']])
  ctl('sys', id, 'btn', u, y, 0.88, { l: 'KEYPAD ' + name, c, look: 'padbtn', hint: 'Click: press the colour button', r: 0.2 });
disp('sys', 'd_bat', 'gauge', -0.9, 1.9, 0.88, [0.5, 0.5], { l: 'BATTERY', bind: 'bat', max: 100, c: 'yellow', lo: 20 });
disp('sys', 'd_air', 'gauge', -0.25, 1.9, 0.88, [0.5, 0.5], { l: 'OXYGEN', bind: 'air', max: 100, c: 'mint', lo: 25 });
disp('sys', 'd_hull', 'gauge', 0.4, 1.9, 0.88, [0.5, 0.5], { l: 'HULL', bind: 'hull', max: 100, c: 'orange', lo: 30 });
disp('sys', 'd_orders_sys', 'orders', -2.0, 1.97, 0.88, [1.15, 0.38], { l: 'SYSTEMS SCREEN', scr: 'sys' });
// tool rack on the back panel (the tools are separate pick-up objects)
prop('rbox', [-3.25, 1.6, -4.25], [1.4, 0.7, 0.14], 'dark');
const TOOLS = [
  { id: 'tool_ext', l: 'FIRE EXTINGUISHER', c: 'red', home: [-3.65, 1.62, -4.12], hint: 'Click: pick up. Then hold the mouse on a fire!' },
  { id: 'tool_patch', l: 'PATCH KIT', c: 'orange', home: [-3.2, 1.62, -4.12], hint: 'Click: pick up. Then hold the mouse on a hole!' },
  { id: 'tool_hammer', l: 'HAMMER', c: 'yellow', home: [-2.75, 1.62, -4.12], hint: 'Click: pick up. Then click a jammed control!' },
];

// ------------------------------------------------------------------ CENTRE
prop('cyl', [0, 0.45, 0], [0.95, 0.9], 'sand');
prop('cyl', [0, 0.93, 0], [1.05, 0.08], 'cream');
prop('cyl', [0, 1.45, 0], [0.18, 1.2], 'steel');
prop('rbox', [0, 2.45, 0], [0.5, 0.15, 0.5], 'dark');
colliders.push([-0.9, -0.9, 0.9, 0.9, 1.0]);
controls.push(Object.assign({ id: 'launch', k: 'sw', st: 'mid', p: [0, 0.97, 0.5], ry: 0, l: 'LAUNCH LEVER', c: ci('red'), n: 2, look: 'lever', hint: 'Click: pull the launch lever (when the checklist is done)' }));
controls.push({ id: 'coffee', k: 'btn', st: 'mid', p: [-0.55, 0.97, -0.35], ry: 0, l: 'COFFEE', c: ci('brown'), look: 'mug', hint: 'Click: coffee! (morale +)', r: 0.25 });
controls.push({ id: 'hatch', k: 'btn', st: 'mid', p: [0.55, 0.97, -0.35], ry: 0, l: 'HATCH', c: ci('green'), hint: 'Click: open the hatch (after landing) and party on the Moon' });
for (let i = 0; i < 4; i++) {
  const a = i * 90, dx = Math.sin(a * Math.PI / 180), dz = Math.cos(a * Math.PI / 180);
  displays.push({ id: 'board' + i, st: 'mid', look: 'board', p: [r3(dx * 0.3), 1.95, r3(dz * 0.3)], ry: a, sz: [1.5, 0.95], l: 'MISSION BOARD' });
}

// ------------------------------------------------------------------ incident slots and navigation
const fireSlots = [
  [-1.6, 0, 1.5], [1.7, 0, 1.3], [-2.2, 0, -1.2], [2.3, 0, -1.4], [0, 0, -2.0], [-0.9, 0, 2.5],
  [3.1, 0, 1.9], [-3.1, 0, -1.9], [3.2, 0, -2.2], [-3.2, 0, 2.0],
].map((p) => p.map(r3));
const holeSlots = [
  { p: [-4.93, 2.3, 1.2], ry: 90 }, { p: [-4.93, 1.9, -1.6], ry: 90 }, { p: [4.93, 2.4, 1.0], ry: -90 },
  { p: [4.93, 2.0, -1.8], ry: -90 }, { p: [-2.4, 2.4, -4.43], ry: 0 }, { p: [2.2, 2.2, -4.43], ry: 0 },
].map((h) => ({ p: h.p.map(r3), ry: h.ry }));
const ring = [];
for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ring.push([r3(Math.sin(a) * 2.0), r3(Math.cos(a) * 2.0)]); }
const spawns = [[-1.4, 1.2, 0], [1.4, 1.2, 0], [-1.4, -1.2, 0], [1.4, -1.2, 0]];

// stand point (floor) for a control = nearest point in the free floor area in front of it
function standFor(c) {
  if (c.st === 'mid') return [r3(c.p[0] + Math.sin(0) * 0), r3(c.p[2] + (c.p[2] >= 0 ? 1.15 : -1.15))];
  const f = ST[c.st], d = f.d, rt = [d[1], -d[0]];
  const u = (c.p[0] - f.front[0]) * rt[0] + (c.p[2] - f.front[1]) * rt[1];
  return [r3(f.front[0] - d[0] * 0.85 + rt[0] * u), r3(f.front[1] - d[1] * 0.85 + rt[1] * u)];
}
controls.forEach((c) => { c.stand = standFor(c); });
for (const t of TOOLS) { t.stand = [r3(t.home[0]), -3.1]; }

const LAYOUT = {
  v: 1,
  room: ROOM,
  pal: PAL.map((p) => p[1]),
  palNames: PAL.map((p) => p[0]),
  stations: STATIONS.map((id) => ({ id, name: ST[id].name, col: ci(ST[id].col), stand: ST[id].stand, ry: Math.round(Math.atan2(ST[id].d[0], ST[id].d[1]) * 180 / Math.PI) })),
  props, controls, displays, tools: TOOLS.map((t) => Object.assign({}, t, { c: ci(t.c) })),
  colliders, fireSlots, holeSlots, ring, spawns,
  window: { p: [0, 2.14, 4.5], sz: [8.2, 2.1] },
};

module.exports = { LAYOUT, ST, STATIONS, PAL, ci, P };
