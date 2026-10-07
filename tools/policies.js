// Stand-in "humans" for the flipped modes: simple strategies a person might use.
// Key format: '<game>:<mode>:<policy>'. Pass the policy name as the 4th argument to sim.js.
module.exports = {
  // Snake: drop the apple in a random valid cell far from the head, by clicking.
  'snake:flipped:random'(inst, api, t) {
    if (Math.floor(t * 60) % 20 === 0) {
      inst.pointerDown(Math.random() * 800, 25 + Math.random() * 575);
    }
  },
  // Splat: alternate gap far up / far down.
  'splat:flipped:swing'(inst, api, t) {
    inst.pointerMove(0, Math.floor(t / 1.6) % 2 ? 80 : 520);
  },
  'splat:flipped:random'(inst, api, t) {
    if (Math.floor(t * 60) % 50 === 0) inst.pointerMove(0, 60 + Math.random() * 480);
  },
  // Asteroids: every ~1.2 s, fling a medium rock from a random point toward the ship.
  'asteroids:flipped:fling'(inst, api, t) {
    if (Math.floor(t * 60) % 72 === 0) {
      inst.keyDown(['Digit1', 'Digit2', 'Digit2'][Math.floor(Math.random() * 3)]);
      const x = Math.random() * 800, y = Math.random() * 600;
      inst.pointerDown(x, y);
      inst.pointerUp(x, y); // plain click lobs it at the ship
    }
  },
  // Missile command: launch at a random city every 0.5s, sometimes MIRV.
  'missile:flipped:spray'(inst, api, t) {
    if (Math.floor(t * 60) % 30 === 0) {
      const cities = [150, 220, 290, 510, 580, 650];
      const tx = cities[Math.floor(Math.random() * 6)];
      const mirv = Math.random() < 0.2;
      inst.pointerDown(Math.random() * 800, 100, mirv ? 2 : 0);
      inst.pointerUp(tx);
    }
  },
  // Invaders fleet: fire from a random column as fast as allowed.
  'invaders:flipped:spam'(inst, api, t) {
    if (Math.floor(t * 60) % 10 === 0) inst.pointerDown(100 + Math.random() * 600);
  },
};
