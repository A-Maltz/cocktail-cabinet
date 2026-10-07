/*
 * SPLAT
 *   Sides: the Bird (flap through the gaps) and the Builder (decides where each column's gap goes).
 *   classic — you flap, the computer builds columns (bigger swings and tighter gaps as you go).
 *   flipped — you build columns with the mouse, the computer flaps. Make it splat.
 *
 * No cheating: the computer bird uses exactly the same physics and collision code as you. Its only
 * action is "flap". It only sees columns that are already on screen. Each decision, it simulates a
 * short look-ahead for "flap now" vs "wait" and picks whichever doesn't crash. Lower levels decide
 * less often, misjudge the gap centre, and don't plan ahead.
 * Fair building: a gap can only move so far from the previous one (265px for you, 200px for the
 * computer builder), which keeps every course physically flyable.
 */
(function () {
  'use strict';
  const { U, Draw } = Cabinet;

  const W = 800, H = 600, TOP = 26, GROUND = 560;
  const BX = 200, BR = 13, G = 1500, FLAP = -440, MAX_FALL = 620;
  const CW = 72, SPACING = 290;
  const MAX_SHIFT = 265;     // how far a human builder may move the gap between columns
  const CPU_MAX_SHIFT = 200; // the computer builder is gentler, so classic mode stays fair to you
  const ROUND_GOAL = 12;
  const STEP = 1 / 60;

  function hits(y, cols, shift) {
    if (y + BR >= GROUND) return true;
    for (const c of cols) {
      const x = c.x - shift;
      if (BX + BR <= x || BX - BR >= x + CW) continue;
      // circle vs the two pipe rectangles: test the closest point of each
      const cx = U.clamp(BX, x, x + CW);
      const top = c.gapY - c.gap / 2, bot = c.gapY + c.gap / 2;
      const ty = Math.min(y, top);
      if (y - BR < top && (BX - cx) ** 2 + (y - ty) ** 2 < BR * BR) return true;
      const by = Math.max(y, bot);
      if (y + BR > bot && (BX - cx) ** 2 + (y - by) ** 2 < BR * BR) return true;
    }
    return false;
  }
  function physicsStep(b, flap, dt) {
    if (flap) b.vy = FLAP;
    b.vy = Math.min(MAX_FALL, b.vy + G * dt);
    b.y += b.vy * dt;
    if (b.y < TOP + BR) { b.y = TOP + BR; b.vy = 0; }
  }

  Cabinet.register({
    id: 'splat',
    title: 'Splat',
    color: '#ffd23a',
    tagline: 'One button. Many columns. Try not to go splat.',
    flip: 'you lay out the columns, the computer flies.',
    modes: [
      { id: 'classic', you: 'Bird', cpu: 'Column builder',
        how: 'Space, Up, W or click to flap. The computer places every gap. It starts gentle, then swings the gaps further and squeezes them tighter.' },
      { id: 'flipped', you: 'Column builder', cpu: 'Bird',
        how: 'Move the mouse up and down (or use the arrow keys) to set the next gap; it locks when the column appears. A gap can move at most 265px from the last one. Make the bird splat before it clears 12 columns. 3 hearts.' },
      { id: 'demo', you: 'Spectator', cpu: 'Bird and builder', how: 'The computer plays both sides.' },
    ],

    create(api) {
      const mode = api.mode;
      const cpuBird = mode !== 'classic';
      const cpuBuilder = mode !== 'flipped';
      const rounds = mode === 'flipped' ? api.Rounds({ next: () => reset() }) : null;

      let bird, cols, passed, dead, scrollSinceSpawn, lastGap, lastDir, flapQueued, deadT;
      let builderY = H / 2, frame = 0, groundX = 0, particles = [], demoBest = 0;
      let skill = null;

      const level = () => (rounds ? rounds.level : 1 + Math.floor(passed / 8));
      const speed = () => (mode === 'classic' ? 175 + Math.min(passed, 30) * 2 : 175 + Math.min(level() - 1, 8) * 6);
      const gapSize = () => (mode === 'classic' || mode === 'demo' ? Math.max(118, 182 - passed * 2.5) : 138);
      const bounds = (gap) => [TOP + gap / 2 + 28, GROUND - gap / 2 - 28];

      // The computer bird's skill, by level.
      const birdSkill = (L) => ({
        period: Math.max(1, 5 - L),                 // frames between decisions
        noise: Math.max(3, 12 - 2 * (L - 1)),       // how far off-centre it thinks the gap is
        plan: L >= 2,                               // does it look ahead?
        slip: Math.max(0, 0.05 - 0.012 * (L - 1)),  // chance per column of a late flap
      });

      function reset() {
        bird = { y: H / 2 - 40, vy: 0 };
        cols = [];
        passed = 0;
        dead = false;
        deadT = 0;
        scrollSinceSpawn = SPACING - 140;
        lastGap = H / 2;
        lastDir = 1;
        flapQueued = false;
        skill = birdSkill(level());
      }

      function nextGapCPU(gap) {
        const [lo, hi] = bounds(gap);
        const reach = Math.min(CPU_MAX_SHIFT, 45 + passed * 9);
        let dir = U.chance(0.5) ? 1 : -1;
        if (passed >= 6 && U.chance(0.7)) dir = -lastDir; // force big up-down swings
        let y = lastGap + dir * U.rand(0.4, 1) * reach;
        if (y < lo || y > hi) { dir = -dir; y = lastGap + dir * U.rand(0.4, 1) * reach; }
        lastDir = dir;
        return U.clamp(y, lo, hi);
      }
      function humanRange(gap) {
        const [lo, hi] = bounds(gap);
        return [Math.max(lo, lastGap - MAX_SHIFT), Math.min(hi, lastGap + MAX_SHIFT)];
      }
      function spawn() {
        const gap = gapSize();
        let gy;
        if (cpuBuilder) gy = nextGapCPU(gap);
        else { const [lo, hi] = humanRange(gap); gy = U.clamp(builderY, lo, hi); }
        cols.push({ x: W, gapY: gy, gap, passed: false, noise: U.rand(-1, 1) });
        lastGap = gy;
      }

      // ------------------------------------------------ computer bird
      function targetFor(c) { return c.gapY + c.noise * skill.noise; }
      function aheadColumn(shift) {
        return cols.find((c) => c.x - shift + CW > BX - BR);
      }
      // Flap rule: a flap lifts the bird HOP (~64px). Flapping once we fall to target + 0.35*HOP
      // makes each hop bob around the target, with a little slack below for slow reactions.
      const HOP = (FLAP * FLAP) / (2 * G);
      function ruleFlap(y, vy, shift) {
        const c = aheadColumn(shift);
        const target = c ? targetFor(c) : H / 2;
        return y > target + HOP * 0.35 && vy > 0;
      }
      function crashes(first) {
        const b = { y: bird.y, vy: bird.vy };
        const sp = speed();
        let shift = 0;
        for (let i = 0; i < 48; i++) {
          const f = i === 0 ? first : ruleFlap(b.y, b.vy, shift);
          physicsStep(b, f, STEP);
          shift += sp * STEP;
          if (hits(b.y, cols, shift)) return true;
        }
        return false;
      }
      function birdBrain() {
        if (frame % skill.period !== 0) return false;
        let flap = ruleFlap(bird.y, bird.vy, 0);
        if (skill.plan && crashes(flap) && !crashes(!flap)) flap = !flap;
        return flap;
      }

      function splat() {
        dead = true;
        api.sfx.boom();
        for (let i = 0; i < 24; i++) {
          particles.push({ x: BX, y: bird.y, vx: U.rand(-220, 220), vy: U.rand(-320, 80), t: 1 });
        }
        if (mode === 'classic') {
          api.after(1, () => api.end({ title: 'SPLAT!', score: passed, lines: [`Columns cleared: ${passed}`] }));
        } else if (rounds) {
          rounds.win('SPLAT! Round won.');
        } else {
          demoBest = Math.max(demoBest, passed);
          api.after(1.2, reset);
        }
      }

      reset();

      return {
        pointerDown() { if (!cpuBird) flapQueued = true; },
        pointerMove(x, y) { if (!cpuBuilder) builderY = y; },
        keyDown(code) {
          if (!cpuBird && (code === 'Space' || code === 'ArrowUp' || code === 'KeyW')) flapQueued = true;
        },
        update(dt) {
          frame++;
          for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += G * dt; p.t -= dt; }
          particles = particles.filter((p) => p.t > 0);
          if (!cpuBuilder) {
            if (api.keys.has('ArrowUp')) builderY -= 380 * dt;
            if (api.keys.has('ArrowDown')) builderY += 380 * dt;
            builderY = U.clamp(builderY, TOP, GROUND);
          }
          if (dead || (rounds && rounds.busy)) return;

          // Columns scroll left; spawn a new one every SPACING pixels.
          const sp = speed();
          for (const c of cols) c.x -= sp * dt;
          groundX = (groundX + sp * dt) % 40;
          scrollSinceSpawn += sp * dt;
          if (scrollSinceSpawn >= SPACING) { scrollSinceSpawn -= SPACING; spawn(); }
          cols = cols.filter((c) => c.x + CW > -10);

          let flap = false;
          if (cpuBird) {
            flap = birdBrain();
            // A "slip": once in a while a weak bird is a beat late.
            if (flap && U.chance(skill.slip / 8)) flap = false;
          } else {
            flap = flapQueued;
            flapQueued = false;
          }
          if (flap) api.sfx.blip();
          physicsStep(bird, flap, dt);

          if (hits(bird.y, cols, 0)) return splat();
          for (const c of cols) {
            if (!c.passed && c.x + CW < BX - BR) {
              c.passed = true;
              passed++;
              api.sfx.pop();
              if (rounds && passed >= ROUND_GOAL) return rounds.lose(`The bird cleared ${ROUND_GOAL} columns.`);
              if (mode === 'demo') skill = birdSkill(level());
            }
          }
        },
        draw(ctx) {
          const sky = ctx.createLinearGradient(0, 0, 0, H);
          sky.addColorStop(0, '#16224d');
          sky.addColorStop(1, '#3c2a5c');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, W, H);

          for (const c of cols) {
            const top = c.gapY - c.gap / 2, bot = c.gapY + c.gap / 2;
            ctx.fillStyle = '#3ccf5a';
            ctx.fillRect(c.x, 0, CW, top);
            ctx.fillRect(c.x, bot, CW, GROUND - bot);
            ctx.fillStyle = '#2a9c43';
            ctx.fillRect(c.x - 4, top - 18, CW + 8, 18);
            ctx.fillRect(c.x - 4, bot, CW + 8, 18);
            ctx.fillStyle = 'rgba(255,255,255,.18)';
            ctx.fillRect(c.x + 8, 0, 6, top - 18);
            ctx.fillRect(c.x + 8, bot + 18, 6, GROUND - bot - 18);
          }

          // Builder preview: where the next gap will go, and how far it is allowed to move.
          if (!cpuBuilder && !dead) {
            const gap = gapSize();
            const [lo, hi] = humanRange(gap);
            const gy = U.clamp(builderY, lo, hi);
            ctx.fillStyle = 'rgba(255,210,58,.12)';
            ctx.fillRect(W - 26, lo - gap / 2, 26, hi - lo + gap);
            ctx.strokeStyle = '#ffd23a';
            ctx.lineWidth = 3;
            ctx.strokeRect(W - 22, gy - gap / 2, 18, gap);
            Draw.text(ctx, 'NEXT', W - 13, gy - gap / 2 - 6, 8, '#ffd23a', 'center');
          }

          ctx.fillStyle = '#6b4a2b';
          ctx.fillRect(0, GROUND, W, H - GROUND);
          ctx.fillStyle = '#8a6a3a';
          for (let x = -groundX; x < W; x += 40) ctx.fillRect(x, GROUND, 20, 8);

          for (const p of particles) {
            ctx.fillStyle = `rgba(255,210,58,${p.t})`;
            ctx.fillRect(p.x, p.y, 5, 5);
          }
          if (!dead) {
            ctx.save();
            ctx.translate(BX, bird.y);
            ctx.rotate(U.clamp(bird.vy / 900, -0.5, 1.1));
            ctx.fillStyle = '#ffd23a';
            ctx.beginPath(); ctx.arc(0, 0, BR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(5, -4, 4.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.fillRect(6, -5, 2.5, 2.5);
            ctx.fillStyle = '#ff8c3a';
            ctx.fillRect(10, 0, 9, 4);
            ctx.fillStyle = '#e8b520';
            ctx.fillRect(-9, frame % 16 < 8 ? -2 : 2, 10, 5);
            ctx.restore();
          }

          if (mode === 'classic') Draw.hud(ctx, `CLEARED ${passed}`, 'YOU: BIRD', `BEST ${api.best()}`);
          else if (rounds) Draw.hud(ctx, rounds.hud(), `CLEARED ${passed}/${ROUND_GOAL}`, 'YOU: BUILDER');
          else Draw.hud(ctx, `CLEARED ${passed}`, 'DEMO', `BEST ${demoBest}`);
        },
      };
    },
  });
})();
