const { makeGame, run } = require('./harness');
const roles = (process.argv[4] || 'pilot,eng,nav,sys').split(',');
const res = {};
for (const diff of [0, 1, 2]) {
  let win = 0, times = [], reasons = {}, hulls = [];
  const N = +process.argv[2] || 8;
  for (let seed = 1; seed <= N; seed++) {
    const g = makeGame({ diff, seed: seed * 7919, roles });
    run(g, 1200);
    if (g.phase === 'landed') { win++; times.push(Math.round(g.t)); hulls.push(Math.round(g.ship.hull)); }
    else { const r = g.end ? g.end.reason : 'timeout:' + g.phase; reasons[r] = (reasons[r] || 0) + 1; }
  }
  console.log(['Easy', 'Normal', 'Chaos'][diff], 'wins', win + '/' + N, 'times', times.join(','), 'hull', hulls.join(','), 'fails', JSON.stringify(reasons));
}
