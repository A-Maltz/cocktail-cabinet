// Headless runner: loads the real engine + game files and steps them with a stub canvas, so the
// computer players can be tested for crashes and balance without a browser.
//
// usage:  node tools/sim.js <gameId> <classic|flipped|demo> [seconds=600] [policy]
// e.g.    node tools/sim.js splat flipped 900 swing
// Prints every banner (round won/lost, waves...) and the final result.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
const [gameId, mode, secs = '600', policy = 'none'] = process.argv.slice(2);
const stubCtx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })),
  set: (t, k, v) => { t[k] = v; return true; },
});
const sandbox = { window: {}, console, performance, Math, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/cabinet.js', `js/games/${gameId}.js`]) {
  vm.runInContext(fs.readFileSync(path.join(repo, f), 'utf8'), sandbox, { filename: f });
}
const C = sandbox.Cabinet;
const def = C.games.find((g) => g.id === gameId);

let timers = [], ended = null, flashes = [], t = 0;
const keys = new Set(), pressed = new Set();
const api = {
  W: 800, H: 600, U: C.U, Draw: C.Draw, mode,
  sfx: new Proxy({}, { get: () => () => {} }),
  keys, mouse: { x: 400, y: 300, down: false },
  pressed: (c) => pressed.has(c),
  after: (s, fn) => timers.push({ t: s, fn }),
  flash: (text) => flashes.push(`[${t.toFixed(1)}s] ${text}`),
  end: (r) => { if (!ended) ended = { ...r, t }; },
  best: () => 0,
};
api.Rounds = (o) => C.Rounds(api, o);
const inst = def.create(api);
const policies = require('./policies.js');
const human = policies[`${gameId}:${mode}:${policy}`];

const dt = 1 / 60;
const N = Number(secs) * 60;
for (let i = 0; i < N && !ended; i++) {
  t = i * dt;
  if (human) human(inst, api, t, keys, pressed);
  inst.update(dt);
  pressed.clear();
  for (let j = timers.length - 1; j >= 0; j--) {
    timers[j].t -= dt;
    if (timers[j].t <= 0) { const tm = timers.splice(j, 1)[0]; tm.fn(); }
  }
  if (i % 30 === 0) inst.draw(stubCtx);
}
console.log(`${gameId}/${mode}/${policy}: ran ${t.toFixed(0)}s`);
console.log(flashes.slice(0, 60).join('\n'));
if (flashes.length > 60) console.log(`... (${flashes.length} banners total)`);
console.log('END:', JSON.stringify(ended));
