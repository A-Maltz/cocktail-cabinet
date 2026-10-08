/*
 * MISSILE COMMAND
 *   Sides: the Defender (three anti-missile batteries protecting six cities) and the Attacker
 *   (launches the incoming missiles).
 *   classic — you defend, the computer attacks in waves (faster, more, then splitting MIRVs).
 *   flipped — you attack, the computer defends. Each wave, flatten 3 of the 6 cities.
 *
 * Defender AI: it only reacts to a missile after a reaction delay. It picks the uncovered missile
 * closest to impact, chooses the battery that can get there soonest, solves for where the missile
 * will be when the interceptor arrives (lead), adds an aiming error, and fires. One interceptor per
 * missile unless the first one misses. Its batteries hold 8 shots each (yours hold 10).
 */
(function () {
  'use strict';
  const { U, Draw } = Cabinet;

  const W = 800, H = 600, TOP = 30, GROUND = 560;
  const CITY_X = [150, 220, 290, 510, 580, 650];
  const BAT_X = [60, 400, 740];
  const INTERCEPT_V = 480, AMMO = 10;
  const EXP_R = 42, EXP_GROW = 0.45, EXP_HOLD = 0.25, EXP_SHRINK = 0.35;
  const WIN_CITIES = 3;

  Cabinet.register({
    id: 'missile',
    slug: 'missile-command',
    title: 'Missile Command',
    color: '#ff5a5a',
    tagline: 'Six cities. Three batteries. Incoming.',
    flip: 'you launch the missiles, the computer defends.',
    modes: [
      { id: 'classic', you: 'Defender', cpu: 'Attacker',
        how: 'Click to fire an interceptor at that spot; it explodes there. The nearest battery with ammo fires (or press A / S / D to pick the left, centre or right battery). Each battery has 10 shots per wave. Lose all six cities and it’s over.' },
      { id: 'flipped', you: 'Attacker', cpu: 'Defender',
        how: 'Press along the sky to pick a launch point, drag to where it should land, release. Right-click or hold Shift to launch a MIRV (costs 2, splits into 3 halfway down). Flatten 3 cities in a wave to win it; the defender gets sharper every wave you win. 3 hearts.' },
      { id: 'demo', you: 'Spectator', cpu: 'Attacker and defender', how: 'The computer plays both sides.' },
    ],

    create(api) {
      const mode = api.mode;
      const cpuDef = mode !== 'classic';
      const cpuAtk = mode !== 'flipped';
      const rounds = mode === 'flipped' ? api.Rounds({ next: (lv) => startWave(lv, true) }) : null;

      let wave = 1, score = 0, over = false, time = 0;
      let cities = CITY_X.map((x) => ({ x, alive: true }));
      let bats = BAT_X.map((x) => ({ x, ammo: AMMO, alive: true }));
      let missiles = [], interceptors = [], explosions = [];
      let toLaunch = 0, salvoT = 0, waveDone = false, waveEndT = 0;
      let budget = 0, launchCD = 0, aim = null, destroyedThisWave = 0;
      const def = { cd: 0 };

      const level = () => (rounds ? rounds.level : wave);
      const defSkill = (L) => ({
        react: Math.max(0.15, 1.0 - 0.1 * (L - 1)),   // seconds before it reacts to a new missile
        err: Math.max(6, 52 - 5 * (L - 1)),           // aiming error (px)
        lead: L >= 2,
        triage: L >= 3,
      });

      function startWave(w, rebuild) {
        wave = w;
        waveDone = false;
        missiles = []; interceptors = []; explosions = [];
        // The computer defender gets 8 shots per battery (you get 10 when you defend).
        bats.forEach((b) => { b.ammo = cpuDef && !cpuAtk ? 8 : AMMO; b.alive = true; });
        if (rebuild) cities.forEach((c) => { c.alive = true; });
        destroyedThisWave = 0;
        if (cpuAtk) { toLaunch = Math.min(40, 8 + 3 * w); salvoT = 1.5; }
        else { budget = 14 + 2 * (w - 1); launchCD = 0; }
      }

      // ------------------------------------------------ missiles
      const mSpeed = () => (cpuAtk ? Math.min(130, 40 + 7 * wave) : Math.min(130, 90 + 4 * (level() - 1)));
      function addMissile(x0, y0, tx, mirv, speed) {
        const d = Math.hypot(tx - x0, GROUND - y0);
        const s = speed || mSpeed();
        missiles.push({
          x0, y0, x: x0, y: y0, tx, vx: ((tx - x0) / d) * s, vy: ((GROUND - y0) / d) * s,
          mirv, splitY: mirv ? U.rand(220, 320) : 0, seen: time, covered: null, id: Math.random(),
        });
      }
      function targets() {
        return [
          ...cities.filter((c) => c.alive).map((c) => c.x),
          ...bats.filter((b) => b.alive).map((b) => b.x),
        ];
      }

      // ------------------------------------------------ computer attacker
      function attackerTick(dt) {
        salvoT -= dt;
        if (toLaunch <= 0 || salvoT > 0) return;
        const w = wave;
        salvoT = Math.max(0.6, 2.8 - 0.2 * w);
        const n = Math.min(toLaunch, 1 + Math.floor(w / 2), 5);
        const tg = targets();
        if (!tg.length) return;
        for (let i = 0; i < n; i++) {
          // Later waves prefer cities and the targets furthest from any loaded battery.
          let tx = U.pick(tg);
          if (w >= 4 && U.chance(0.6)) {
            const alive = cities.filter((c) => c.alive);
            if (alive.length) {
              tx = alive.map((c) => ({ x: c.x, d: Math.min(...bats.filter((b) => b.alive && b.ammo > 0).map((b) => Math.abs(b.x - c.x)).concat([999])) }))
                .sort((a, b) => b.d - a.d)[0].x;
            }
          }
          const mirv = w >= 3 && U.chance(Math.min(0.35, 0.1 + 0.03 * w));
          addMissile(U.rand(20, W - 20), TOP, tx + U.rand(-8, 8), mirv);
          toLaunch--;
        }
      }

      // ------------------------------------------------ human attacker
      function humanLaunch(x0, x1, mirv) {
        const cost = mirv ? 2 : 1;
        if (launchCD > 0 || budget < cost) { api.sfx.hit(); return; }
        addMissile(U.clamp(x0, 10, W - 10), TOP, U.clamp(x1, 10, W - 10), mirv);
        budget -= cost;
        launchCD = 0.3;
        api.sfx.blip();
      }

      // ------------------------------------------------ interceptors (shared)
      function fireFrom(b, x, y, target) {
        if (!b || !b.alive || b.ammo <= 0) return false;
        y = Math.min(y, GROUND - 30);
        b.ammo--;
        const d = Math.hypot(x - b.x, y - (GROUND - 12));
        interceptors.push({ x0: b.x, y0: GROUND - 12, x: b.x, y: GROUND - 12, tx: x, ty: y, t: 0, dur: d / INTERCEPT_V, target });
        api.sfx.shoot();
        return true;
      }
      function nearestBattery(x) {
        return bats.filter((b) => b.alive && b.ammo > 0).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
      }

      // ------------------------------------------------ computer defender
      function defenderTick(dt) {
        def.cd -= dt;
        if (def.cd > 0) return;
        const sk = defSkill(level());
        const alive = new Set(targets().map((x) => Math.round(x)));
        const cands = missiles.filter((m) => !m.covered && time - m.seen >= sk.react && m.y < GROUND - 40)
          .filter((m) => !sk.triage || [...alive].some((x) => Math.abs(x - m.tx) < 30))
          .sort((a, b) => (GROUND - a.y) / a.vy - (GROUND - b.y) / b.vy);
        const m = cands[0];
        if (!m) return;
        let best = null;
        for (const b of bats) {
          if (!b.alive || b.ammo <= 0) continue;
          // Solve for the meeting point: where the missile will be when our blast reaches it.
          let t = Math.hypot(m.x - b.x, m.y - GROUND) / INTERCEPT_V, px = m.x, py = m.y;
          for (let i = 0; i < 4; i++) {
            const lt = sk.lead ? t + 0.15 : 0.3;
            px = m.x + m.vx * lt; py = m.y + m.vy * lt;
            t = Math.hypot(px - b.x, py - GROUND) / INTERCEPT_V;
          }
          if (!best || t < best.t) best = { b, t, px, py };
        }
        if (!best) return;
        if (fireFrom(best.b, best.px + U.rand(-sk.err, sk.err), best.py + U.rand(-sk.err, sk.err), m)) {
          m.covered = interceptors[interceptors.length - 1];
          def.cd = sk.react * 0.6;
        }
      }

      // ------------------------------------------------ world update
      function hitGround(m) {
        explosions.push({ x: m.tx, y: GROUND - 6, t: 0, ground: true });
        api.sfx.boom();
        for (const c of cities) {
          if (c.alive && Math.abs(c.x - m.tx) < 30) { c.alive = false; destroyedThisWave++; }
        }
        for (const b of bats) if (b.alive && Math.abs(b.x - m.tx) < 30) { b.alive = false; b.ammo = 0; }
      }
      function radiusOf(e) {
        if (e.t < EXP_GROW) return (EXP_R * e.t) / EXP_GROW;
        if (e.t < EXP_GROW + EXP_HOLD) return EXP_R;
        return Math.max(0, EXP_R * (1 - (e.t - EXP_GROW - EXP_HOLD) / EXP_SHRINK));
      }

      function endWave() {
        waveDone = true;
        const alive = cities.filter((c) => c.alive).length;
        if (rounds) {
          if (destroyedThisWave >= WIN_CITIES) return; // already handled
          rounds.lose(`Only ${destroyedThisWave} cit${destroyedThisWave === 1 ? 'y' : 'ies'} fell.`);
          return;
        }
        const ammoLeft = bats.reduce((s, b) => s + b.ammo, 0);
        score += ammoLeft * 5 + alive * 100;
        if (alive === 0) return gameOver();
        api.flash(`WAVE ${wave} CLEAR  +${ammoLeft * 5 + alive * 100}`, 1.6, '#7dff7a');
        api.sfx.good();
        api.after(2, () => {
          if ((wave + 1) % 3 === 0) {
            const dead = cities.find((c) => !c.alive);
            if (dead) { dead.alive = true; api.flash('BONUS CITY', 1.2, '#4ff3ff'); }
          }
          startWave(wave + 1, false);
        });
      }
      function gameOver() {
        if (over) return;
        over = true;
        if (mode === 'classic') {
          api.after(1.5, () => api.end({ title: 'THE END', score, lines: [`Score ${score}`, `Survived to wave ${wave}`] }));
        } else {
          api.flash('All cities lost. New game.', 1.6, '#ff5a5a');
          api.after(2, () => { over = false; score = 0; cities.forEach((c) => (c.alive = true)); startWave(1, true); });
        }
      }

      startWave(1, true);

      return {
        keyDown(code) {
          if (cpuDef) return;
          const idx = { KeyA: 0, KeyS: 1, KeyD: 2 }[code];
          if (idx !== undefined && api.mouse.y < GROUND - 20) fireFrom(bats[idx], api.mouse.x, api.mouse.y);
        },
        pointerDown(x, y, button, e) {
          if (!cpuDef) {
            if (y < GROUND - 20) fireFrom(nearestBattery(x), x, y);
            return;
          }
          if (!cpuAtk) aim = { x0: x, x1: x, mirv: button === 2 || (e && e.shiftKey) };
        },
        pointerMove(x) { if (aim) aim.x1 = x; },
        pointerUp(x) {
          if (!aim) return;
          if (!(rounds && rounds.busy) && !waveDone) humanLaunch(aim.x0, x, aim.mirv);
          aim = null;
        },
        update(dt) {
          if (over && mode === 'classic') return;
          if (rounds && rounds.busy) return;
          time += dt;
          launchCD -= dt;
          if (cpuAtk && !waveDone) attackerTick(dt);
          if (cpuDef) defenderTick(dt);

          for (const m of missiles) {
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            if (m.mirv && m.y >= m.splitY) {
              m.dead = true;
              // Three warheads fanning out around the original target.
              for (const off of [-70, 0, 70]) {
                addMissile(m.x, m.y, U.clamp(m.tx + off, 10, W - 10), false, Math.hypot(m.vx, m.vy));
              }
              continue;
            }
            if (m.y >= GROUND - 4) { m.dead = true; hitGround(m); }
          }
          for (const it of interceptors) {
            it.t += dt;
            const f = Math.min(1, it.t / it.dur);
            it.x = U.lerp(it.x0, it.tx, f);
            it.y = U.lerp(it.y0, it.ty, f);
            if (f >= 1) { it.dead = true; explosions.push({ x: it.tx, y: it.ty, t: 0, from: it }); }
          }
          for (const e of explosions) {
            e.t += dt;
            if (e.ground) continue;
            const r = radiusOf(e);
            for (const m of missiles) {
              if (!m.dead && Math.hypot(m.x - e.x, m.y - e.y) < r) { m.dead = true; score += 25; api.sfx.pop(); }
            }
          }
          // A defender's interceptor that blew up without catching its missile frees it up again.
          for (const e of explosions) {
            if (e.from && e.t > EXP_GROW + EXP_HOLD) {
              for (const m of missiles) if (m.covered === e.from) m.covered = null;
            }
          }
          missiles = missiles.filter((m) => !m.dead);
          interceptors = interceptors.filter((i) => !i.dead);
          explosions = explosions.filter((e) => e.t < EXP_GROW + EXP_HOLD + EXP_SHRINK);

          if (rounds && destroyedThisWave >= WIN_CITIES && !waveDone) {
            waveDone = true;
            rounds.win(`${destroyedThisWave} cities down!`);
            return;
          }
          if (cities.every((c) => !c.alive) && !rounds) return gameOver();

          const attackerDone = cpuAtk ? toLaunch <= 0 : budget <= 0;
          if (!waveDone && attackerDone && !missiles.length && !explosions.length && !interceptors.length) {
            waveEndT += dt;
            if (waveEndT > 0.6) { waveEndT = 0; endWave(); }
          }
        },
        draw(ctx) {
          const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
          sky.addColorStop(0, '#02010a');
          sky.addColorStop(1, '#1a0b2a');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#d9a33a';
          ctx.fillRect(0, GROUND, W, H - GROUND);

          for (const c of cities) {
            if (c.alive) {
              ctx.fillStyle = '#4ff3ff';
              ctx.fillRect(c.x - 18, GROUND - 12, 36, 12);
              ctx.fillRect(c.x - 12, GROUND - 22, 8, 10);
              ctx.fillRect(c.x + 2, GROUND - 26, 7, 14);
            } else {
              ctx.fillStyle = '#5a3a2a';
              ctx.fillRect(c.x - 16, GROUND - 5, 32, 5);
            }
          }
          for (const b of bats) {
            ctx.fillStyle = b.alive ? '#a6ff4f' : '#5a3a2a';
            ctx.beginPath();
            ctx.moveTo(b.x - 34, GROUND); ctx.lineTo(b.x - 16, GROUND - 14); ctx.lineTo(b.x + 16, GROUND - 14); ctx.lineTo(b.x + 34, GROUND);
            ctx.fill();
            ctx.fillStyle = '#1a2a0a';
            for (let i = 0; i < b.ammo; i++) ctx.fillRect(b.x - 14 + (i % 5) * 6, GROUND + 8 + Math.floor(i / 5) * 8, 4, 5);
          }

          ctx.lineWidth = 1.5;
          for (const m of missiles) {
            ctx.strokeStyle = m.mirv ? '#ffd23a' : '#ff5a5a';
            ctx.beginPath(); ctx.moveTo(m.x0, m.y0); ctx.lineTo(m.x, m.y); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
          }
          for (const it of interceptors) {
            ctx.strokeStyle = '#4f8bff';
            ctx.beginPath(); ctx.moveTo(it.x0, it.y0); ctx.lineTo(it.x, it.y); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,.5)';
            ctx.beginPath(); ctx.moveTo(it.tx - 4, it.ty - 4); ctx.lineTo(it.tx + 4, it.ty + 4); ctx.moveTo(it.tx + 4, it.ty - 4); ctx.lineTo(it.tx - 4, it.ty + 4); ctx.stroke();
          }
          for (const e of explosions) {
            const r = e.ground ? 30 * (1 - e.t / (EXP_GROW + EXP_HOLD + EXP_SHRINK)) : radiusOf(e);
            ctx.fillStyle = ['#fff', '#ffd23a', '#ff5a5a', '#ff4fd8'][Math.floor(time * 20) % 4];
            ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(0, r), 0, Math.PI * 2); ctx.fill();
          }

          if (!cpuDef) {
            const { x, y } = api.mouse;
            ctx.strokeStyle = '#fff';
            ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
          }
          if (!cpuAtk) {
            if (aim) {
              ctx.strokeStyle = aim.mirv ? '#ffd23a' : '#ff5a5a';
              ctx.setLineDash([5, 6]);
              ctx.beginPath(); ctx.moveTo(aim.x0, TOP); ctx.lineTo(aim.x1, GROUND); ctx.stroke();
              ctx.setLineDash([]);
            }
            Draw.text(ctx, `MISSILES ${budget}`, 12, H - 12, 10, '#000');
            Draw.text(ctx, `CITIES DOWN ${destroyedThisWave}/${WIN_CITIES}`, W - 12, H - 12, 10, '#000', 'right');
          }

          const citiesLeft = cities.filter((c) => c.alive).length;
          if (mode === 'classic') Draw.hud(ctx, `SCORE ${score}`, `WAVE ${wave}`, `CITIES ${citiesLeft}`);
          else if (rounds) Draw.hud(ctx, rounds.hud(), 'YOU: ATTACKER', launchCD > 0 ? 'RELOADING' : 'READY');
          else Draw.hud(ctx, `SCORE ${score}`, `DEMO WAVE ${wave}`, `CITIES ${citiesLeft}`);
        },
      };
    },
  });
})();
