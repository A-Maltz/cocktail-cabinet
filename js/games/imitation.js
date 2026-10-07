/*
 * IMITATION — a Turing-test chat.
 *   Sides: the Judge (works out whether the partner is human or AI) and the Imitator.
 *   classic — you judge. Your partner is either a real person in another browser or the computer
 *             pretending to be one.
 *   flipped — "play the AI": convince your partner that YOU are the machine. The judge is either a
 *             real person or the computer.
 *   Every match, both sides chat, then both give a verdict on the other.
 *   Chat is turn-based like humanornot.io: players alternate one message at a time, each with a
 *   20-second limit, 4 messages each. The computer "reads" and "types" at a human pace and always
 *   answers inside the limit, so reply speed doesn't give it away.
 *
 * Networking (no server of our own): PeerJS/WebRTC. PeerJS's free public broker is only used to
 * introduce two browsers; after that, messages go browser to browser. Matchmaking uses a handful of
 * well-known "lobby slot" IDs: first try to join someone waiting in a slot, otherwise wait in a free
 * slot. Searching always takes a few seconds, and if nobody turns up before a random deadline you
 * are matched with the computer, so the length of the search reveals nothing.
 *
 * The computer partner is a rule-based chatbot with a random persona (no API keys, no network).
 * As levels rise it types slower, makes typos and uses slang, so it gets harder to spot. As the
 * judge, it scores your messages for machine-like features and gets harder to fool.
 */
