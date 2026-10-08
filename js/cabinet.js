/*
 * Cocktail Cabinet — shared engine.
 *
 * Every game registers a definition:
 *   Cabinet.register({ id, title, color, tagline, flip, modes: [...], create(api) })
 * create(api) returns an instance with any of:
 *   update(dt), draw(ctx), pointerDown(x, y, button), pointerMove(x, y), pointerUp(x, y, button),
 *   keyDown(code), destroy()
 *
 * The engine runs a fixed 60 Hz update loop, converts mouse/touch to 800x600 game coordinates,
 * and owns the pause / game-over overlay. Nothing here talks to a server.
 */
(function () {
  'use strict';

  const W = 800, H = 600, STEP = 1 / 60;
  const games = [];

  // ---------------------------------------------------------------- utilities
  const U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    rand: (a, b) => a + Math.random() * (b - a),
    randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    lerp: (a, b, t) => a + (b - a) * t,
    dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    wrap: (v, m) => ((v % m) + m) % m,
    // signed smallest difference b - a between two angles, in (-PI, PI]
    angDiff: (a, b) => {
      let d = (b - a) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d <= -Math.PI) d += Math.PI * 2;
      return d;
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };

  // ---------------------------------------------------------------- drawing helpers
  const FONT = '"Press Start 2P", monospace';
  const Draw = {
    text(ctx, str, x, y, size = 12, color = '#fff', align = 'left', baseline = 'alphabetic') {
      ctx.font = `${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.fillText(str, x, y);
    },
    // A strip across the top of the screen: left, centre and right labels.
    hud(ctx, left, center, right, color = '#fff') {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, W, 26);
      if (left) Draw.text(ctx, left, 10, 18, 11, color, 'left');
      if (center) Draw.text(ctx, center, W / 2, 18, 11, color, 'center');
      if (right) Draw.text(ctx, right, W - 10, 18, 11, color, 'right');
    },
    hearts(n, max = 3) {
      return '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, max - n));
    },
    // Thin bar used for meters (hunger, energy, timers).
    meter(ctx, x, y, w, h, frac, color, back = 'rgba(255,255,255,.15)') {
      ctx.fillStyle = back;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w * U.clamp(frac, 0, 1), h);
    },
  };

  // ---------------------------------------------------------------- sound (tiny WebAudio synth)
  let audio = null;
  let muted = false;
  try { muted = localStorage.getItem('cabinet:muted') === '1'; } catch (e) { /* storage blocked */ }

  function tone(freq = 440, dur = 0.08, type = 'square', vol = 0.04, slideTo = 0) {
    if (muted || typeof window === 'undefined' || !window.AudioContext) return;
    try {
      if (!audio) audio = new AudioContext();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime;
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* audio is optional */ }
  }
  const SFX = {
    blip: () => tone(660, 0.05, 'square', 0.03),
    hit: () => tone(220, 0.08, 'square', 0.04),
    pop: () => tone(880, 0.06, 'triangle', 0.05, 440),
    boom: () => tone(120, 0.3, 'sawtooth', 0.05, 40),
    shoot: () => tone(1200, 0.07, 'square', 0.025, 500),
    good: () => { tone(523, 0.1, 'triangle', 0.05); setTimeout(() => tone(784, 0.15, 'triangle', 0.05), 90); },
    bad: () => { tone(300, 0.15, 'sawtooth', 0.04); setTimeout(() => tone(180, 0.25, 'sawtooth', 0.04), 120); },
  };

  // ---------------------------------------------------------------- best scores (per game + side)
  function bestKey(gameId, modeId) { return `cabinet:best:${gameId}:${modeId}`; }
  function getBest(gameId, modeId) {
    try { return Number(localStorage.getItem(bestKey(gameId, modeId))) || 0; } catch (e) { return 0; }
  }
  function setBest(gameId, modeId, score) {
    try { localStorage.setItem(bestKey(gameId, modeId), String(score)); } catch (e) { /* ignore */ }
  }

  /*
   * Rounds — the scoring used whenever the human plays the "other" side (and the computer plays
   * the hero). Each round the computer has a goal. If you stop it, you win the round and the next
   * round's computer is a little smarter (level + 1). If it reaches its goal, you lose a heart and
   * replay the same level. Out of hearts: game over. That gives a gentle, self-correcting ramp.
   */
  function Rounds(api, opts) {
    const r = {
      level: 1,
      hearts: opts.hearts || 3,
      maxHearts: opts.hearts || 3,
      won: 0,
      busy: false, // true between the end of one round and the start of the next
      win(text) {
        if (r.busy) return;
        r.busy = true;
        r.won++;
        r.level++;
        api.sfx.good();
        api.flash(text || 'ROUND WON!', 1.6, '#7dff7a');
        api.after(1.8, () => { r.busy = false; opts.next(r.level); });
      },
      lose(text) {
        if (r.busy) return;
        r.busy = true;
        r.hearts--;
        api.sfx.bad();
        if (r.hearts <= 0) {
          api.flash(text || 'The computer made it.', 1.6, '#ff5a5a');
          api.after(1.6, () => api.end({
            title: 'GAME OVER',
            score: r.won,
            lines: [`Rounds won: ${r.won}`, `You reached level ${r.level}.`],
          }));
          return;
        }
        api.flash((text || 'The computer made it.') + ' -1 ♥', 1.6, '#ff5a5a');
        api.after(1.8, () => { r.busy = false; opts.next(r.level); });
      },
      hud() { return `LV ${r.level}  ${Draw.hearts(r.hearts, r.maxHearts)}  WON ${r.won}`; },
    };
    return r;
  }

  // ---------------------------------------------------------------- runtime state
  const Cabinet = { W, H, U, Draw, SFX, Rounds, games, register, boot, start, tone, isMuted: () => muted };
  window.Cabinet = Cabinet;

  function register(def) { games.push(def); }

  let canvas, ctx, overlay, domStage;
  let current = null;   // { def, mode, inst, api, paused, over, timers, banners }
  let raf = 0, lastT = 0, acc = 0;
  const input = { keys: new Set(), pressed: new Set(), mouse: { x: W / 2, y: H / 2, down: false } };

  const $ = (s) => document.querySelector(s);

  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    window.scrollTo(0, 0);
  }

  // ---- URLs: every game has its own address (/snake, /breakout, ...). Netlify serves index.html
  // for every path (see netlify.toml) and route() picks the screen from the path. A game marked
  // hidden gets no card on the menu, but its address still works if you type it in.
  const slugOf = (g) => g.slug || g.id;
  function go(path) {
    try { if (location.pathname !== path) history.pushState({}, '', path); } catch (e) { /* e.g. opened from file:// */ }
    route();
  }
  function route() {
    stop();
    const slug = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, '').toLowerCase();
    const def = slug && games.find((g) => slugOf(g) === slug);
    if (def) {
      openSetup(def);
      document.title = `${def.title} · Cocktail Cabinet`;
      return;
    }
    if (slug && slug !== 'index.html') { try { history.replaceState({}, '', '/'); } catch (e) { /* */ } }
    document.title = 'Cocktail Cabinet';
    show('menu');
  }

  function boot() {
    canvas = $('#screen');
    ctx = canvas.getContext('2d');
    overlay = $('#overlay');
    domStage = $('#dom-stage');

    // ---- menu cards
    const grid = $('#game-grid');
    games.filter((g) => !g.hidden).forEach((g, i) => {
      const b = document.createElement('a');
      b.className = 'card';
      b.href = '/' + slugOf(g);
      b.style.setProperty('--c', g.color);
      b.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span>
        <h3>${g.title}</h3><p>${g.tagline}</p><p class="flip">${g.flip ? `Flip: ${g.flip}` : g.badge || ''}</p>`;
      b.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // let "open in new tab" work
        e.preventDefault();
        go('/' + slugOf(g));
      });
      grid.appendChild(b);
    });

    document.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => go('/')));
    $('#btn-menu').addEventListener('click', () => go('/'));
    $('#btn-side').addEventListener('click', () => { const g = current && current.def; stop(); if (g) openSetup(g); });
    $('#btn-pause').addEventListener('click', () => togglePause());
    const muteBtn = $('#btn-mute');
    const paintMute = () => { muteBtn.textContent = muted ? 'Sound off' : 'Sound on'; };
    paintMute();
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      try { localStorage.setItem('cabinet:muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      paintMute();
    });

    // ---- keyboard
    const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    window.addEventListener('keydown', (e) => {
      if (!current) return;
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
      if (typing) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!current.over && !current.def.dom) togglePause();
        e.preventDefault();
        return;
      }
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!input.keys.has(e.code)) input.pressed.add(e.code);
      input.keys.add(e.code);
      if (current.inst.keyDown && !current.paused && !current.over) current.inst.keyDown(e.code);
    });
    window.addEventListener('keyup', (e) => input.keys.delete(e.code));
    window.addEventListener('blur', () => { input.keys.clear(); if (current && !current.def.dom && !current.over) pause(true); });

    // ---- pointer (mouse + touch) mapped into 800x600 game space
    const toGame = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!current || current.paused || current.over) return;
      canvas.setPointerCapture(e.pointerId);
      const p = toGame(e);
      Object.assign(input.mouse, p, { down: true });
      current.inst.pointerDown && current.inst.pointerDown(p.x, p.y, e.button, e);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = toGame(e);
      input.mouse.x = p.x; input.mouse.y = p.y;
      if (current && !current.paused && !current.over && current.inst.pointerMove) current.inst.pointerMove(p.x, p.y, e);
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = toGame(e);
      input.mouse.down = false;
      if (current && !current.paused && !current.over && current.inst.pointerUp) current.inst.pointerUp(p.x, p.y, e.button, e);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && current && !current.def.dom && !current.over) pause(true);
    });

    window.addEventListener('popstate', route);
    route();
  }

  function openSetup(def) {
    show('setup');
    const setup = $('#setup');
    setup.style.setProperty('--c', def.color);
    $('#setup-title').textContent = def.title;
    $('#setup-tagline').textContent = def.tagline;
    const box = $('#setup-modes');
    box.innerHTML = '';
    for (const m of def.modes) {
      const b = document.createElement('button');
      b.className = 'mode';
      const best = getBest(def.id, m.id);
      b.innerHTML = `<div class="who">You: <b>${m.you}</b><br>Computer: <i>${m.cpu}</i></div>
        <div class="how">${m.how}</div>
        <div class="best">${m.id === 'demo' ? 'Sit back and watch.' : `Best: ${best}`}</div>`;
      b.addEventListener('click', () => start(def, m.id));
      box.appendChild(b);
    }
  }

  function makeApi(def, modeId) {
    const run = current;
    const api = {
      W, H, U, Draw, mode: modeId, sfx: SFX,
      keys: input.keys,
      mouse: input.mouse,
      pressed: (code) => input.pressed.has(code),
      dom: domStage,
      // Run fn after `sec` seconds of *game* time (so pausing also pauses timers).
      after(sec, fn) { run.timers.push({ t: sec, fn }); },
      flash(text, sec = 1.2, color = '#fff') { run.banners.push({ text, t: sec, color }); },
      end(result) { finish(run, result); },
      best: () => getBest(def.id, modeId),
      Rounds: (opts) => Rounds(api, opts),
    };
    return api;
  }

  function start(def, modeId) {
    stop();
    show('play');
    const mode = def.modes.find((m) => m.id === modeId);
    const play = $('#play');
    play.style.setProperty('--c', def.color);
    $('#stage').style.setProperty('--c', def.color);
    $('#play-title').textContent = `${def.title} · you: ${mode.you}`;
    $('#play-help').textContent = mode.how + (def.dom ? '' : '  (P / Esc pauses.)');
    $('#btn-pause').hidden = !!def.dom;
    canvas.hidden = !!def.dom;
    domStage.hidden = !def.dom;
    domStage.innerHTML = '';
    overlay.hidden = true;
    input.keys.clear();
    input.pressed.clear();

    current = { def, mode, inst: null, api: null, paused: false, over: false, timers: [], banners: [] };
    current.api = makeApi(def, modeId);
    current.inst = def.create(current.api);
    lastT = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (current && current.inst && current.inst.destroy) {
      try { current.inst.destroy(); } catch (e) { console.error(e); }
    }
    current = null;
    if (overlay) overlay.hidden = true;
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const run = current;
    if (!run) return;
    const dt = Math.min(0.1, (t - lastT) / 1000);
    lastT = t;
    if (!run.paused && !run.over) {
      acc += dt;
      while (acc >= STEP && !run.over) {
        tick(run, STEP);
        acc -= STEP;
      }
    }
    if (run.inst.draw) {
      ctx.save();
      run.inst.draw(ctx);
      ctx.restore();
      drawBanners(run);
    }
  }

  function tick(run, dt) {
    if (run.inst.update) run.inst.update(dt);
    input.pressed.clear();
    for (let i = run.timers.length - 1; i >= 0; i--) {
      const tm = run.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { run.timers.splice(i, 1); tm.fn(); }
    }
    for (let i = run.banners.length - 1; i >= 0; i--) {
      run.banners[i].t -= dt;
      if (run.banners[i].t <= 0) run.banners.splice(i, 1);
    }
  }

  function drawBanners(run) {
    const b = run.banners[run.banners.length - 1];
    if (!b) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, b.t * 3);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(0, H / 2 - 34, W, 60);
    Draw.text(ctx, b.text, W / 2, H / 2, 16, b.color, 'center', 'middle');
    ctx.restore();
  }

  function pause(force) {
    if (!current || current.over) return;
    current.paused = force === undefined ? !current.paused : force;
    if (current.inst.setPaused) current.inst.setPaused(current.paused); // e.g. pause a game's own music
    $('#btn-pause').textContent = current.paused ? 'Resume' : 'Pause';
    if (current.paused) {
      showOverlay('PAUSED', ['Press P or Esc to resume.'], [
        ['Resume', () => pause(false)],
        ['Restart', () => start(current.def, current.mode.id), true],
      ]);
    } else {
      overlay.hidden = true;
      lastT = performance.now();
    }
  }
  function togglePause() { pause(); }

  function finish(run, result) {
    if (run !== current || run.over) return;
    run.over = true;
    const lines = (result.lines || []).slice();
    if (typeof result.score === 'number' && run.mode.id !== 'demo') {
      const best = getBest(run.def.id, run.mode.id);
      if (result.score > best) {
        setBest(run.def.id, run.mode.id, result.score);
        lines.push('New best!');
      } else {
        lines.push(`Best: ${best}`);
      }
    }
    showOverlay(result.title || 'GAME OVER', lines, [
      ['Play again', () => start(run.def, run.mode.id)],
      ['Switch side', () => { stop(); openSetup(run.def); }, true],
      ['Cabinet', () => go('/'), true],
    ]);
  }

  function showOverlay(title, lines, buttons) {
    overlay.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = title;
    overlay.appendChild(h);
    for (const l of lines) {
      const p = document.createElement('p');
      p.textContent = l;
      overlay.appendChild(p);
    }
    const row = document.createElement('div');
    row.className = 'row';
    for (const [label, fn, alt] of buttons) {
      const b = document.createElement('button');
      b.className = alt ? 'btn alt' : 'btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      row.appendChild(b);
    }
    overlay.appendChild(row);
    overlay.hidden = false;
  }
})();
