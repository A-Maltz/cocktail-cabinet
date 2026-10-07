/*
 * SPACE INVADERS (our own pick)
 *   Sides: the Cannon (bottom of the screen) and the Fleet commander (decides which invader
 *   shoots, and when). The fleet marches on its own, faster as it shrinks, like the original.
 *   classic — you are the cannon, the computer commands the fleet's fire.
 *   flipped — you command the fleet (click a column to fire from it), the computer is the cannon.
 *
 * Cannon AI: for every invader bullet it has noticed (after a reaction delay), it works out when
 * and where the bullet will reach cannon height. It then picks the spot closest to where it wants
 * to shoot from that it can reach without being under any bullet at the moment that bullet arrives.
 * It aims by leading the marching fleet. One cannon shot on screen at a time, exactly like yours.
 */
(function () {
  'use strict';
  const { U, Draw } = Cabinet;

  const W = 800, H = 600;
  const COLS = 11, ROWS = 5, SX = 48, SY = 36, IW = 30, IH = 20;
  const CANNON_Y = 540, CW = 40, CANNON_V = 240, SHOT_V = 620;
  const BUNKER_Y = 460, BLOCK = 4, BUNKER_SHAPE = [
    '..########..', '.##########.', '############', '############',
    '############', '############', '####....####', '###......###',
  ];
  const SPRITES = [
    ['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'],
    ['..#.....#..', '...#...#...', '..#######..', '.##.###.##.', '###########', '#.#######.#', '#.#.....#.#', '...##.##...'],
    ['....####....', '.##########.', '############', '###..##..###', '############', '...##..##...', '..##.##.##..', '##........##'],
  ];
  const ALT_LEGS = [
    ['.#.##.#.', '#......#'],
    ['#.#.....#.#', '..#.....#..'],
    ['..##..##..', '.##.##.##.'],
  ];
  const ROW_TYPE = [0, 1, 1, 2, 2];
  const ROW_PTS = [30, 20, 20, 10, 10];
  const ROW_COLOR = ['#ff4fd8', '#4ff3ff', '#4ff3ff', '#7dff7a', '#7dff7a'];

  Cabinet.register({
    id: 'invaders',
    title: 'Space Invaders',
    color: '#a6ff4f',
    tagline: 'Our pick. The fleet marches. Someone is giving the orders.',
    flip: 'you order the fleet to fire, the computer defends.',
    modes: [
      { id: 'classic', you: 'Cannon', cpu: 'Fleet commander',
        how: 'Left/Right or A/D to move, Space to fire (one shot on screen at a time). The computer decides which invader fires and gets better at predicting where you’ll be. 3 lives.' },
      { id: 'flipped', you: 'Fleet commander', cpu: 'Cannon',
        how: 'Click under or on a column (or press Space with the mouse over it) to make its lowest invader fire. Only a few bullets can be in the air at once. Destroy the cannon 3 times, or land the fleet, before it wipes you out. 3 hearts.' },
      { id: 'demo', you: 'Spectator', cpu: 'Cannon and fleet', how: 'The computer plays both sides.' },
    ],

    create(api) {
      const mode = api.mode;
      const cpuCannon = mode !== 'classic';
      const cpuFleet = mode !== 'flipped';
      const rounds = mode === 'flipped' ? api.Rounds({ next: () => newWave() }) : null;

      let wave = 1, score = 0, lives = 3, over = false;
      let fleet, fleetDir, marchT, animFrame, bombs, shot, cannon, bunkers, parts = [];
      let fleetCD = 1, humanCD = 0, landed = false;
      const brain = { aimX: W / 2, react: new Map() };

      const level = () => (rounds ? rounds.level : wave);
      // Fleet fire power: by wave in classic/demo; fixed in flipped (there the cannon improves instead).
      const fleetW = () => (rounds ? 2 : wave);
      const bombSpeed = () => Math.min(360, 200 + 18 * (fleetW() - 1));
      const maxBombs = () => Math.min(5, 2 + Math.floor((fleetW() - 1) / 2));
      const cannonSkill = (L) => ({
        react: Math.max(0.05, 0.32 - 0.045 * (L - 1)),
        notice: Math.min(1, 0.6 + 0.12 * (L - 1)),
        aimErr: Math.max(2, 16 - 3 * (L - 1)),
        margin: 6 + 2 * Math.min(L, 6),
      });

      function newWave() {
        fleet = [];
        const startY = 70 + (rounds ? 0 : Math.min(wave - 1, 5) * 14);
        const x0 = (W - ((COLS - 1) * SX + IW)) / 2;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          fleet.push({ x: x0 + c * SX, y: startY + r * SY, r, c, alive: true });
        }
        fleetDir = 1; marchT = 0; animFrame = 0;
        bombs = []; shot = null; landed = false;
        cannon = { x: W / 2, vx: 0, alive: true, respawn: 0 };
        if (rounds) lives = 3;
        brain.react.clear();
        bunkers = [];
        for (let i = 0; i < 4; i++) {
          const bx = 160 + i * 160 - (BUNKER_SHAPE[0].length * BLOCK) / 2;
          BUNKER_SHAPE.forEach((row, ry) => [...row].forEach((ch, rx) => {
            if (ch === '#') bunkers.push({ x: bx + rx * BLOCK, y: BUNKER_Y + ry * BLOCK });
          }));
        }
      }
      const alive = () => fleet.filter((f) => f.alive);
      const marchInterval = () => (0.04 + 0.6 * (alive().length / (COLS * ROWS))) / (1 + 0.08 * (fleetW() - 1));
      const fleetSpeed = () => (8 / marchInterval()) * fleetDir; // average px/s sideways
      function bottomOf(col) {
        let b = null;
        for (const f of fleet) if (f.alive && f.c === col && (!b || f.y > b.y)) b = f;
        return b;
      }
      function shooters() {
        const out = [];
        for (let c = 0; c < COLS; c++) { const b = bottomOf(c); if (b) out.push(b); }
        return out;
      }
      function dropBomb(inv) {
        if (!inv || bombs.length >= maxBombs()) return false;
        bombs.push({ x: inv.x + IW / 2, y: inv.y + IH, born: 0, id: Math.random() });
        return true;
      }

      // ------------------------------------------------ computer fleet commander
      function fleetAI(dt) {
        fleetCD -= dt;
        if (fleetCD > 0) return;
        const w = fleetW();
        fleetCD = Math.max(0.25, 1.3 - 0.12 * (w - 1)) * U.rand(0.7, 1.3);
        const s = shooters();
        if (!s.length) return;
        if (U.chance(Math.max(0.1, 0.45 - 0.07 * (w - 1)))) { dropBomb(U.pick(s)); return; }
        // Predict where the cannon will be when a bomb from each shooter arrives.
        const spread = Math.max(14, 140 - 20 * (w - 1));
        let best = null, bestD = Infinity;
        for (const inv of s) {
          const t = (CANNON_Y - inv.y) / bombSpeed();
          const pred = cannon.x + (w >= 3 ? cannon.vx * t : 0);
          const d = Math.abs(inv.x + IW / 2 - pred) + U.rand(0, spread);
          if (d < bestD) { bestD = d; best = inv; }
        }
        dropBomb(best);
      }

      // ------------------------------------------------ computer cannon
      function cannonAI(dt) {
        const sk = cannonSkill(level());
        // Which bombs has it noticed, and for how long?
        for (const b of bombs) {
          if (!brain.react.has(b.id)) brain.react.set(b.id, { seen: U.chance(sk.notice), age: 0 });
          brain.react.get(b.id).age += dt;
        }
        const danger = bombs.filter((b) => {
          const k = brain.react.get(b.id);
          return k.seen && k.age >= sk.react && b.y < CANNON_Y + 10;
        }).map((b) => ({ x: b.x, t: (CANNON_Y - b.y) / bombSpeed() }));

        // Where it wants to be: under the lowest invader of the nearest column, leading the march.
        const s = shooters();
        let goal = cannon.x;
        if (s.length) {
          let tgt = null, bestS = Infinity;
          for (const inv of s) {
            const sc = Math.abs(inv.x + IW / 2 - cannon.x) - inv.y * 0.6;
            if (sc < bestS) { bestS = sc; tgt = inv; }
          }
          const t = (CANNON_Y - tgt.y) / SHOT_V;
          if (Math.abs(brain.aimX - (tgt.x + IW / 2 + fleetSpeed() * t)) > 20) brain.err = U.rand(-sk.aimErr, sk.aimErr);
          brain.aimX = tgt.x + IW / 2 + fleetSpeed() * t;
          goal = brain.aimX + (brain.err || 0);
        }
        // Find the reachable position nearest the goal that isn't under a bomb when it lands.
        const posAt = (g, t) => cannon.x + U.clamp(g - cannon.x, -CANNON_V * t, CANNON_V * t);
        const safe = (g) => danger.every((d) => Math.abs(posAt(g, d.t) - d.x) > CW / 2 + 3 + sk.margin);
        let pick = cannon.x;
        if (!safe(goal)) {
          let found = false;
          for (let off = 8; off < W && !found; off += 8) {
            for (const g of [goal - off, goal + off]) {
              if (g < CW / 2 || g > W - CW / 2) continue;
              if (safe(g)) { pick = g; found = true; break; }
            }
          }
        } else pick = goal;

        const dx = U.clamp(pick - cannon.x, -CANNON_V * dt, CANNON_V * dt);
        const fireNow = !shot && Math.abs(cannon.x - goal) < 6 && danger.every((d) => d.t > 0.15 || Math.abs(d.x - cannon.x) > CW);
        return { dx, fire: fireNow };
      }

      // ------------------------------------------------ shared
      function hitBunker(x, y, w, h) {
        for (let i = 0; i < bunkers.length; i++) {
          const b = bunkers[i];
          if (x < b.x + BLOCK && x + w > b.x && y < b.y + BLOCK && y + h > b.y) {
            // knock out the block and a few of its neighbours
            bunkers = bunkers.filter((o) => o !== b && (Math.hypot(o.x - b.x, o.y - b.y) > BLOCK * 1.5 || Math.random() < 0.4));
            return true;
          }
        }
        return false;
      }
      function burst(x, y, color) {
        for (let i = 0; i < 18; i++) {
          const a = U.rand(0, 6.28), s = U.rand(40, 180);
          parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: U.rand(0.3, 0.8), color });
        }
      }
      function cannonHit() {
        cannon.alive = false;
        cannon.respawn = 1.4;
        bombs = [];
        burst(cannon.x, CANNON_Y, '#a6ff4f');
        api.sfx.boom();
        lives--;
        if (lives <= 0) defeat('Cannon destroyed!');
      }
      function defeat(why) {
        if (mode === 'classic') {
          over = true;
          api.after(1.2, () => api.end({ title: 'GAME OVER', score, lines: [why, `Score ${score}`, `Reached wave ${wave}`] }));
        } else if (rounds) {
          rounds.win(why);
        } else {
          api.flash(why, 1.4, '#ff5a5a');
          api.after(1.5, () => { wave = 1; score = 0; lives = 3; newWave(); });
          over = true;
          api.after(1.5, () => { over = false; });
        }
      }
      function cleared() {
        if (rounds) return rounds.lose('The fleet was wiped out.');
        api.sfx.good();
        wave++;
        api.flash(`WAVE ${wave}`, 1.2, '#a6ff4f');
        newWave();
      }

      function humanFire(x) {
        if (humanCD > 0) return;
        let best = null;
        for (const s of shooters()) if (Math.abs(s.x + IW / 2 - x) < SX / 2 && (!best || s.y > best.y)) best = s;
        if (best && dropBomb(best)) { humanCD = 0.3; api.sfx.blip(); } else api.sfx.hit();
      }

      newWave();

      return {
        pointerDown(x) { if (!cpuFleet && !(rounds && rounds.busy)) humanFire(x); },
        keyDown(code) { if (!cpuFleet && code === 'Space') humanFire(api.mouse.x); },
        update(dt) {
          if (over || (rounds && rounds.busy)) return;
          humanCD -= dt;
          for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.t -= dt; }
          parts = parts.filter((p) => p.t > 0);

          // March
          marchT += dt;
          if (marchT >= marchInterval()) {
            marchT = 0;
            animFrame ^= 1;
            const live = alive();
            const minX = Math.min(...live.map((f) => f.x)), maxX = Math.max(...live.map((f) => f.x + IW));
            if ((fleetDir > 0 && maxX + 8 > W - 16) || (fleetDir < 0 && minX - 8 < 16)) {
              fleetDir = -fleetDir;
              for (const f of fleet) f.y += 16;
            } else {
              for (const f of fleet) f.x += 8 * fleetDir;
            }
            for (const f of live) hitBunker(f.x, f.y, IW, IH);
            if (live.some((f) => f.y + IH >= CANNON_Y - 6)) { landed = true; lives = 0; return defeat('The invaders landed!'); }
          }

          // Cannon
          if (cannon.alive) {
            let dx = 0, wantFire = false;
            if (cpuCannon) { const a = cannonAI(dt); dx = a.dx; wantFire = a.fire; }
            else {
              if (api.keys.has('ArrowLeft') || api.keys.has('KeyA')) dx -= CANNON_V * dt;
              if (api.keys.has('ArrowRight') || api.keys.has('KeyD')) dx += CANNON_V * dt;
              wantFire = api.keys.has('Space');
            }
            const nx = U.clamp(cannon.x + dx, CW / 2, W - CW / 2);
            cannon.vx = (nx - cannon.x) / dt;
            cannon.x = nx;
            if (wantFire && !shot) { shot = { x: cannon.x, y: CANNON_Y - 10 }; api.sfx.shoot(); }
          } else {
            cannon.respawn -= dt;
            if (cannon.respawn <= 0 && lives > 0) { cannon.alive = true; cannon.x = W / 2; brain.react.clear(); }
          }

          if (cpuFleet) fleetAI(dt);

          // Player shot
          if (shot) {
            shot.y -= SHOT_V * dt;
            if (shot.y < 30 || hitBunker(shot.x - 1, shot.y, 2, 10)) shot = null;
            else {
              const inv = fleet.find((f) => f.alive && shot.x > f.x && shot.x < f.x + IW && shot.y < f.y + IH && shot.y + 10 > f.y);
              if (inv) {
                inv.alive = false;
                score += ROW_PTS[inv.r];
                burst(inv.x + IW / 2, inv.y + IH / 2, ROW_COLOR[inv.r]);
                api.sfx.pop();
                shot = null;
                if (!alive().length) return cleared();
              }
            }
          }
          // Bombs
          for (const b of bombs) {
            b.y += bombSpeed() * dt;
            if (hitBunker(b.x - 2, b.y, 4, 10)) b.dead = true;
            else if (b.y > H) b.dead = true;
            else if (cannon.alive && b.y + 10 >= CANNON_Y - 6 && b.y <= CANNON_Y + 16 && Math.abs(b.x - cannon.x) < CW / 2 + 2) {
              b.dead = true;
              cannonHit();
            }
          }
          bombs = bombs.filter((b) => !b.dead);
        },
        draw(ctx) {
          ctx.fillStyle = '#01020a';
          ctx.fillRect(0, 0, W, H);
          for (const f of fleet) {
            if (!f.alive) continue;
            const t = ROW_TYPE[f.r];
            const rows = SPRITES[t].slice(0, 6).concat(animFrame ? ALT_LEGS[t] : SPRITES[t].slice(6));
            const px = IW / SPRITES[t][0].length;
            ctx.fillStyle = ROW_COLOR[f.r];
            rows.forEach((row, ry) => {
              const off = (SPRITES[t][0].length - row.length) / 2;
              [...row].forEach((ch, rx) => { if (ch === '#') ctx.fillRect(f.x + (rx + off) * px, f.y + ry * (IH / 8), px + 0.3, IH / 8 + 0.3); });
            });
          }
          ctx.fillStyle = '#a6ff4f';
          for (const b of bunkers) ctx.fillRect(b.x, b.y, BLOCK, BLOCK);
          if (cannon.alive) {
            ctx.fillRect(cannon.x - CW / 2, CANNON_Y, CW, 12);
            ctx.fillRect(cannon.x - 6, CANNON_Y - 6, 12, 6);
            ctx.fillRect(cannon.x - 2, CANNON_Y - 10, 4, 4);
          }
          ctx.fillStyle = '#fff';
          if (shot) ctx.fillRect(shot.x - 1, shot.y, 2, 10);
          ctx.fillStyle = '#ffd36b';
          for (const b of bombs) {
            const z = Math.floor(b.y / 6) % 2;
            ctx.fillRect(b.x - 2 + z * 2, b.y, 2, 4); ctx.fillRect(b.x - z * 2, b.y + 4, 2, 4); ctx.fillRect(b.x - 2 + z * 2, b.y + 8, 2, 2);
          }
          for (const p of parts) { ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillRect(p.x, p.y, 3, 3); }
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#a6ff4f';
          ctx.fillRect(0, CANNON_Y + 22, W, 2);

          if (!cpuFleet) {
            // highlight the column under the mouse
            const s = shooters().find((f) => Math.abs(f.x + IW / 2 - api.mouse.x) < SX / 2);
            if (s) {
              ctx.strokeStyle = humanCD > 0 || bombs.length >= maxBombs() ? '#666' : '#ffd36b';
              ctx.strokeRect(s.x - 4, s.y - 4, IW + 8, IH + 8);
            }
            Draw.text(ctx, `BOMBS ${bombs.length}/${maxBombs()}`, W - 12, H - 16, 10, '#ffd36b', 'right');
          }
          const cannons = `LIVES ${'▲'.repeat(Math.max(0, lives))}`;
          if (mode === 'classic') Draw.hud(ctx, `SCORE ${score}`, `WAVE ${wave}`, cannons);
          else if (rounds) Draw.hud(ctx, rounds.hud(), `CPU ${cannons}`, `INVADERS ${alive().length}`);
          else Draw.hud(ctx, `SCORE ${score}`, `DEMO WAVE ${wave}`, cannons);
        },
      };
    },
  });
})();
