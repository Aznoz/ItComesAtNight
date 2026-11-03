'use strict';
const { Game } = require('../sim');
function makeGame(o) {
  const g = new Game({ diff: o.diff || 1, seed: o.seed || 1, help: 2 });
  let id = 1;
  for (const r of (o.roles || ['pilot', 'eng', 'nav', 'sys'])) g.addPlayer({ id: id++, name: 'Bot-' + r, bot: true, role: r });
  return g;
}
function run(g, maxT, hook) {
  const dt = 0.05;
  const log = [];
  let lastPhase = g.phase;
  for (let t = 0; t < maxT && g.phase !== 'fail' && g.phase !== 'moon' ; t += dt) {
    g.update(dt);
    if (hook) hook(g, t);
    const snap = g.snapshot();
    for (const e of snap.ev) if (['say', 'trip', 'fire', 'leak', 'jam', 'hit', 'fail', 'win', 'miss', 'flare', 'seg', 'stage', 'engine', 'liftoff', 'orbit', 'approach', 'touch', 'blackout', 'startfail', 'nope', 'ring', 'calldone', 'hangup', 'out', 'patched', 'unjam'].includes(e.e)) log.push(Math.round(g.t) + 's ' + e.e + ' ' + JSON.stringify(e).slice(0, 110));
    if (g.phase !== lastPhase) { log.push('--- phase ' + lastPhase + ' -> ' + g.phase + ' at ' + Math.round(g.t) + 's'); lastPhase = g.phase; }
    if (g.phase === 'landed') { for (let i = 0; i < 20; i++) g.update(dt); break; }
  }
  return log;
}
module.exports = { makeGame, run };
if (require.main === module) {
  const diff = +process.argv[2] || 1, seed = +process.argv[3] || 1;
  const g = makeGame({ diff, seed });
  const log = run(g, 1500);
  console.log(log.slice(0, +process.argv[4] || 80).join('\n'));
  console.log('RESULT', g.phase, g.end ? g.end.text : '', 'hull', Math.round(g.ship.hull), 't', Math.round(g.t), 'fuel', Math.round(g.ship.fa), Math.round(g.ship.fb), 'bat', Math.round(g.ship.bat));
}
