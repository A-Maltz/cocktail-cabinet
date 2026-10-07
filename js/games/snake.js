/*
 * SNAKE
 *   Sides: the Snake (eat apples, don't crash) and the Apple placer (decides where food appears).
 *   classic — you steer, the computer places apples (meaner as you grow, but never a guaranteed trap).
 *   flipped — you place apples by clicking, the computer steers. Make it crash or starve.
 *
 * Snake AI: breadth-first search to the apple. Before committing it simulates eating the apple and
 * checks it could still reach its own tail afterwards (so it won't seal itself in). With no safe
 * path it stalls by picking the move that keeps the most open space. Lower levels skip the safety
 * check some of the time and occasionally fumble — that is what makes early rounds winnable.
 */
(function () {
  'use strict';
  const { U, Draw } = Cabinet;

  // Board size. Classic uses a big 32x23 board; flipped uses a tighter 20x14 one with bigger cells,
  // where the snake grows 3 per apple, so its own body becomes the trap you build.
  // (Module-level because the search helpers below use them; only one game runs at a time.)
  let COLS = 32, ROWS = 23, CS = 25;
  const TOP = 25;
  const DIRS = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  const key = (x, y) => x + y * COLS;
  const kx = (k) => k % COLS;
  const ky = (k) => (k / COLS) | 0;
  const inside = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

  // Breadth-first search over the grid from (sx, sy), avoiding `blocked` cells.
  function bfs(sx, sy, blocked) {
    const n = COLS * ROWS;
    const dist = new Int16Array(n).fill(-1);
    const prev = new Int16Array(n).fill(-1);
    const start = key(sx, sy);
    const q = [start];
    dist[start] = 0;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], cx = kx(c), cy = ky(c);
      for (const d of DIRS) {
        const nx = cx + d.x, ny = cy + d.y;
        if (!inside(nx, ny)) continue;
        const k = key(nx, ny);
        if (dist[k] !== -1 || blocked.has(k)) continue;
        dist[k] = dist[c] + 1;
        prev[k] = c;
        q.push(k);
      }
    }
    return { dist, prev, reached: q.length };
  }
  // Cells from the start (exclusive) to target k (inclusive), or null if unreachable.
  function pathTo(res, k) {
    if (res.dist[k] < 0) return null;
    const p = [];
    while (res.dist[k] > 0) { p.push(k); k = res.prev[k]; }
    return p.reverse();
  }

  Cabinet.register({
    id: 'snake',
    title: 'Snake',
    color: '#7dff7a',
    tagline: 'Eat apples, grow longer, never bite yourself.',
    flip: 'you place the apples, the computer steers.',
    modes: [
      { id: 'classic', you: 'Snake', cpu: 'Apple placer',
        how: 'Steer with the arrow keys or WASD. The computer picks where each apple lands and gets sneakier as you grow, but it never places one that is a guaranteed death trap.' },
      { id: 'flipped', you: 'Apple placer', cpu: 'Snake',
        how: 'Click a square to drop the next apple (it must be 4+ squares from the head and reachable). Make the snake crash or starve before it eats its quota. Each round the snake gets smarter. 3 hearts.' },
      { id: 'demo', you: 'Spectator', cpu: 'Snake and apple placer', how: 'The computer plays both sides.' },
    ],

    create(api) {
      const mode = api.mode;
      const cpuSnake = mode !== 'classic';
      const cpuApples = mode !== 'flipped';
      if (mode === 'flipped') { COLS = 20; ROWS = 14; CS = 40; } else { COLS = 32; ROWS = 23; CS = 25; }
      const GROW = mode === 'flipped' ? 3 : 1;

      let snake, dir, queue, grow, apple, moveT, score, eaten, hunger, dead, placeT, hover, demoLevel;
      const rounds = mode === 'flipped' ? api.Rounds({ next: () => reset() }) : null;

      const level = () => (rounds ? rounds.level : mode === 'demo' ? demoLevel : 1);
      const quota = () => 10 + 2 * level();
      const hungerMax = () => 50 + snake.length;
      // Seconds per move: classic speeds up with score, flipped with level.
      const interval = () => mode === 'classic'
        ? Math.max(0.055, 0.13 - score * 0.0025)
        : Math.max(0.06, 0.11 - (level() - 1) * 0.007);

      function reset() {
        const cy = (ROWS / 2) | 0;
        snake = [{ x: 8, y: cy }, { x: 7, y: cy }, { x: 6, y: cy }, { x: 5, y: cy }];
        dir = { x: 1, y: 0 };
        queue = [];
        grow = 0;
        apple = null;
        moveT = 0;
        eaten = 0;
        hunger = 0;
        dead = false;
        placeT = 0;
        if (cpuApples) placeAppleCPU();
      }

      // Every cell the snake will still occupy after its next move (the tail leaves unless growing).
      function bodyBlocked() {
        const s = new Set();
        const n = grow > 0 ? snake.length : snake.length - 1;
        for (let i = 0; i < n; i++) s.add(key(snake[i].x, snake[i].y));
        return s;
      }
      const occupied = (x, y) => snake.some((s) => s.x === x && s.y === y);

      // Simulate following `path` (ending on the apple) and check the snake can still reach its tail.
      function safeAfter(path) {
        const body = snake.map((s) => key(s.x, s.y));
        const vs = path.slice().reverse().concat(body).slice(0, body.length + 1);
        const head = vs[0], tail = vs[vs.length - 1];
        const blocked = new Set(vs.slice(1, -1));
        return bfs(kx(head), ky(head), blocked).dist[tail] > 0;
      }

      // ------------------------------------------------ computer steering
      function aiDir() {
        const lv = level();
        const h = snake[0];
        const blocked = bodyBlocked();
        const safetyChance = [0, 0, 0.4, 0.7, 0.9, 1][Math.min(lv, 5)];
        const fumble = Math.max(0, 0.06 - lv * 0.015);

        const legal = DIRS.filter((d) => {
          const nx = h.x + d.x, ny = h.y + d.y;
          return inside(nx, ny) && !blocked.has(key(nx, ny));
        });
        if (!legal.length) return dir; // boxed in: nothing to do

        if (U.chance(fumble)) return U.pick(legal);

        const res = bfs(h.x, h.y, blocked);
        if (apple) {
          const path = pathTo(res, key(apple.x, apple.y));
          if (path) {
            const starving = mode === 'flipped' && hungerMax() - hunger < path.length + 6;
            const careful = U.chance(safetyChance) && !starving;
            if (!careful || safeAfter(path)) return dirToward(h, path[0]);
          }
        }
        // Stall: choose the move that keeps the most room and, ideally, keeps the tail in reach.
        const tail = snake[snake.length - 1];
        let best = legal[0], bestScore = -1;
        for (const d of legal) {
          const nx = h.x + d.x, ny = h.y + d.y;
          const b2 = new Set(blocked);
          b2.add(key(h.x, h.y));
          b2.delete(key(tail.x, tail.y));
          const r = bfs(nx, ny, b2);
          const tailOk = r.dist[key(tail.x, tail.y)] > 0;
          const s = r.reached + (tailOk ? 2000 : 0) + (tailOk ? r.dist[key(tail.x, tail.y)] : 0);
          if (s > bestScore) { bestScore = s; best = d; }
        }
        return best;
      }
      function dirToward(h, k) { return { x: kx(k) - h.x, y: ky(k) - h.y }; }

      // ------------------------------------------------ computer apple placement
      function placeAppleCPU() {
        const h = snake[0];
        const res = bfs(h.x, h.y, bodyBlocked());
        const cands = [];
        for (let k = 0; k < COLS * ROWS; k++) {
          const d = res.dist[k];
          if (d < 3) continue;
          const x = kx(k), y = ky(k);
          if (occupied(x, y)) continue;
          // "Hard" cells: hugging walls or the snake's body, and far away.
          let tight = 0;
          for (const dd of DIRS) {
            const nx = x + dd.x, ny = y + dd.y;
            if (!inside(nx, ny) || occupied(nx, ny)) tight++;
          }
          cands.push({ k, hard: tight * 3 + Math.min(d, 30) * 0.25 + Math.random() });
        }
        if (!cands.length) { apple = null; return; }
        // Level 0 picks uniformly; each level narrows the pool towards the hardest cells.
        const lv = mode === 'classic' ? Math.floor(score / 4) : Math.floor(score / 5);
        const frac = Math.max(0.12, 1 - lv * 0.12);
        cands.sort((a, b) => b.hard - a.hard);
        const pool = U.shuffle(cands.slice(0, Math.max(1, Math.ceil(cands.length * frac))));
        // Fairness: never a cell where eating it leaves no way back to the tail.
        for (const c of pool.slice(0, 40)) {
          if (safeAfter(pathTo(res, c.k))) { apple = { x: kx(c.k), y: ky(c.k) }; return; }
        }
        const c = U.pick(cands);
        apple = { x: kx(c.k), y: ky(c.k) };
      }

      // ------------------------------------------------ human apple placement
      function validHumanCell(x, y) {
        if (!inside(x, y) || occupied(x, y)) return false;
        const h = snake[0];
        if (Math.abs(h.x - x) + Math.abs(h.y - y) < 4) return false;
        return bfs(h.x, h.y, bodyBlocked()).dist[key(x, y)] > 0;
      }
      function cellAt(px, py) { return { x: Math.floor(px / CS), y: Math.floor((py - TOP) / CS) }; }
      function autoPlace() {
        const opts = [];
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (validHumanCell(x, y)) opts.push({ x, y });
        if (opts.length) apple = U.pick(opts);
      }

      // ------------------------------------------------ simulation
      function step() {
        if (cpuSnake) dir = aiDir();
        else if (queue.length) dir = queue.shift();

        const h = snake[0];
        const nx = h.x + dir.x, ny = h.y + dir.y;
        if (!inside(nx, ny) || bodyBlocked().has(key(nx, ny))) return die('CRASH!');

        snake.unshift({ x: nx, y: ny });
        if (apple) hunger++; // no hunger while the placer is still deciding
        if (apple && apple.x === nx && apple.y === ny) {
          grow += GROW;
          score++;
          eaten++;
          hunger = 0;
          apple = null;
          api.sfx.pop();
          if (rounds && eaten >= quota()) {
            rounds.lose(`Snake ate ${quota()} apples.`);
          } else if (cpuApples) {
            placeAppleCPU();
          } else {
            placeT = 0;
          }
        }
        if (grow > 0) grow--; else snake.pop();
        if (rounds && hunger >= hungerMax()) die('STARVED!');
      }

      function die(why) {
        dead = true;
        api.sfx.boom();
        if (mode === 'classic') {
          api.after(0.8, () => api.end({ title: why, score, lines: [`Apples eaten: ${score}`] }));
        } else if (rounds) {
          rounds.win(`${why} You win the round.`);
        } else {
          api.flash(`${why}  ${score} apples`, 1.4);
          api.after(1.5, () => { score = 0; demoLevel = Math.min(5, demoLevel + 1); reset(); });
        }
      }

      score = 0;
      demoLevel = 1;
      hover = null;
      reset();

      return {
        keyDown(code) {
          if (cpuSnake) return;
          const map = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
            ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
          const m = map[code];
          if (!m) return;
          const last = queue.length ? queue[queue.length - 1] : dir;
          if (m[0] === -last.x && m[1] === -last.y) return; // no reversing into yourself
          if (m[0] === last.x && m[1] === last.y) return;
          if (queue.length < 3) queue.push({ x: m[0], y: m[1] });
        },
        pointerMove(x, y) { hover = cellAt(x, y); },
        pointerDown(x, y) {
          if (mode !== 'flipped' || dead || apple || (rounds && rounds.busy)) return;
          const c = cellAt(x, y);
          if (validHumanCell(c.x, c.y)) { apple = c; api.sfx.blip(); } else api.sfx.hit();
        },
        update(dt) {
          if (dead || (rounds && rounds.busy)) return;
          if (mode === 'flipped' && !apple) {
            placeT += dt;
            if (placeT > 5) autoPlace();
          }
          moveT += dt;
          const iv = interval();
          while (moveT >= iv && !dead && !(rounds && rounds.busy)) { moveT -= iv; step(); }
        },
        draw(ctx) {
          ctx.fillStyle = '#04120a';
          ctx.fillRect(0, 0, api.W, api.H);
          ctx.strokeStyle = 'rgba(125,255,122,.06)';
          ctx.lineWidth = 1;
          for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CS + 0.5, TOP); ctx.lineTo(x * CS + 0.5, TOP + ROWS * CS); ctx.stroke(); }
          for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, TOP + y * CS + 0.5); ctx.lineTo(COLS * CS, TOP + y * CS + 0.5); ctx.stroke(); }

          // Flipped: show the no-drop zone around the head and the hover cell.
          if (mode === 'flipped' && !apple && !dead) {
            const h = snake[0];
            ctx.fillStyle = 'rgba(255,90,90,.12)';
            for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
              if (Math.abs(h.x - x) + Math.abs(h.y - y) < 4) ctx.fillRect(x * CS, TOP + y * CS, CS, CS);
            }
            if (hover && inside(hover.x, hover.y)) {
              ctx.fillStyle = validHumanCell(hover.x, hover.y) ? 'rgba(255,80,80,.55)' : 'rgba(120,120,120,.35)';
              ctx.fillRect(hover.x * CS, TOP + hover.y * CS, CS, CS);
            }
          }

          if (apple) {
            const ax = apple.x * CS + CS / 2, ay = TOP + apple.y * CS + CS / 2;
            ctx.fillStyle = '#ff4040';
            ctx.beginPath(); ctx.arc(ax, ay + 1, CS * 0.38, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#5c3';
            ctx.fillRect(ax - 1, ay - CS * 0.45, 3, 6);
          }

          snake.forEach((s, i) => {
            const t = i / snake.length;
            ctx.fillStyle = dead ? '#777' : `hsl(${120 - t * 40}, 85%, ${58 - t * 22}%)`;
            ctx.fillRect(s.x * CS + 2, TOP + s.y * CS + 2, CS - 4, CS - 4);
          });
          const h = snake[0];
          // Two eyes, pushed forward along the direction of travel and spread sideways.
          ctx.fillStyle = '#000';
          const cx = h.x * CS + CS / 2 + dir.x * 4, cy = TOP + h.y * CS + CS / 2 + dir.y * 4;
          ctx.fillRect(cx - dir.y * 5 - 1.5, cy + dir.x * 5 - 1.5, 3, 3);
          ctx.fillRect(cx + dir.y * 5 - 1.5, cy - dir.x * 5 - 1.5, 3, 3);

          if (mode === 'classic') {
            Draw.hud(ctx, `APPLES ${score}`, 'YOU: SNAKE', `BEST ${api.best()}`);
          } else if (rounds) {
            Draw.hud(ctx, rounds.hud(), `EATEN ${eaten}/${quota()}`, '');
            Draw.text(ctx, 'HUNGER', 610, 18, 9, '#fff');
            Draw.meter(ctx, 680, 10, 110, 8, 1 - hunger / hungerMax(), hunger / hungerMax() > 0.75 ? '#ff5a5a' : '#7dff7a');
            if (!apple && !dead && !rounds.busy) {
              Draw.text(ctx, `CLICK TO DROP AN APPLE  ${Math.max(0, 5 - placeT).toFixed(1)}s`, api.W / 2, api.H - 8, 10, '#ffd36b', 'center');
            }
          } else {
            Draw.hud(ctx, `APPLES ${score}`, 'DEMO', `SNAKE LV ${demoLevel}`);
          }
        },
      };
    },
  });
})();