(function () {
  'use strict';
  const { U } = Cabinet;

  const PEER_SRC = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const LOBBY = 'cocktail-cabinet-imitation-v1-slot-';
  const SLOTS = 6;
  const TURN_SECONDS = 20;   // time limit for each message, like humanornot.io
  const TURNS_EACH = 4;      // messages per player before the verdict
  const VERDICT_WAIT = 25;

  // ================================================================ networking
  let peerLoading = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (!peerLoading) {
      peerLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PEER_SRC;
        s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS missing')));
        s.onerror = () => { peerLoading = null; reject(new Error('PeerJS failed to load')); };
        document.head.appendChild(s);
      });
    }
    return peerLoading;
  }
  // Open a Peer (with a fixed id, or a random one). Rejects if the id is taken or the broker is down.
  function openPeer(id) {
    return new Promise((resolve, reject) => {
      const p = id ? new window.Peer(id) : new window.Peer();
      const fail = (e) => { clearTimeout(t); p.off('error', fail); try { p.destroy(); } catch (_) { /* */ } reject(e); };
      const t = setTimeout(() => fail(new Error('timeout')), 8000);
      p.on('error', fail);
      p.on('open', () => { clearTimeout(t); p.off('error', fail); resolve(p); });
    });
  }

  function Matchmaker() {
    const mm = { me: null, host: null, conn: null, slot: -1, probing: false, stopped: false, timers: [] };
    const waiters = new Map(); // lobby id -> callback when the broker says that id doesn't exist

    // Ask whoever waits in `slot` for a match. Resolves with the open connection, or null.
    function tryJoin(slot) {
      return new Promise((resolve) => {
        const id = LOBBY + slot;
        if (!mm.me || mm.me.destroyed) return resolve(null);
        let settled = false;
        const conn = mm.me.connect(id, { reliable: true });
        const finish = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          waiters.delete(id);
          if (!ok) { try { conn.close(); } catch (_) { /* */ } }
          resolve(ok ? conn : null);
        };
        const t = setTimeout(() => finish(false), 3500);
        waiters.set(id, () => finish(false));
        conn.on('open', () => conn.send({ type: 'join' }));
        conn.on('data', (d) => { if (d && d.type === 'accept') finish(true); else if (d && d.type === 'busy') finish(false); });
        conn.on('error', () => finish(false));
        conn.on('close', () => finish(false));
      });
    }
    async function probe(upTo, onMatch) {
      for (let s = 0; s < upTo; s++) {
        if (mm.stopped || mm.conn) return true;
        mm.probing = true;
        const c = await tryJoin(s);
        mm.probing = false;
        if (c && !mm.stopped && !mm.conn) { mm.conn = c; onMatch(c, 'guest'); return true; }
        if (c) c.close();
      }
      return false;
    }

    mm.search = async (onMatch) => {
      try {
        await loadPeer();
        mm.me = await openPeer();
      } catch (e) { return; } // no network: the computer will be the match
      if (mm.stopped) return mm.destroy();
      mm.me.on('error', (e) => {
        if (e && e.type === 'peer-unavailable') {
          for (const [id, fn] of waiters) if (String(e.message).includes(id)) fn();
        }
      });
      // 1) Is anybody already waiting?
      if (await probe(SLOTS, onMatch)) return;
      // 2) Wait in the first free slot.
      for (let s = 0; s < SLOTS && !mm.host; s++) {
        if (mm.stopped || mm.conn) return;
        try { mm.host = await openPeer(LOBBY + s); mm.slot = s; } catch (e) { /* slot taken */ }
      }
      if (!mm.host) return;
      if (mm.stopped) return mm.destroy();
      mm.host.on('connection', (c) => {
        c.on('data', (d) => {
          if (!d || d.type !== 'join') return;
          if (mm.conn || mm.probing || mm.stopped) { c.send({ type: 'busy' }); setTimeout(() => c.close(), 400); return; }
          mm.conn = c;
          c.send({ type: 'accept' });
          onMatch(c, 'host');
        });
      });
      // 3) Two people could each be waiting in different slots. The one in the higher slot keeps
      //    checking the lower slots and joins, so they still find each other.
      const loop = async () => {
        if (mm.stopped || mm.conn) return;
        if (await probe(mm.slot, onMatch)) return;
        mm.timers.push(setTimeout(loop, 2500));
      };
      mm.timers.push(setTimeout(loop, 2000));
    };
    // Stop searching. Keeps only the peer that owns the live connection (if any).
    mm.stop = () => {
      mm.stopped = true;
      mm.timers.forEach(clearTimeout);
      const keep = mm.conn && mm.conn.provider;
      for (const p of [mm.me, mm.host]) if (p && p !== keep) { try { p.destroy(); } catch (_) { /* */ } }
    };
    mm.destroy = () => {
      mm.stop();
      for (const p of [mm.me, mm.host]) if (p) { try { p.destroy(); } catch (_) { /* */ } }
    };
    return mm;
  }

  // ================================================================ the computer partner
  const NAMES = ['sam', 'jess', 'alex', 'maya', 'tom', 'priya', 'dani', 'marcus', 'lena', 'josh', 'emma', 'noah', 'rachel', 'omar', 'kate', 'leo', 'chris', 'zoe'];
  const PLACES = ['ohio', 'toronto', 'manchester', 'brooklyn', 'austin', 'melbourne', 'dublin', 'new jersey', 'chicago', 'portland', 'leeds', 'denver', 'florida', 'phoenix'];
  const JOBS = ['in college, studying bio', 'i work at a coffee shop', 'nursing school', 'software intern lol', 'warehouse shifts mostly', 'high school senior', 'between jobs rn', 'studying accounting, pray for me', 'i do deliveries'];
  const HOBBIES = ['basketball', 'video games', 'drawing', 'baking', 'skating', 'guitar', 'anime', 'running', 'photography', 'thrifting', 'fantasy football', 'climbing'];
  const FAVS = {
    food: ['tacos', 'pizza obviously', 'my moms lasagna', 'sushi', 'chicken wings', 'pho'],
    color: ['green', 'black lol', 'blue', 'purple'],
    movie: ['interstellar', 'spiderverse', 'shrek 2 and im not joking', 'the dark knight', 'inception'],
    music: ['mostly rap', 'indie stuff', 'whatever spotify gives me', 'taylor swift dont judge', 'rock, old stuff', 'kpop'],
    song: ['changes every week', 'something by frank ocean', 'mr brightside forever'],
    game: ['minecraft', 'fortnite still', 'elden ring', 'mario kart', 'valorant'],
    animal: ['dogs', 'cats', 'otters', 'capybaras'],
    sport: ['basketball', 'soccer', 'f1', 'football'],
    show: ['the office', 'breaking bad', 'stranger things', 'the bear'],
    book: ['i dont really read lol', 'harry potter i guess', 'hunger games'],
  };
  const MOODS = ['good, kinda tired', 'pretty good hbu', 'eh im ok', 'bored honestly', 'not bad', 'good! just ate'];
  const CHAT_Q = [
    ['upto', 'what are you up to today'], ['place', 'where are you from'], ['age', 'how old are you'],
    ['job', 'what do you do'], ['music', 'what kind of music do you like'], ['how', 'how did you find this site'],
    ['first', 'have you done this before'], ['name', 'whats your name'], ['bot', 'do you think im a bot lol'],
  ];
  const JUDGE_Q = [
    ['probe', 'whats 17 times 24'], ['probe', 'what did you have for breakfast'], ['probe', 'describe your room in one sentence'],
    ['probe', 'how do you feel about mondays'], ['probe', 'say something only a human would say'], ['bot', 'are you an ai? be honest'],
    ['probe', 'whats the last thing that made you laugh'], ['probe', 'what does rain smell like'], ['probe', 'type the word necessary backwards'],
  ];
  const ABOUT_ME = (P) => ({
    name: [`${P.name}`, `im ${P.name}`, `${P.name}, you?`],
    age: [`${P.age}`, `${P.age}, u?`, `im ${P.age}`],
    place: [`${P.place}`, `${P.place}, its fine i guess`, `im in ${P.place}`],
    job: [P.job],
    hobby: [`${P.hobby} mostly`, `uhh ${P.hobby}? and sleeping`],
    music: [U.pick(FAVS.music)],
    upto: ['nothing much, procrastinating', 'supposed to be doing homework', 'just got home', 'literally nothing lol'],
    how: ['a friend sent me the link', 'saw it somewhere, cant remember', 'class thing'],
    first: ['first time', 'did it once before', 'nope first time'],
    bot: ['no lol', 'r u?'],
    probe: ['idk you tell me', 'hmm'],
  });

  function makePersona() {
    return { name: U.pick(NAMES), age: U.randi(17, 31), place: U.pick(PLACES), job: U.pick(JOBS), hobby: U.pick(HOBBIES) };
  }

  // Make a line look typed by a person: lowercase, shortcuts, the odd typo. Level 1 is stiff on purpose.
  function humanize(s, level) {
    if (level <= 1) {
      s = s.charAt(0).toUpperCase() + s.slice(1);
      if (!/[.!?]$/.test(s)) s += U.chance(0.7) ? '.' : '';
      return [s];
    }
    if (U.chance(0.35)) s = s.replace(/\byou\b/g, 'u');
    if (U.chance(0.25)) s = s.replace(/\bare\b/g, 'r');
    if (U.chance(0.3)) s = s.replace(/\bbecause\b/g, 'bc');
    s = s.replace(/[.]$/, '');
    if (U.chance(0.06)) s = s.toUpperCase().slice(0, 1) + s.slice(1);
    const out = [s];
    if (U.chance(Math.min(0.18, 0.06 * level))) {
      const words = s.split(' ');
      const i = words.findIndex((w) => w.length >= 4 && /^[a-z]+$/.test(w));
      const w = i >= 0 ? words[i] : '', j = U.randi(1, Math.max(1, w.length - 2));
      if (i >= 0 && w[j] !== w[j - 1]) { // swapping two identical letters wouldn't be a typo
        words[i] = w.slice(0, j - 1) + w[j] + w[j - 1] + w.slice(j + 1);
        out[0] = words.join(' ');
        if (U.chance(0.5)) out.push('*' + w);
      }
    }
    return out;
  }

  function makeBot(level, judging) {
    const P = makePersona();
    const me = ABOUT_ME(P);
    const pool = U.shuffle((judging ? JUDGE_Q.concat(CHAT_Q.slice(0, 3)) : CHAT_Q).slice());
    const st = { lastQ: null, said: new Set(), lastUser: '', turns: 0 };

    function ask() {
      const q = pool.shift();
      if (!q) return '';
      st.lastQ = q[0];
      return q[1] + (U.chance(0.5) ? '?' : '');
    }
    function fav(word) {
      for (const k of Object.keys(FAVS)) if (word.startsWith(k)) return U.pick(FAVS[k]);
      return U.pick(['hmm hard to pick', 'idk theres too many', 'no idea honestly']);
    }
    function math(a, op, b) {
      const v = op === '+' ? a + b : op === '-' ? a - b : op === '/' ? a / b : a * b;
      if (level <= 1) return `${Math.round(v * 100) / 100}`;           // instant and exact: a giveaway
      if (Math.abs(v) <= 20 && Number.isInteger(v)) return U.pick([`${v}`, `${v}?`, `uh ${v}`]);
      return U.pick(['im not doing that lol', 'do i look like a calculator', `like ${Math.round(v / 10) * 10}? idk`, 'no math today sorry', `${Math.round(v)}? i used my phone`]);
    }

    function respond(raw) {
      const t = raw.toLowerCase().trim();
      st.turns++;
      if (t === st.lastUser) return U.pick(['u said that already', 'yes i saw lol', 'ok??']);
      st.lastUser = t;
      let m;
      const reactTo = st.lastQ;
      if (/\b(are|r)\s+(you|u)\s+(a\s+|an\s+)?(bot|ai|robot|human|real|person|computer|machine|chatgpt|gpt|claude|program)\b|\b(bot|ai)\s*\?|you.?re\s+(a\s+)?(bot|ai)|ur\s+(a\s+)?(bot|ai)/.test(t)) {
        return judging
          ? U.pick(['im asking the questions here lol', 'no. are YOU?', 'nope. now answer mine', 'thats what id ask if i was one'])
          : U.pick(['lol no', 'no?? r u', 'nope just a person bored on my laptop', 'thats exactly what a bot would ask', 'i mean id say no either way right', 'human. unfortunately']);
      }
      const mathText = t.replace(/\btimes\b|\bmultiplied by\b/g, '*').replace(/\bplus\b/g, '+')
        .replace(/\bminus\b/g, '-').replace(/\bdivided by\b/g, '/');
      if ((m = mathText.match(/(-?\d+)\s*([+\-*x×/])\s*(-?\d+)/))) {
        const op = m[2] === 'x' || m[2] === '×' ? '*' : m[2];
        return math(Number(m[1]), op, Number(m[3]));
      }
      if (/^(hi+|hey+|hello+|yo+|sup|howdy|hola|heya|hiya)\b/.test(t)) {
        return U.pick(['hey', 'hii', 'yo', 'hey whats up', 'hello hello']) + (st.turns <= 1 && U.chance(0.4) ? '|so how does this work lol' : '');
      }
      if (/^(and\s+)?(you|u|hbu|wbu|what about (you|u)|how about (you|u)|and u)\??$/.test(t)) {
        const k = st.lastQ && me[st.lastQ] ? st.lastQ : 'upto';
        return U.pick(me[k]);
      }
      if (/how\s+(are|r)\s+(you|u)|how'?s it going|how you doing|what'?s up|whats up|wassup|\bsup\b/.test(t)) return U.pick(MOODS);
      if (/(what'?s|what is|whats|tell me)\s+(your|ur)\s+name|who are (you|u)\b/.test(t)) return U.pick(me.name);
      if (/how old|(your|ur)\s+age\b/.test(t)) return U.pick(me.age);
      if (/where.*(from|live|located|based)|what (country|city|state)|where (are|r) (you|u)\b/.test(t)) return U.pick(me.place);
      if (/hobb|for fun|free time|interests|what do (you|u) like/.test(t)) return U.pick(me.hobby);
      if (/what do (you|u) do|\bjob\b|\bwork\b|\bschool\b|\bcollege\b|\bstudy|\bmajor\b/.test(t)) return U.pick(me.job);
      if ((m = t.match(/fav(?:ou?rite)?\s+(\w+)/))) return fav(m[1]);
      if (/weather|raining|sunny|cold|hot outside/.test(t)) return U.pick(['its kinda gray here', 'freezing lol', 'nice out actually', 'raining again']);
      if (/what time|what day|\btoday\b/.test(t)) return U.pick(['idk late', 'no clue what day it is tbh', 'feels like a monday']);
      if (/joke|make me laugh|something funny/.test(t)) return U.pick(['im not funny on command lol', 'why did the scarecrow win an award. bc he was outstanding in his field. ok im sorry']);
      if (/prove|turing|captcha|only a human|something human/.test(t)) return U.pick(['what do u want me to do, bleed?', 'uhh i stubbed my toe this morning. proof', 'idk how to prove that lol how would YOU prove it']);
      if (/stupid|dumb|idiot|shut up|\bf+u+c+k|wtf|stfu/.test(t)) return U.pick(['ok rude', 'lol chill', 'damn ok']);
      if (/^(lol|lmao|haha+|hehe|lmfao|xd|ha)+[!. ]*$/.test(t)) return U.pick(['lol', 'haha', 'lmao']);
      if (/backwards/.test(t) && /necessary/.test(t)) return level <= 1 ? 'yrassecen' : U.pick(['yrasseccen? idk', 'no lol', 'y r a s s e c... too long']);

      // Reaction to an answer to our own question, then maybe ask something back.
      const reactions = {
        place: ['oh nice, never been', 'ooh is it nice there', 'cool cool'],
        age: ['oh ok', 'nice', 'oh same-ish'],
        job: ['oh thats cool', 'sounds busy', 'nice'],
        name: ['nice to meet u', 'cool name', 'hi then'],
        music: ['ooh good taste', 'never heard of that tbh', 'respect'],
        upto: ['sounds fun', 'lol relatable', 'same'],
        probe: ['hm ok', 'interesting answer', 'ok thats kinda sus', 'very human of u lol', 'noted'],
      };
      let base;
      if (reactTo && reactions[reactTo]) { base = U.pick(reactions[reactTo]); st.lastQ = null; }
      else if (t.endsWith('?')) base = U.pick(['hmm good question', 'idk honestly', 'why do u ask', 'depends tbh', 'never really thought about it', 'what do u think']);
      else if (t.length > 140) base = U.pick(['thats a lot of text lol', 'ok essay', 'tldr?']);
      else base = U.pick(['lol fair', 'true', 'oh nice', 'wait really', 'hm', 'same tbh', 'interesting', 'ok']);
      const askChance = judging ? 0.85 : 0.45;
      if (U.chance(askChance)) { const q = ask(); if (q) base += '|' + q; }
      return base;
    }

    return {
      persona: P,
      opener() { return [U.pick(['hi', 'hey', 'hello?', 'yo']), ...(judging || U.chance(0.5) ? [ask()] : [])].filter(Boolean); },
      nudge() { const q = ask(); return [q || U.pick(['u there?', 'hello?'])]; },
      reply(text) {
        return respond(text).split('|').flatMap((part) => humanize(part, level));
      },
      // How long it "takes" to type a line.
      typeMs(line) {
        const cps = level <= 1 ? 14 : U.rand(4.5, 7);
        return Math.min(9000, 500 + (line.length / cps) * 1000);
      },
    };
  }

  // The computer as judge: score a person's messages for machine-like features.
  function judgeMessages(msgs, level) {
    if (!msgs.length) return { guess: U.chance(0.5) ? 'ai' : 'human', why: 'you barely said anything' };
    const texts = msgs.map((m) => m.text);
    const all = texts.join(' ').toLowerCase();
    let ai = 0;
    const reasons = [];
    const add = (w, why) => { ai += w; if (w > 0) reasons.push([w, why]); };

    // Saying "I am an AI" convinces a naive judge. A seasoned one knows the real AIs in this game
    // pretend to be human, so from level 4 a loud claim counts slightly *against* you.
    if (/\b(as an ai|language model|i am an ai|i'?m an ai|i am a (bot|robot|machine|program)|i'?m a (bot|robot|machine|program)|beep|boop|my (programming|training|creators?)|i (do not|don'?t) have (feelings|a body|emotions)|artificial intelligence|neural net)/.test(all)) {
      add(Math.max(-0.5, 3 - 1.1 * (level - 1)), 'you said you were a machine');
    }
    // Instant, exact arithmetic is machine-like.
    if (msgs.some((m) => /^\s*-?\d{3,}\s*\.?$/.test(m.text) && m.latency !== null && m.latency < 6)) add(1, 'instant, exact mental maths');
    const formal = texts.filter((s) => /^[A-Z]/.test(s) && /[.!?]$/.test(s)).length / texts.length;
    add(formal * 2, 'perfect capitals and punctuation');
    if (!/\b(lol|lmao|idk|tbh|u|ur|ya|nah|yeah|gonna|wanna|omg|haha|bruh|rn|ngl)\b/.test(all)) add(1, 'no slang at all');
    const avg = texts.reduce((s, x) => s + x.length, 0) / texts.length;
    if (avg > 140) add(2.5, 'very long, structured answers'); else if (avg > 80) add(1.5, 'long answers');
    if (msgs.some((m) => m.text.length >= 60 && m.latency !== null && m.latency < m.text.length / 12)) add(2, 'typing faster than a person can');
    if (/certainly|i('d| would) be (happy|glad) to|great question|feel free|let me know if|in summary|additionally|furthermore|however,/.test(all)) add(1.5, 'assistant-style phrases');
    if (/[;:]\s/.test(all)) add(0.5, 'semicolons and colons');
    // Casual slips (lowercase starts) give you away more as the judge gets sharper.
    const slips = texts.filter((s) => /^[a-z]/.test(s)).length;
    if (slips) add(-Math.min(3, slips * (level >= 3 ? 0.75 : 0.5) + 0.5), '');
    if (/[\u{1F300}-\u{1FAFF}]/u.test(all)) add(-0.5, '');
    if (texts.length <= 1) add(-0.5, '');

    const noise = U.rand(-1, 1) * Math.max(0.5, 2.5 - 0.5 * (level - 1));
    // Higher levels need more machine-like evidence at once (formal + long + exact + no slips...).
    const threshold = Math.min(6.2, [0, 1.5, 2.2, 2.9, 3.6][Math.min(level, 4)] + Math.max(0, level - 4) * 0.7);
    const guess = ai + noise > threshold ? 'ai' : 'human';
    reasons.sort((a, b) => b[0] - a[0]);
    const why = guess === 'ai'
      ? (reasons[0] ? reasons[0][1] : 'just a feeling')
      : (reasons[0] ? `not convinced, despite ${reasons[0][1]}` : 'you sounded like a regular person');
    return { guess, why };
  }

  // ================================================================ the game
  Cabinet.register({
    id: 'imitation',
    title: 'Imitation',
    color: '#c86bff',
    dom: true,
    tagline: 'Chat with a stranger. Human or machine?',
    flip: 'play the AI, or face a real human in another browser.',
    modes: [
      { id: 'classic', you: 'Judge', cpu: 'Imitator (or a real person)',
        how: 'You are matched with a stranger: maybe someone in another browser, maybe the computer pretending to be a person. You take turns, one message each, 20 seconds per message, 4 messages each. Then decide: human or AI? Guess right to level up; the computer gets more convincing. 3 hearts.' },
      { id: 'flipped', you: 'Imitator: play the AI', cpu: 'Judge (or a real person)',
        how: 'Same match, opposite goal: make your partner believe YOU are the AI. At the end they give their verdict on you. The computer judge gets harder to fool each level. No pasting. 3 hearts.' },
    ],

    create(api) {
      const mode = api.mode;
      const root = api.dom;
      const later = (ms, fn) => { const id = setTimeout(fn, ms); timers.push(id); return id; };
      const timers = [];
      const state = { level: 1, hearts: 3, won: 0, played: 0 };
      let mm = null, session = null, searchTick = null;

      root.innerHTML = `
        <div class="imit">
          <div class="imit-pane" data-pane="lobby">
            <h2>IMITATION</h2>
            <p class="goal"></p>
            <p class="imit-stats"></p>
            <button class="btn" data-act="find">Find a match</button>
            <p class="imit-small">You'll be paired with whoever else is searching right now, in any browser.
              If nobody is around, the computer steps in. Nothing tells you which.</p>
          </div>
          <div class="imit-pane" data-pane="search" hidden>
            <div class="spinner"></div>
            <h2>SEARCHING</h2>
            <p class="search-status">Connecting to the lobby…</p>
            <p class="search-time imit-small"></p>
            <button class="btn alt" data-act="cancel">Cancel</button>
          </div>
          <div class="imit-chat" data-pane="chat" hidden>
            <div class="imit-head"><span class="dot"></span><span>Stranger</span><span class="timer"></span></div>
            <div class="imit-log" aria-live="polite"></div>
            <div class="imit-typing"></div>
            <form class="imit-form">
              <input maxlength="200" placeholder="Say something…" autocomplete="off" aria-label="Message">
              <button class="btn" type="submit">Send</button>
            </form>
            <div class="imit-pane" data-pane="vote" hidden style="flex:0">
              <p class="vote-q"></p>
              <div class="verdict-row">
                <button class="big-choice human" data-v="human">HUMAN</button>
                <button class="big-choice ai" data-v="ai">AI</button>
              </div>
              <p class="vote-wait imit-small"></p>
            </div>
          </div>
          <div class="imit-pane" data-pane="reveal" hidden>
            <h2 class="reveal-title"></h2>
            <div class="imit-reveal-box"></div>
            <button class="btn" data-act="next">Next match</button>
          </div>
        </div>`;

      const $ = (s) => root.querySelector(s);
      const panes = ['lobby', 'search', 'chat', 'reveal'];
      function showPane(name) { for (const p of panes) $(`[data-pane="${p}"]`).hidden = p !== name; }
      const log = $('.imit-log'), input = $('.imit-form input'), typingEl = $('.imit-typing');

      function paintLobby() {
        $('.goal').textContent = mode === 'classic'
          ? 'Your goal: work out whether your partner is a human or an AI.'
          : 'Your goal: convince your partner that you are the AI.';
        $('.imit-stats').textContent = `Level ${state.level}  ·  ${'♥'.repeat(state.hearts)}${'♡'.repeat(3 - state.hearts)}  ·  Won ${state.won}`;
        showPane('lobby');
      }

      // ------------------------------------------------------------ searching
      function startSearch() {
        showPane('search');
        const t0 = performance.now();
        const deadline = U.rand(7, 15) * 1000;          // when we give up on finding a person
        const minWait = U.rand(4, 8) * 1000;            // never "connect instantly"
        const statuses = ['Connecting to the lobby…', 'Looking for another player…', 'Looking for another player…', 'Still looking…'];
        let human = null, role = null, settled = false;
        searchTick = setInterval(() => {
          const el = performance.now() - t0;
          $('.search-time').textContent = `${Math.floor(el / 1000)}s`;
          $('.search-status').textContent = statuses[Math.min(statuses.length - 1, Math.floor(el / 3000))];
          if (settled) return;
          if (human && el >= minWait) { settled = true; found('human', human, role); }
          else if (!human && el >= deadline) { settled = true; found('bot'); }
        }, 200);
        mm = Matchmaker();
        mm.search((conn, r) => {
          if (settled) { conn.close(); return; }
          human = conn;
          role = r;
          // Hold on to anything the partner sends before our chat screen opens.
          conn.queue = [];
          conn.on('data', (d) => (conn.handler ? conn.handler(d) : conn.queue.push(d)));
          // If they drop out before the chat opens, keep searching (and fall back to the computer).
          conn.on('close', () => { if (human === conn && !settled) human = null; });
        });
      }
      function cancelSearch() {
        clearInterval(searchTick);
        if (mm) mm.destroy();
        mm = null;
        paintLobby();
      }
      function found(kind, conn, role) {
        clearInterval(searchTick);
        if (mm) { if (kind === 'human') mm.stop(); else mm.destroy(); }
        $('.search-status').textContent = 'Partner found! Opening chat…';
        later(U.rand(700, 1500), () => beginChat(kind, conn, role));
      }

      // ------------------------------------------------------------ chatting
      function addMsg(who, text) {
        const d = document.createElement('div');
        d.className = `msg ${who}`;
        d.textContent = text;
        log.appendChild(d);
        log.scrollTop = log.scrollHeight;
      }
      function setTyping(on) { typingEl.textContent = on ? 'Stranger is typing…' : ''; }

      function beginChat(kind, conn, role) {
        if (kind === 'human' && !conn.open) { kind = 'bot'; conn = null; }
        log.innerHTML = '';
        setTyping(false);
        $('[data-pane="vote"]').hidden = true;
        $('.imit-form').hidden = false;
        input.value = '';
        showPane('chat');
        session = {
          kind, conn, role, ended: false, mine: null, theirs: null, theirWhy: null,
          turn: null, turnLeft: 0, turnStart: 0, sent: 0, got: 0, lastMine: '',
          myMsgs: [], typingT: 0, lastTypingSent: 0,
          bot: kind === 'bot' ? makeBot(state.level, mode === 'flipped') : null,
        };
        setTurn(null);
        addMsg('sys', `Take turns: ${TURNS_EACH} messages each, ${TURN_SECONDS} seconds per message.`);
        if (kind === 'bot') {
          later(U.rand(500, 1500), () => startTurns(U.chance(0.5)));
        } else {
          // The host decides who goes first once the guest's chat screen is open.
          wireConn(conn);
          if (role === 'guest') send0({ type: 'ready' });
        }
      }
      const send0 = (msg) => { try { session.conn.send(msg); } catch (_) { /* */ } };

      function startTurns(meFirst) {
        if (!session || session.ended) return;
        addMsg('sys', meFirst ? 'You go first. Say hi!' : 'Your partner goes first.');
        setTurn(meFirst ? 'me' : 'them');
      }

      // Whose turn it is drives the input box, the timer and (for the computer) its reply.
      function setTurn(who) {
        const s = session;
        s.turn = who;
        s.turnLeft = TURN_SECONDS;
        s.turnStart = performance.now();
        input.disabled = who !== 'me';
        input.placeholder = who === 'me' ? 'Your turn…' : who === 'them' ? 'Waiting for Stranger…' : 'Connecting…';
        $('.imit-form button').disabled = who !== 'me';
        if (who === 'me') input.focus();
        if (who === 'them' && s.kind === 'bot') botTurn();
        paintTimer();
      }
      function paintTimer() {
        const s = session;
        const n = s.sent + s.got + 1;
        const label = s.turn === 'me' ? 'YOUR TURN' : 'THEIR TURN';
        $('.timer').textContent = s.turn
          ? `${label} ${Math.max(0, Math.ceil(s.turnLeft))}s · ${Math.min(n, TURNS_EACH * 2)}/${TURNS_EACH * 2}`
          : '';
      }
      // After each message, hand the turn over, or finish once both have sent TURNS_EACH.
      function nextTurn(justWent) {
        const s = session;
        if (s.sent >= TURNS_EACH && s.got >= TURNS_EACH) return chatOver();
        setTurn(justWent === 'me' ? 'them' : 'me');
      }

      function wireConn(conn) {
        const s = session;
        conn.handler = (d) => {
          if (s !== session || !d) return;
          if (d.type === 'ready' && s.role === 'host' && !s.turn) {
            const hostFirst = U.chance(0.5);
            send0({ type: 'start', hostFirst });
            startTurns(hostFirst);
          } else if (d.type === 'start' && s.role === 'guest' && !s.turn) {
            startTurns(!d.hostFirst);
          } else if (d.type === 'msg' && !s.ended && s.turn === 'them') {
            receive(String(d.text || '').slice(0, 300));
          } else if (d.type === 'typing' && !s.ended) {
            setTyping(true);
            s.typingT = 2.5;
          } else if (d.type === 'verdict') {
            s.theirs = d.guess === 'ai' ? 'ai' : 'human';
            maybeReveal();
          }
        };
        conn.queue.splice(0).forEach(conn.handler);
        conn.on('close', () => {
          if (s !== session || s.revealed) return;
          addMsg('sys', 'Stranger disconnected. This match doesn’t count.');
          s.ended = true;
          s.void = true;
          later(2500, () => { if (s === session) { endConn(); paintLobby(); } });
        });
      }
      function endConn() {
        if (session && session.conn) { try { session.conn.send({ type: 'bye' }); session.conn.close(); } catch (_) { /* */ } }
        if (mm) { mm.destroy(); mm = null; }
      }

      function receive(text) {
        const s = session;
        setTyping(false);
        if (text) addMsg('them', text); else addMsg('sys', 'Stranger ran out of time.');
        s.got++;
        nextTurn('them');
      }

      // The computer's turn: "read", then "type" at a human pace, always inside the time limit.
      function botTurn() {
        const s = session;
        const bot = s.bot;
        let lines;
        if (s.sent === 0 && s.got === 0) lines = bot.opener();
        else if (!s.lastMine) lines = bot.nudge(); // you let your turn run out
        else lines = bot.reply(s.lastMine);
        const text = lines.join(' ');
        const readMs = state.level <= 1 ? U.rand(400, 1200) : U.rand(1500, 4000);
        const limitMs = (TURN_SECONDS - U.rand(1.5, 3.5)) * 1000;
        const typeMs = Math.min(bot.typeMs(text), limitMs - readMs);
        // Real people sometimes let the clock run out; from level 2 the computer occasionally does too.
        const skip = state.level >= 2 && U.chance(0.04);
        later(readMs, () => {
          if (s !== session || s.ended || s.turn !== 'them') return;
          if (skip) {
            later(TURN_SECONDS * 1000 - readMs, () => { if (s === session && s.turn === 'them') receive(''); });
            return;
          }
          setTyping(true);
          later(Math.max(300, typeMs), () => { if (s === session && !s.ended && s.turn === 'them') receive(text); });
        });
      }

      function send(text) {
        const s = session;
        if (!s || s.ended || s.turn !== 'me') return;
        text = text.trim().slice(0, 200);
        if (text) addMsg('me', text); else addMsg('sys', 'You ran out of time.');
        if (text) s.myMsgs.push({ text, latency: (performance.now() - s.turnStart) / 1000 });
        s.lastMine = text;
        s.sent++;
        input.value = '';
        if (s.kind === 'human') send0({ type: 'msg', text });
        nextTurn('me');
      }

      $('.imit-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (input.value.trim()) send(input.value);
      });
      // House rule: no pasting. Everything you send, you typed (no help from a real AI).
      input.addEventListener('paste', (e) => e.preventDefault());
      input.addEventListener('input', () => {
        const s = session;
        if (!s || s.kind !== 'human' || s.ended) return;
        const now = performance.now();
        if (now - s.lastTypingSent > 1500) { s.lastTypingSent = now; send0({ type: 'typing' }); }
      });

      // ------------------------------------------------------------ verdicts
      function chatOver() {
        const s = session;
        s.ended = true;
        s.turn = null;
        $('.timer').textContent = '';
        setTyping(false);
        input.disabled = true;
        $('.imit-form').hidden = true;
        addMsg('sys', 'That\u2019s all the messages.');
        $('.vote-q').textContent = mode === 'classic'
          ? 'Was your partner a human or an AI?'
          : 'For the record: was your partner a human or an AI? (Your score depends on what THEY think of you.)';
        $('.vote-wait').textContent = '';
        root.querySelectorAll('[data-v]').forEach((b) => { b.disabled = false; });
        $('[data-pane="vote"]').hidden = false;
        s.voteLeft = VERDICT_WAIT;
        if (s.kind === 'bot') {
          // The computer partner forms its own verdict on you, after a believable pause.
          later(U.rand(1500, 6000), () => {
            if (s !== session) return;
            const j = judgeMessages(s.myMsgs, mode === 'flipped' ? state.level : 2);
            s.theirs = j.guess;
            s.theirWhy = j.why;
            maybeReveal();
          });
        }
      }
      function vote(v) {
        const s = session;
        if (!s || s.mine) return;
        s.mine = v;
        root.querySelectorAll('[data-v]').forEach((b) => { b.disabled = true; });
        $('.vote-wait').textContent = 'Waiting for your partner’s verdict…';
        if (s.kind === 'human') { try { s.conn.send({ type: 'verdict', guess: v }); } catch (_) { /* */ } }
        maybeReveal();
      }
      function maybeReveal() {
        const s = session;
        if (!s || s.revealed || !s.mine || (!s.theirs && s.voteLeft > 0)) return;
        s.revealed = true;
        const truth = s.kind === 'human' ? 'human' : 'ai';
        const correct = s.mine === truth;
        const fooled = s.theirs === 'ai';
        const win = mode === 'classic' ? correct : fooled;

        state.played++;
        if (win) { state.won++; state.level++; api.sfx.good(); } else { state.hearts--; api.sfx.bad(); }

        $('.reveal-title').textContent = win ? 'YOU WIN THIS ONE' : 'NOT THIS TIME';
        const box = $('.imit-reveal-box');
        box.innerHTML = '';
        const line = (text, cls) => { const p = document.createElement('p'); p.textContent = text; if (cls) p.className = cls; box.appendChild(p); };
        line(truth === 'human' ? 'Your partner was a REAL PERSON in another browser.' : `Your partner was THE COMPUTER (playing "${s.bot.persona.name}", ${s.bot.persona.age}, from ${s.bot.persona.place}).`);
        line(`You guessed: ${s.mine.toUpperCase()}. ${correct ? 'Correct.' : 'Wrong.'}`, mode === 'classic' ? (correct ? 'good' : 'bad') : '');
        line(s.theirs ? `They thought you were: ${s.theirs === 'ai' ? 'an AI' : 'a human'}.` : 'They never gave a verdict.', mode === 'flipped' ? (fooled ? 'good' : 'bad') : '');
        if (s.theirWhy) line(`Their reasoning: ${s.theirWhy}.`);
        line(`Level ${state.level}  ·  ${'♥'.repeat(Math.max(0, state.hearts))}  ·  Won ${state.won}`);
        endConn();
        const nextBtn = $('[data-act="next"]');
        nextBtn.textContent = state.hearts > 0 ? 'Next match' : 'See results';
        showPane('reveal');
      }

      // ------------------------------------------------------------ buttons
      root.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        const v = e.target.closest('[data-v]');
        if (v) return vote(v.dataset.v);
        if (!act) return;
        if (act.dataset.act === 'find') startSearch();
        if (act.dataset.act === 'cancel') cancelSearch();
        if (act.dataset.act === 'next') {
          session = null;
          if (state.hearts <= 0) {
            api.end({ title: 'GAME OVER', score: state.won, lines: [`Matches won: ${state.won} of ${state.played}`] });
          } else startSearch();
        }
      });

      paintLobby();

      return {
        update(dt) {
          const s = session;
          if (!s) return;
          if (s.typingT > 0) { s.typingT -= dt; if (s.typingT <= 0) setTyping(false); }
          if (!s.ended && s.turn) {
            s.turnLeft -= dt;
            paintTimer();
            // Out of time: whatever you've typed is sent; an empty box means you skipped.
            if (s.turn === 'me' && s.turnLeft <= 0) send(input.value);
            // A real partner whose message never arrives (lag, closed tab) loses the turn after a grace period.
            else if (s.turn === 'them' && s.kind === 'human' && s.turnLeft <= -6) receive('');
          } else if (s.ended && s.voteLeft > 0 && !s.revealed && !s.void) {
            s.voteLeft -= dt;
            if (s.voteLeft <= 0) {
              if (!s.mine) vote(U.chance(0.5) ? 'human' : 'ai');
              maybeReveal();
            }
          }
        },
        destroy() {
          timers.forEach(clearTimeout);
          clearInterval(searchTick);
          endConn();
          if (mm) mm.destroy();
        },
      };
    },
  });
})();
