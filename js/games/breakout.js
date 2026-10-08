/*
 * BREAKOUT
 *   Sides: the Breaker (paddle at the bottom) and the Wall (a guard bar that slides under the
 *   bricks and knocks the ball back down at awkward angles). The guard only blocks balls going up.
 *   classic — you are the Breaker, the computer runs the Wall's guard.
 *   flipped — you run the guard, the computer plays the paddle.
 *
 * Fairness: the guard's top speed is always below the ball's maximum sideways speed, so a sharp
 * shot can always get past it, and the guard tires (slows 18%) with every block in a row until a
 * brick is hit, so rallies can't stall forever. The computer paddle predicts where the ball will land (including
 * wall bounces) but with a reaction delay and an aiming error that shrink as levels rise.
 */
(function () {
  'use strict';
  const { U, Draw } = Cabinet;

  const W = 800, H = 600, TOP = 26;
  const COLS = 10, BW = 70, BH = 20, GAP = 4, BX0 = (W - (COLS * (BW + GAP) - GAP)) / 2, BY0 = 62;
  const PADDLE_Y = 560, PW = 100, PH = 12;
  const GW = 120, GH = 10;
  const R = 7;
  const ROW_COLORS = ['#ff4f6d', '#ff8c3a', '#ffd23a', '#7dff7a', '#4ff3ff', '#6f8bff', '#c86bff', '#ff6bd8'];

  // Where will a ball at (x, y) moving (vx, vy) cross height ty, counting side-wall bounces?
  function predictX(x, y, vx, vy, ty) {
    const t = (ty - y) / vy;
    if (!(t > 0)) return x;
    const span = W - 2 * R;
    let p = U.wrap(x - R + vx * t, span * 2);
    if (p > span) p = span * 2 - p;
    return p + R;
  }
  // How many side walls will it bounce off before then? (Bounces are what make a ball hard to read.)
  function wallBounces(x, y, vx, vy, ty) {
    const t = (ty - y) / vy;
    if (!(t > 0)) return 0;
    const raw = x - R + vx * t, span = W - 2 * R;
    return raw >= 0 ? Math.floor(raw / span) : Math.floor(-raw / span) + 1;
  }

  Cabinet.register({
    id: 'breakout',
    title: 'Breakout',
    color: '#ff8c3a',
    tagline: 'Smash the wall. This wall fights back.',
    flip: 'you guard the wall, the computer breaks it.',
    // How-to-play guide shown on the game page (and the How to play button).
    guide: {
      goal: "Knock out every brick with the ball without letting it fall past the paddle at the bottom.",
      sides: [
        ["Breaker (classic)", "You move the paddle. A purple guard under the bricks swats the ball back down, but it gets slower with every block in a row and recovers when a brick breaks. Clear the wall to reach the next level (more rows, faster ball). 3 balls."],
        ["The wall’s guard (flipped)", "You move the purple guard and the computer plays the paddle. Block the ball on its way up and angle it away from the paddle. Make the computer drop 3 balls before it clears the wall to win the round. 3 hearts."],
        ["Spectator (demo)", "The computer plays both sides."],
      ],
      controls: [
        ["Move the paddle / guard", "Mouse, or Left/Right (A/D)", "Drag your finger"],
        ["Serve (classic)", "Click or Space", "Tap"],
        ["Pause", "P or Esc", "Pause button"],
      ],
      rules: [
        "The guard only stops balls going up; balls coming down pass through it.",
        "Where the ball hits the paddle or guard sets the angle: the middle sends it straight, the edges send it out sharply.",
        "Each brick is 10 points.",
      ],
      tips: [
        "Breaker: use the edges of the paddle for steep angles that slip past the guard.",
        "Guard: keep blocking. Every block makes the guard slower, but you only lose when a brick breaks, and that resets it.",
      ],
    },
    modes: [
      { id: 'classic', you: 'Breaker (paddle)', cpu: 'The wall’s guard',
        touchHow: 'Drag your finger to move the paddle; tap to serve. Where the ball hits the paddle sets its angle. The purple guard swats the ball back but tires with every block in a row. 3 lives.',
        how: 'Move the paddle with the mouse or arrow keys; click or Space to serve. Where the ball hits the paddle sets its angle. The purple guard under the bricks swats the ball back, but it tires with every block in a row. Beat it with sharp angles. 3 lives.' },
      { id: 'flipped', you: 'The wall’s guard', cpu: 'Breaker (paddle)',
        touchHow: 'Drag your finger to move the purple guard. Block the ball on its way up and angle it away from the paddle. Make the computer drop 3 balls before it clears the wall. 3 hearts.',
        how: 'Move the purple guard with the mouse or arrow keys. Block the ball on its way up and angle it back where the paddle isn’t. Each block in a row tires the guard until a brick breaks. Make the computer drop 3 balls before it clears the wall. 3 hearts.' },
      { id: 'demo', you: 'Spectator', cpu: 'Paddle and guard', how: 'The computer plays both sides.' },
    ],

    create(api) {
      const mode = api.mode;
      const cpuPaddle = mode !== 'classic';
      const cpuGuard = mode !== 'flipped';

      let level = 1, score = 0, lives = 3, bricks = [], rows = 5;
      let ball, served, serveT, baseSpeed, paddle, guard, over = false;
      let pAI = { react: 0, err: 0, aim: 0, armed: false };
      let gAI = { react: 0, err: 0, aim: 0, armed: false };
      let mouseUsed = false, god = false;
      const rounds = mode === 'flipped' ? api.Rounds({ next: (lv) => newLevel(lv) }) : null;
      const guardY = () => BY0 + rows * (BH + GAP) + 34;
      const tire = () => Math.pow(0.82, guard.streak); // speed multiplier after repeated blocks

      // Difficulty tables, indexed by level (1-based).
      const guardSkill = (L) => ({
        speed: Math.min(0.72 * baseSpeed, 150 + 40 * (L - 1)) * tire(),
        delay: Math.max(0.12, 0.42 - 0.05 * (L - 1)),
        err: Math.max(14, 62 - 8 * (L - 1)),
        aim: L >= 3,
      });
      const paddleSkill = (L) => ({
        speed: Math.min(600, 360 + 40 * (L - 1)),
        delay: Math.max(0.1, 0.25 - 0.025 * (L - 1)),
        err: Math.max(6, 20 - 2.5 * (L - 1)),        // misjudgement on a straight ball (px)
        bounceErr: Math.max(20, 30 - 2 * (L - 1)),   // extra misjudgement per side-wall bounce
        aim: L >= 2 ? Math.min(1, 0.4 + 0.2 * (L - 2)) : 0,
      });

      function newLevel(L) {
        level = L;
        rows = 5 + Math.min(L - 1, 3);
        bricks = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
          bricks.push({ x: BX0 + c * (BW + GAP), y: BY0 + r * (BH + GAP), c, r, alive: true });
        }
        baseSpeed = Math.min(520, 320 + 22 * (L - 1));
        if (rounds) lives = 3;
        paddle = paddle || { x: W / 2 };
        guard = { x: W / 2, streak: 0 };
        newBall();
      }
      function newBall() {
        ball = { x: paddle.x, y: PADDLE_Y - R - 1, vx: 0, vy: 0, s: baseSpeed };
        served = false;
        serveT = cpuPaddle ? 0.9 : 3.5;
        pAI.armed = gAI.armed = false;
      }
      function serve() {
        if (served) return;
        served = true;
        const a = U.rand(-0.45, 0.45);
        ball.vx = Math.sin(a) * ball.s;
        ball.vy = -Math.cos(a) * ball.s;
        api.sfx.blip();
      }
      function bounceOff(offset, up) {
        const a = U.clamp(offset, -1, 1) * (up ? 1.05 : 0.95); // up to ~60 degrees from vertical
        ball.vx = Math.sin(a) * ball.s;
        ball.vy = (up ? -1 : 1) * Math.cos(a) * ball.s;
      }

      // ------------------------------------------------ computer paddle
      function bestTargetX() {
        // Aim for the column with the most bricks left, preferably far from the guard.
        let best = W / 2, bestS = -1;
        for (let c = 0; c < COLS; c++) {
          const n = bricks.filter((b) => b.alive && b.c === c).length;
          if (!n) continue;
          const cx = BX0 + c * (BW + GAP) + BW / 2;
          const s = n + Math.abs(cx - guard.x) / 90;
          if (s > bestS) { bestS = s; best = cx; }
        }
        return best;
      }
      function paddleAI(dt) {
        const sk = paddleSkill(level);
        let target = paddle.x;
        if (!served) {
          target = W / 2 + Math.sin(performance.now() / 700) * 120;
        } else if (ball.vy > 0) {
          if (!pAI.armed) {
            pAI.armed = true;
            pAI.react = sk.delay;
            const nb = wallBounces(ball.x, ball.y, ball.vx, ball.vy, PADDLE_Y - R);
            pAI.err = U.rand(-1, 1) * (sk.err + sk.bounceErr * nb);
            pAI.aim = 0;
            if (U.chance(sk.aim)) {
              const land = predictX(ball.x, ball.y, ball.vx, ball.vy, PADDLE_Y - R);
              const ang = Math.atan2(bestTargetX() - land, PADDLE_Y - guardY());
              pAI.aim = U.clamp(ang / 1.05, -0.8, 0.8);
            }
          }
          // A misjudgement is fixed per approach, like a human who reads the bounce slightly wrong.
          const land = predictX(ball.x, ball.y, ball.vx, ball.vy, PADDLE_Y - R);
          target = land - pAI.aim * (PW / 2) + pAI.err;
        } else {
          pAI.armed = false;
          target = U.lerp(paddle.x, ball.x, 0.5);
        }
        if (pAI.react > 0) { pAI.react -= dt; return; }
        paddle.x += U.clamp(target - paddle.x, -sk.speed * dt, sk.speed * dt);
      }

      // ------------------------------------------------ computer guard
      function guardAI(dt) {
        const sk = guardSkill(level);
        const gy = guardY() + GH;
        let target = W / 2;
        if (served && ball.vy < 0 && ball.y > gy) {
          if (!gAI.armed) {
            gAI.armed = true;
            gAI.react = sk.delay;
            gAI.err = U.rand(-sk.err, sk.err);
            const land = predictX(ball.x, ball.y, ball.vx, ball.vy, gy);
            // Hit the ball with the side of the guard that sends it away from the paddle.
            gAI.aim = sk.aim ? (paddle.x < land ? 0.55 : -0.55) : 0;
          }
          const land = predictX(ball.x, ball.y, ball.vx, ball.vy, gy + R);
          target = land - gAI.aim * (GW / 2) + gAI.err;
        } else {
          gAI.armed = false;
          target = U.lerp(guard.x, W / 2, 0.02);
        }
        if (gAI.react > 0) { gAI.react -= dt; return; }
        guard.x += U.clamp(target - guard.x, -sk.speed * dt, sk.speed * dt);
      }

      // ------------------------------------------------ human controls
      function humanPaddle(dt) {
        const k = api.keys;
        if (k.has('ArrowLeft') || k.has('KeyA')) { paddle.x -= 640 * dt; mouseUsed = false; }
        if (k.has('ArrowRight') || k.has('KeyD')) { paddle.x += 640 * dt; mouseUsed = false; }
        if (mouseUsed) paddle.x = api.mouse.x;
        if (api.pressed('Space')) serve();
      }
      function humanGuard(dt) {
        // The human guard obeys the same speed cap as the computer's would at a high level.
        const cap = Math.min(0.8 * ball.s, 430) * tire() * dt;
        let target = guard.x;
        const k = api.keys;
        if (k.has('ArrowLeft') || k.has('KeyA')) { target = guard.x - 1000; mouseUsed = false; }
        if (k.has('ArrowRight') || k.has('KeyD')) { target = guard.x + 1000; mouseUsed = false; }
        if (mouseUsed) target = api.mouse.x;
        guard.x += U.clamp(target - guard.x, -cap, cap);
      }

      // ------------------------------------------------ physics
      function physics(dt) {
        const n = Math.ceil((ball.s * dt) / 4);
        const h = dt / n;
        const gTop = guardY(), gBot = gTop + GH;
        for (let i = 0; i < n; i++) {
          const px = ball.x, py = ball.y;
          ball.x += ball.vx * h;
          ball.y += ball.vy * h;
          if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); api.sfx.blip(); }
          if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); api.sfx.blip(); }
          if (ball.y < TOP + R) { ball.y = TOP + R; ball.vy = Math.abs(ball.vy); api.sfx.blip(); }

          // Guard: one-way, only stops balls travelling up.
          if (ball.vy < 0 && py - R >= gBot && ball.y - R < gBot && Math.abs(ball.x - guard.x) <= GW / 2 + R) {
            ball.y = gBot + R;
            ball.s = Math.min(ball.s * 1.02, baseSpeed * 1.35);
            bounceOff((ball.x - guard.x) / (GW / 2), false);
            guard.streak++;
            api.sfx.hit();
          }
          // Paddle
          if (ball.vy > 0 && py + R <= PADDLE_Y && ball.y + R > PADDLE_Y && Math.abs(ball.x - paddle.x) <= PW / 2 + R) {
            ball.y = PADDLE_Y - R;
            ball.s = Math.min(ball.s * 1.01, baseSpeed * 1.35);
            bounceOff((ball.x - paddle.x) / (PW / 2), true);
            api.sfx.blip();
          }
          // Bricks (at most one per sub-step)
          for (const b of bricks) {
            if (!b.alive) continue;
            const cx = U.clamp(ball.x, b.x, b.x + BW), cy = U.clamp(ball.y, b.y, b.y + BH);
            if ((ball.x - cx) ** 2 + (ball.y - cy) ** 2 > R * R) continue;
            b.alive = false;
            guard.streak = 0;
            score += 10;
            if (px < b.x || px > b.x + BW) ball.vx = -ball.vx; else ball.vy = -ball.vy;
            api.sfx.pop();
            break;
          }
          if (god && ball.vy > 0 && ball.y > H - R) { ball.y = H - R; ball.vy = -ball.vy; } // GOD cheat: a floor
          if (ball.y > H + R) return lost();
        }
        if (!bricks.some((b) => b.alive)) cleared();
      }

      function lost() {
        api.sfx.bad();
        lives--;
        if (lives > 0) { api.flash(`Ball lost — ${lives} left`, 1); newBall(); return; }
        if (mode === 'classic') {
          over = true;
          api.after(0.6, () => api.end({ title: 'GAME OVER', score, lines: [`Score ${score}`, `Reached level ${level}`] }));
        } else if (rounds) {
          served = false; serveT = 99;
          rounds.win('Paddle is out of balls!');
        } else {
          api.flash('Guard wins. New wall.', 1.2);
          lives = 3;
          newLevel(1);
        }
      }
      function cleared() {
        if (rounds) {
          served = false; serveT = 99;
          rounds.lose('The wall is down!');
          return;
        }
        api.sfx.good();
        api.flash(`LEVEL ${level + 1}`, 1.2, '#7dff7a');
        newLevel(level + 1);
      }

      newLevel(1);

      return {
        // Cheat codes. Flipped mode's LEVEL / SKIP / LIVES / GOD come from Rounds.
        cheat(code, n) {
          if (rounds) return;
          if (code === 'SKIP') { cleared(); return `Level ${level}`; }
          if (code === 'LEVEL') { newLevel(n); return `Level ${n}`; }
          if (code === 'LIVES') { lives = 3; return 'Balls refilled'; }
          if (code === 'GOD') { god = !god; return god ? 'God mode on: the ball bounces off the floor' : 'God mode off'; }
        },
        pointerMove() { mouseUsed = true; },
        pointerDown() { mouseUsed = true; if (!cpuPaddle) serve(); },
        update(dt) {
          if (over || (rounds && rounds.busy)) return;
          if (cpuPaddle) paddleAI(dt); else humanPaddle(dt);
          if (cpuGuard) guardAI(dt); else humanGuard(dt);
          paddle.x = U.clamp(paddle.x, PW / 2, W - PW / 2);
          guard.x = U.clamp(guard.x, GW / 2, W - GW / 2);
          if (!served) {
            ball.x = paddle.x;
            serveT -= dt;
            if (serveT <= 0) serve();
            return;
          }
          physics(dt);
        },
        draw(ctx) {
          ctx.fillStyle = '#0a0612';
          ctx.fillRect(0, 0, W, H);
          for (const b of bricks) {
            if (!b.alive) continue;
            ctx.fillStyle = ROW_COLORS[b.r % ROW_COLORS.length];
            ctx.fillRect(b.x, b.y, BW, BH);
            ctx.fillStyle = 'rgba(255,255,255,.25)';
            ctx.fillRect(b.x, b.y, BW, 3);
          }
          const gy = guardY();
          ctx.strokeStyle = 'rgba(200,107,255,.18)';
          ctx.setLineDash([4, 8]);
          ctx.beginPath(); ctx.moveTo(0, gy + GH / 2); ctx.lineTo(W, gy + GH / 2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.shadowColor = '#c86bff';
          ctx.shadowBlur = 14;
          ctx.fillStyle = `hsl(280, ${Math.round(100 * tire())}%, ${Math.round(45 + 25 * tire())}%)`; // fades as it tires
          ctx.fillRect(guard.x - GW / 2, gy, GW, GH);
          ctx.shadowColor = '#4ff3ff';
          ctx.fillStyle = '#4ff3ff';
          ctx.fillRect(paddle.x - PW / 2, PADDLE_Y, PW, PH);
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2); ctx.fill();

          if (!served && !cpuPaddle && !over) Draw.text(ctx, 'CLICK OR SPACE TO SERVE', W / 2, 520, 11, '#ffd36b', 'center');
          const balls = `BALLS ${'●'.repeat(Math.max(0, lives))}`;
          if (mode === 'classic') Draw.hud(ctx, `SCORE ${score}`, `LEVEL ${level}`, balls);
          else if (rounds) Draw.hud(ctx, rounds.hud(), `CPU ${balls}`, `BRICKS ${bricks.filter((b) => b.alive).length}`);
          else Draw.hud(ctx, `SCORE ${score}`, `DEMO LV ${level}`, balls);
        },
      };
    },
  });
})();
