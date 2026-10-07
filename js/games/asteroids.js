/*
 * ASTEROIDS
 *   Sides: the Ship (shoot rocks, don't get hit) and the Sender (decides what rocks fly in, from
 *   where, how fast and at what angle).
 *   classic — you fly, a computer "director" sends waves of asteroids at you.
 *   flipped — you sling asteroids (drag to aim), the computer flies the ship.
 *
 * Ship AI: every think-tick it computes, for each rock, the time and distance of closest approach.
 * If a rock will pass too close soon, it turns away and thrusts; otherwise it picks the nearest rock,
 * leads it (solving for where a bullet will meet it) and fires when lined up. Low levels think less
 * often, aim worse and sometimes miss a threat; it never sees anything you can't.
 */
(function () {
  'use strict';
  const { U, Draw } = Cabinet;

  const W = 800, H = 600;
  const SHIP_R = 12, ROT = 4.6, THRUST = 280, DRAG = 0.5, MAX_V = 360;
  const BULLET_V = 540, BULLET_LIFE = 0.85, MAX_BULLETS = 4, FIRE_CD = 0.2;
  const SIZES = { 3: { r: 42, pts: 20, cost: 3 }, 2: { r: 24, pts: 50, cost: 2 }, 1: { r: 13, pts: 100, cost: 1 } };
  const ROUND_TIME = 45, SAFE_LAUNCH = 170;

  // Shortest signed difference on a wrapping axis.
  const wd = (d, m) => { d = U.wrap(d + m / 2, m) - m / 2; return d; };
  const tdist = (ax, ay, bx, by) => Math.hypot(wd(ax - bx, W), wd(ay - by, H));

  function makeRock(size, x, y, vx, vy) {
    const n = 10, shape = [];
    for (let i = 0; i < n; i++) shape.push(U.rand(0.72, 1.12));
    return { size, r: SIZES[size].r, x, y, vx, vy, shape, rot: U.rand(0, 6.28), spin: U.rand(-1, 1), id: Math.random() };
  }

  Cabinet.register({
    id: 'asteroids',
    title: 'Asteroids',
    color: '#4ff3ff',
    tagline: 'Thrust, turn, shoot. Space is full of rocks.',
    flip: 'you throw the asteroids, the computer flies.',
    modes: [
      { id: 'classic', you: 'Ship', cpu: 'Asteroid sender',
        how: 'Left/Right (or A/D) turn, Up/W thrusts, Space fires. The computer sends each wave: big slow rocks at first, then faster, aimed, smaller ones. 3 lives.' },
      { id: 'flipped', you: 'Asteroid sender', cpu: 'Ship',
        how: 'Press 1 / 2 / 3 (or Q to cycle) to choose a size. Drag from anywhere at least 170px from the ship and release to fling a rock (a plain click lobs it at the ship). Rocks cost energy. Destroy the ship 3 times within 45 seconds to win the round. 3 hearts.' },
      { id: 'demo', you: 'Spectator', cpu: 'Ship and sender', how: 'The computer plays both sides.' },
    ],

    create(api) {
      const mode = api.mode;
      const cpuShip = mode !== 'classic';
      const cpuSender = mode !== 'flipped';
      const rounds = mode === 'flipped' ? api.Rounds({ next: () => newRound() }) : null;

      let ship, rocks = [], bullets = [], parts = [], score = 0, lives = 3, wave = 1;
      let budget = 0, spawnT = 0, waveT = 0, roundT = ROUND_TIME, over = false;
      let energy = 6, selSize = 2, drag = null;
      const brain = { t: 0, turn: 0, thrust: false, fire: false, seen: new Map() };

      const level = () => (rounds ? rounds.level : wave);
      const shipSkill = (L) => ({
        think: Math.max(0.03, 0.22 - 0.035 * (L - 1)),
        jitter: Math.max(0.02, 0.22 - 0.035 * (L - 1)),
        horizon: Math.min(1.5, 0.55 + 0.17 * (L - 1)),
        notice: Math.min(1, 0.45 + 0.15 * (L - 1)), // chance it notices a given threat
        lead: L >= 2,
      });

      function newShip() {
        ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, cd: 0, inv: 2.5, alive: true, thrust: false, respawn: 0 };
      }
      function newRound() {
        rocks = []; bullets = []; lives = 3; roundT = ROUND_TIME; energy = 6;
        brain.seen.clear();
        newShip();
      }
      function startWave(w) {
        wave = w;
        budget = 6 + 3 * w;
        spawnT = 1.2;
      }

      // ------------------------------------------------ the computer sender ("director")
      function directorSpawn() {
        const w = level();
        const roll = Math.random();
        const pSmall = Math.min(0.35, 0.04 * (w - 1)), pMed = Math.min(0.45, 0.15 + 0.05 * (w - 1));
        let size = roll < pSmall ? 1 : roll < pSmall + pMed ? 2 : 3;
        while (SIZES[size].cost > budget) size--;
        if (size < 1) return;
        const r = SIZES[size].r;
        // Choose an off-screen edge point far from the ship.
        let x, y, tries = 0;
        do {
          const e = U.randi(0, 3);
          x = e === 0 ? -r : e === 1 ? W + r : U.rand(0, W);
          y = e === 2 ? -r : e === 3 ? H + r : U.rand(0, H);
        } while (tries++ < 10 && tdist(x, y, ship.x, ship.y) < 230);
        const spd = { 3: U.rand(45, 75), 2: U.rand(75, 115), 1: U.rand(110, 150) }[size] * Math.min(1.6, 1 + 0.06 * (w - 1));
        // Aim at the ship (leading it at higher waves), with a spread that tightens each wave.
        const lead = w >= 3 ? tdist(x, y, ship.x, ship.y) / spd * 0.6 : 0;
        const tx = ship.x + ship.vx * lead, ty = ship.y + ship.vy * lead;
        const spread = Math.max(0.1, 0.9 - 0.1 * (w - 1));
        const ang = Math.atan2(wd(ty - y, H), wd(tx - x, W)) + U.rand(-spread, spread);
        rocks.push(makeRock(size, x, y, Math.cos(ang) * spd, Math.sin(ang) * spd));
        budget -= SIZES[size].cost;
      }
      function fieldMass() { return rocks.reduce((s, r) => s + SIZES[r.size].cost, 0); }

      // ------------------------------------------------ the human sender
      const launchOk = (x, y) => tdist(x, y, ship.x, ship.y) >= SAFE_LAUNCH;
      const maxSpeed = (size) => ({ 3: 110, 2: 165, 1: 230 })[size];
      function launch(x0, y0, x1, y1) {
        const cost = SIZES[selSize].cost;
        if (energy < cost || !launchOk(x0, y0) || fieldMass() + cost > 16) { api.sfx.hit(); return; }
        let vx = (x1 - x0) * 1.6, vy = (y1 - y0) * 1.6;
        let sp = Math.hypot(vx, vy);
        if (sp < 25) {
          // plain click: lob it at where the ship is now, at 60% speed
          const a = Math.atan2(wd(ship.y - y0, H), wd(ship.x - x0, W));
          sp = maxSpeed(selSize) * 0.6;
          vx = Math.cos(a) * sp; vy = Math.sin(a) * sp;
        } else if (sp > maxSpeed(selSize)) {
          vx *= maxSpeed(selSize) / sp; vy *= maxSpeed(selSize) / sp;
        }
        rocks.push(makeRock(selSize, x0, y0, vx, vy));
        energy -= cost;
        api.sfx.blip();
      }

      // ------------------------------------------------ the computer ship
      function shipBrain(dt) {
        brain.t -= dt;
        if (brain.t > 0) return;
        const sk = shipSkill(level());
        brain.t = sk.think;
        brain.thrust = false;
        brain.fire = false;

        // 1) Threats: closest approach of each rock relative to the ship.
        let threat = null, threatT = Infinity, threatC = null;
        for (const r of rocks) {
          const dx = wd(r.x - ship.x, W), dy = wd(r.y - ship.y, H);
          const vx = r.vx - ship.vx, vy = r.vy - ship.vy;
          const v2 = vx * vx + vy * vy || 1e-6;
          const tca = Math.max(0, -(dx * vx + dy * vy) / v2);
          const cx = dx + vx * tca, cy = dy + vy * tca;
          if (Math.hypot(cx, cy) < r.r + SHIP_R + 16 && tca < sk.horizon && tca < threatT) {
            // Decide once per rock whether this pilot notices it at all.
            if (!brain.seen.has(r.id)) brain.seen.set(r.id, U.chance(sk.notice));
            if (!brain.seen.get(r.id)) continue;
            threat = r; threatT = tca; threatC = { x: cx, y: cy, dx, dy };
          }
        }
        let want;
        if (threat) {
          // Move away from where the rock will be at closest approach.
          const len = Math.hypot(threatC.x, threatC.y);
          want = len > 4 ? Math.atan2(-threatC.y, -threatC.x) : Math.atan2(threat.vx, -threat.vy);
          const off = Math.abs(U.angDiff(ship.a, want));
          brain.thrust = off < 0.7;
          // If the rock is roughly in front of us, shoot it too.
          const toRock = Math.atan2(threatC.dy, threatC.dx);
          if (Math.abs(U.angDiff(ship.a, toRock)) < 0.25) brain.fire = true;
        } else {
          // 2) Hunt: nearest rock, leading it.
          let tgt = null, best = Infinity;
          for (const r of rocks) {
            const d = tdist(r.x, r.y, ship.x, ship.y) - r.r;
            if (d < best) { best = d; tgt = r; }
          }
          const speed = Math.hypot(ship.vx, ship.vy);
          if (tgt) {
            let dx = wd(tgt.x - ship.x, W), dy = wd(tgt.y - ship.y, H);
            if (sk.lead) {
              const rvx = tgt.vx - ship.vx, rvy = tgt.vy - ship.vy;
              let t = Math.hypot(dx, dy) / BULLET_V;
              for (let i = 0; i < 3; i++) {
                const px = dx + rvx * t, py = dy + rvy * t;
                t = Math.hypot(px, py) / BULLET_V;
              }
              dx += rvx * t; dy += rvy * t;
            }
            const d = Math.hypot(dx, dy);
            want = Math.atan2(dy, dx) + U.rand(-sk.jitter, sk.jitter);
            const tol = Math.max(0.05, Math.atan2(tgt.r * 0.8, d));
            if (Math.abs(U.angDiff(ship.a, want)) < tol && d < BULLET_V * BULLET_LIFE + tgt.r) brain.fire = true;
          } else if (speed > 30) {
            want = Math.atan2(-ship.vy, -ship.vx); // nothing to shoot: brake
            brain.thrust = Math.abs(U.angDiff(ship.a, want)) < 0.3;
          }
          if (speed > 230 && !brain.fire) {
            want = Math.atan2(-ship.vy, -ship.vx);
            brain.thrust = Math.abs(U.angDiff(ship.a, want)) < 0.3;
          }
        }
        brain.turn = want === undefined ? 0 : U.clamp(U.angDiff(ship.a, want) * 6, -1, 1);
      }

      // ------------------------------------------------ shared physics
      function fire() {
        if (ship.cd > 0 || bullets.length >= MAX_BULLETS) return;
        ship.cd = FIRE_CD;
        bullets.push({
          x: ship.x + Math.cos(ship.a) * SHIP_R, y: ship.y + Math.sin(ship.a) * SHIP_R,
          vx: Math.cos(ship.a) * BULLET_V + ship.vx, vy: Math.sin(ship.a) * BULLET_V + ship.vy, t: BULLET_LIFE,
        });
        api.sfx.shoot();
      }
      function burst(x, y, n, color) {
        for (let i = 0; i < n; i++) {
          const a = U.rand(0, 6.28), s = U.rand(40, 200);
          parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: U.rand(0.4, 0.9), color });
        }
      }
      function breakRock(i) {
        const r = rocks[i];
        rocks.splice(i, 1);
        score += SIZES[r.size].pts;
        burst(r.x, r.y, 8 + r.size * 4, '#bbb');
        api.sfx.pop();
        if (r.size > 1) {
          for (let k = 0; k < 2; k++) {
            const a = Math.atan2(r.vy, r.vx) + U.rand(-1.1, 1.1);
            const s = Math.hypot(r.vx, r.vy) * U.rand(1.1, 1.5) + 20;
            rocks.push(makeRock(r.size - 1, r.x, r.y, Math.cos(a) * s, Math.sin(a) * s));
          }
        }
      }
      function shipHit() {
        ship.alive = false;
        ship.respawn = 1.6;
        burst(ship.x, ship.y, 30, '#4ff3ff');
        api.sfx.boom();
        lives--;
        if (lives > 0) return;
        if (mode === 'classic') {
          over = true;
          api.after(1.2, () => api.end({ title: 'GAME OVER', score, lines: [`Score ${score}`, `Reached wave ${wave}`] }));
        } else if (rounds) {
          rounds.win('Ship destroyed 3 times!');
        } else {
          api.flash('Ship lost. Restarting.', 1.4);
          api.after(1.5, () => { rocks = []; lives = 3; score = 0; startWave(1); newShip(); });
        }
      }

      newShip();
      startWave(1);

      return {
        keyDown(code) {
          if (cpuSender) return;
          if (code === 'Digit1') selSize = 1;
          if (code === 'Digit2') selSize = 2;
          if (code === 'Digit3') selSize = 3;
        },
        pointerDown(x, y) { if (!cpuSender) drag = { x0: x, y0: y, x1: x, y1: y }; },
        pointerMove(x, y) { if (drag) { drag.x1 = x; drag.y1 = y; } },
        pointerUp(x, y) {
          if (!drag) return;
          if (!(rounds && rounds.busy)) launch(drag.x0, drag.y0, x, y);
          drag = null;
        },
        update(dt) {
          if (over) return;
          if (rounds && rounds.busy) { drag = null; return; }
          if (!cpuSender) {
            energy = Math.min(10, energy + 1.15 * dt);
            if (api.pressed('KeyQ')) selSize = selSize % 3 + 1;
          }

          // Ship control
          if (ship.alive) {
            let turn = 0, thrust = false, wantFire = false;
            if (cpuShip) {
              shipBrain(dt);
              turn = brain.turn; thrust = brain.thrust; wantFire = brain.fire;
            } else {
              const k = api.keys;
              if (k.has('ArrowLeft') || k.has('KeyA')) turn -= 1;
              if (k.has('ArrowRight') || k.has('KeyD')) turn += 1;
              thrust = k.has('ArrowUp') || k.has('KeyW');
              wantFire = api.pressed('Space') || (k.has('Space') && ship.cd <= 0 && bullets.length < 2);
            }
            ship.a += turn * ROT * dt;
            ship.thrust = thrust;
            if (thrust) { ship.vx += Math.cos(ship.a) * THRUST * dt; ship.vy += Math.sin(ship.a) * THRUST * dt; }
            ship.vx *= 1 - DRAG * dt; ship.vy *= 1 - DRAG * dt;
            const sp = Math.hypot(ship.vx, ship.vy);
            if (sp > MAX_V) { ship.vx *= MAX_V / sp; ship.vy *= MAX_V / sp; }
            ship.x = U.wrap(ship.x + ship.vx * dt, W);
            ship.y = U.wrap(ship.y + ship.vy * dt, H);
            ship.cd -= dt;
            ship.inv -= dt;
            if (wantFire) fire();
          } else if (lives > 0) {
            ship.respawn -= dt;
            const clear = rocks.every((r) => tdist(r.x, r.y, W / 2, H / 2) > r.r + 110);
            if (ship.respawn <= 0 && (clear || ship.respawn < -2)) { newShip(); brain.seen.clear(); }
          }

          for (const r of rocks) {
            r.x = U.wrap(r.x + r.vx * dt + r.r, W + 2 * r.r) - r.r;
            r.y = U.wrap(r.y + r.vy * dt + r.r, H + 2 * r.r) - r.r;
            r.rot += r.spin * dt;
          }
          for (const b of bullets) { b.x = U.wrap(b.x + b.vx * dt, W); b.y = U.wrap(b.y + b.vy * dt, H); b.t -= dt; }
          bullets = bullets.filter((b) => b.t > 0);
          for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt; }
          parts = parts.filter((p) => p.t > 0);

          // Collisions
          for (let bi = bullets.length - 1; bi >= 0; bi--) {
            const b = bullets[bi];
            const ri = rocks.findIndex((r) => tdist(r.x, r.y, b.x, b.y) < r.r);
            if (ri >= 0) { bullets.splice(bi, 1); breakRock(ri); }
          }
          if (ship.alive && ship.inv <= 0) {
            const ri = rocks.findIndex((r) => tdist(r.x, r.y, ship.x, ship.y) < r.r * 0.9 + SHIP_R * 0.8);
            if (ri >= 0) { breakRock(ri); shipHit(); }
          }

          // Sender side
          if (cpuSender) {
            spawnT -= dt;
            if (budget > 0 && spawnT <= 0 && fieldMass() < 8 + 2 * level()) {
              directorSpawn();
              spawnT = Math.max(0.7, 2.6 - 0.18 * level());
            }
            if (budget <= 0 && rocks.length === 0 && ship.alive) {
              waveT += dt;
              if (waveT > 1) { waveT = 0; api.flash(`WAVE ${wave + 1}`, 1.2, '#4ff3ff'); startWave(wave + 1); }
            }
          }
          if (rounds && !rounds.busy) {
            roundT -= dt;
            if (roundT <= 0) rounds.lose('The ship survived 45 seconds.');
          }
        },
        draw(ctx) {
          ctx.fillStyle = '#02030a';
          ctx.fillRect(0, 0, W, H);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#e8e8f0';
          for (const r of rocks) {
            ctx.beginPath();
            r.shape.forEach((m, i) => {
              const a = r.rot + (i / r.shape.length) * Math.PI * 2;
              const px = r.x + Math.cos(a) * r.r * m, py = r.y + Math.sin(a) * r.r * m;
              if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
            });
            ctx.closePath();
            ctx.stroke();
          }
          ctx.fillStyle = '#fff';
          for (const b of bullets) ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3);
          for (const p of parts) { ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillRect(p.x, p.y, 2, 2); }
          ctx.globalAlpha = 1;

          if (ship.alive && !(ship.inv > 0 && Math.floor(ship.inv * 10) % 2)) {
            ctx.save();
            ctx.translate(ship.x, ship.y);
            ctx.rotate(ship.a);
            ctx.strokeStyle = '#4ff3ff';
            ctx.beginPath();
            ctx.moveTo(16, 0); ctx.lineTo(-11, -10); ctx.lineTo(-6, 0); ctx.lineTo(-11, 10); ctx.closePath();
            ctx.stroke();
            if (ship.thrust && Math.random() < 0.8) {
              ctx.strokeStyle = '#ff8c3a';
              ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(-18 - Math.random() * 6, 0); ctx.lineTo(-7, 5); ctx.stroke();
            }
            ctx.restore();
          }

          if (!cpuSender) {
            // Launch exclusion ring, aiming line and size picker.
            const sx = ship.alive ? ship.x : W / 2, sy = ship.alive ? ship.y : H / 2;
            ctx.strokeStyle = 'rgba(255,90,90,.35)';
            ctx.setLineDash([6, 6]);
            ctx.beginPath(); ctx.arc(sx, sy, SAFE_LAUNCH, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]);
            if (drag) {
              const ok = launchOk(drag.x0, drag.y0) && energy >= SIZES[selSize].cost;
              ctx.strokeStyle = ok ? '#ffd36b' : '#ff5a5a';
              ctx.beginPath(); ctx.arc(drag.x0, drag.y0, SIZES[selSize].r, 0, Math.PI * 2); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(drag.x0, drag.y0); ctx.lineTo(drag.x1, drag.y1); ctx.stroke();
            }
            Draw.text(ctx, 'SIZE', 12, H - 14, 9, '#aaa');
            [1, 2, 3].forEach((s) => {
              Draw.text(ctx, `${s}`, 60 + (s - 1) * 30, H - 14, 12, s === selSize ? '#ffd36b' : '#555');
            });
            Draw.text(ctx, `COST ${SIZES[selSize].cost}`, 160, H - 14, 9, '#aaa');
            Draw.text(ctx, 'ENERGY', 520, H - 14, 9, '#aaa');
            Draw.meter(ctx, 590, H - 24, 200, 10, energy / 10, '#ffd36b');
          }

          const ships = `SHIPS ${'▲'.repeat(Math.max(0, lives))}`;
          if (mode === 'classic') Draw.hud(ctx, `SCORE ${score}`, `WAVE ${wave}`, ships);
          else if (rounds) Draw.hud(ctx, rounds.hud(), `CPU ${ships}`, `TIME ${Math.ceil(Math.max(0, roundT))}`);
          else Draw.hud(ctx, `SCORE ${score}`, `DEMO WAVE ${wave}`, ships);
        },
      };
    },
  });
})();
