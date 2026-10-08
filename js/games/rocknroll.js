/*
 * ROCKNROLLER — an original rhythm runner: a tour of the Nevada desert, one generated song per stop.
 *
 * Core rule: if it's on screen it's on the beat, and every note in the song is an element.
 *
 *  - SONG. Each stop plays a brand-new song generated in the browser (an algorithm, not an AI
 *    model). Every song picks a STYLE (never the same as the last one): spaghetti gallop, surf,
 *    swung desert boogie, neon motorik, ghost-town doom or train-beat country. Each style has its
 *    own scale, chord progressions, drum groove, bass line, chord instruments and lead voice. On
 *    top of that the key, the song structure, the melody rhythms and the lead instruments
 *    (guitar, surf guitar, trumpet, pedal steel, harmonica, electric piano, synth, chiptune, fuzz,
 *    banjo, fiddle, marimba, organ, whistle, theremin) are random. Songs last about a minute:
 *    faster songs get more sections, longer ones a pre-chorus and a solo.
 *  - SOUND. Karplus-Strong plucked strings, 808-style metallic cymbals, detuned synths, a
 *    generated reverb room, echo, stereo placement and a compressor. Above 180 BPM melodies are
 *    written in half time, and above ~200 BPM the band plays an 8th-note grid, so fast songs
 *    stay musical instead of turning into a blur.
 *  - SPEED. Every stop is 16 BPM faster (100, 116, 132 ... up to 240). Everything that has to be
 *    humanly possible (reaction time, lane changes, jumps) is measured in seconds, not beats, so
 *    the game stays fair as it gets fast.
 *  - ONE SOURCE OF TRUTH. stepEvents(n) says what the band plays on every 16th note; the audio
 *    plays it, the visuals react to it, and the road is charted from it.
 *  - ROUTE. A planner lays a route through the 4 lanes that follows the melody's pitch and keeps
 *    moving. It isn't drawn: the note pickups sit on it and the cacti that push you show the way.
 *    Nothing that can hurt you is ever placed on the route.
 *  - EVERY NOTE IS AN ELEMENT: a pickup on the route, a cactus pushing you along, or one beside it.
 *  - PRESSURE RISES EVERY STOP: each stop has an obstacle rate (1.3/s at stop 1, +0.3/s a stop, up
 *    to 4.5/s) and the route must move more often. Where the melody is too sparse (half-time at
 *    high tempo), the rhythm section supplies the rest: hay bales land on chord hits, then bass
 *    notes, then kick/snare hits.
 *  - EVERY INSTRUMENT HAS A JOB: crash = car wreck, tom fill = boulders, shaker = tumbleweeds,
 *    sub-drop + bridge snare = the bridge's planks cracking (jump), siren = police from behind,
 *    kick = road thump, snare = rumble strips, hats = heat sparkles, bass = suspension, chords =
 *    props sway, melody = cacti sway and pickups pulse.
 *  - THE BRIDGE section is a real bridge over a canyon river.
 *  - JUMPS land exactly on a beat. Jump hazards are always far enough apart to be cleared.
 *  - BOSSES: every 5th stop is Area 51. A flying saucer hovers in front of you, moving on the
 *    beat; its plasma orbs are the melody notes, its tractor beams land on the crash. Following
 *    the route lines you up under it, and on the kick drum the RV fires automatically.
 *  - REWARDS: Groove meter -> ENCORE (guitar solo, x2), spare tire = shield, nitro = untouchable
 *    chorus with double points. Every sound effect is in the song's key.
 */
(function () {
  'use strict';
  const { U, Draw } = Cabinet;

  const W = 800, H = 600, LW = 200, LH = 150, PX = W / LW;   // pixel buffer, scaled up 4x
  const LANES = [58, 86, 114, 142], NL = LANES.length;        // lane centres (the lanes are never drawn)
  const ROAD_L = 42, ROAD_R = 158, ROAD_MID = 100;
  const RV_Y = 128;
  const INTRO_BARS = 2, SEC = 4, OUTRO_BARS = 2;
  const LATE = 0.08;                                  // grace after a hazard's moment (s)
  const HOLD_DELAY = 0.16, HOLD_REPEAT = 0.085;       // held-key auto-repeat
  const GROOVE_FULL = 12, ENCORE_BARS = 2;
  const BOSS_EVERY = 5;
  // Human limits, in seconds (so they hold at any tempo)
  const MIN_MOVE_GAP = 0.36;  // the route never asks for two lane changes closer than this
  const SLIDE_WINDOW = 0.3;   // time you get to slide into the next lane
  const MARGIN = 0.1;         // clear space around the route
  // Obstacles per second rise with every stop (and cap), whatever the melody is doing.
  const hazardRate = (k) => Math.min(4.5, 1.3 + 0.3 * (k - 1));
  // ...and the route has to move at least this often (seconds), tighter every stop.
  const maxStillFor = (k) => Math.max(0.8, 2.6 - 0.2 * (k - 1));
  const LANE_HAZARDS = new Set(['cactus', 'boulder', 'wreck', 'police', 'orb', 'beam', 'hay', 'crack', 'land']); // everything you dodge or jump
  const JUMP_LEAD = 0.33;     // a jump must start at least this long before the beat it clears

  const TOWNS = ['Las Vegas', 'Pahrump', 'Beatty', 'Tonopah', 'Area 51', 'Goldfield', 'Ely', 'Eureka', 'Austin', 'Area 51', 'Winnemucca', 'Elko', 'Reno', 'Jackpot', 'Area 51'];
  const songBpm = (k) => Math.min(240, 100 + 16 * (k - 1));   // +16 BPM a stop, up to 240

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ================================================================ the musical vocabulary
  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11], majPent: [0, 2, 4, 7, 9], blues: [0, 3, 5, 6, 7, 10],
  };
  // [semitones above the tonic, quality]: m = minor, M = major, 7 = dominant seventh
  const CHORDS = {
    i: [0, 'm'], ii: [2, 'm'], iii: [4, 'm'], iv: [5, 'm'], v: [7, 'm'], vi: [9, 'm'],
    I: [0, 'M'], IV: [5, 'M'], V: [7, 'M'], III: [3, 'M'], VI: [8, 'M'], VII: [10, 'M'], bII: [1, 'M'],
    I7: [0, '7'], IV7: [5, '7'], V7: [7, '7'],
  };
  // Bass/comp intervals above the chord root ('3' = the chord's third)
  const IV_ = { r: 0, 3: 'third', 5: 7, 6: 9, b7: 10, 8: 12, '-5': -5 };
  // Two-bar melody rhythms [16th-step 0..31, length]. "even" = only 8th notes (safe for swing).
  const RHYTHMS = {
    even: [
      [[0, 4], [4, 2], [6, 2], [8, 4], [12, 4], [16, 6], [24, 2], [26, 2], [28, 4]],
      [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4], [16, 2], [18, 2], [20, 4], [24, 8]],
      [[0, 6], [6, 2], [8, 4], [12, 4], [16, 4], [20, 4], [24, 4], [28, 4]],
      [[2, 2], [4, 2], [6, 2], [8, 8], [18, 2], [20, 2], [22, 2], [24, 8]],
      [[0, 2], [4, 2], [6, 2], [8, 2], [12, 4], [16, 2], [20, 2], [22, 2], [24, 4], [28, 4]],
      [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4], [16, 2], [18, 2], [20, 2], [22, 2], [24, 8]],
      [[0, 2], [2, 2], [4, 4], [16, 2], [18, 2], [20, 4], [24, 2], [26, 2], [28, 4]],
    ],
    sparse: [
      [[0, 8], [8, 4], [12, 4], [16, 12], [28, 4]],
      [[0, 4], [4, 4], [8, 8], [16, 6], [22, 2], [24, 8]],
      [[0, 12], [12, 4], [16, 8], [24, 8]],
    ],
    synco: [
      [[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2], [16, 3], [19, 3], [22, 2], [24, 8]],
      [[0, 3], [3, 3], [6, 4], [10, 2], [12, 4], [16, 3], [19, 3], [22, 4], [26, 2], [28, 4]],
      [[0, 2], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2], [16, 4], [20, 2], [23, 3], [26, 6]],
    ],
  };
  const GALLOP = [[0, 'r'], [2, '8'], [3, '8'], [4, 'r'], [6, '8'], [7, '8'], [8, 'r'], [10, '5'], [11, '5'], [12, 'r'], [14, '8'], [15, '8']];
  // The styles. drums: kick/snare steps; hat: 8 | 16 | 'off' | 'ride' | 'brush'.
  // leads: per section, a list of options; each song picks one. 'a+b' = a, doubled by b an octave up.
  const STYLES = [
    {
      name: 'Spaghetti Gallop', scale: 'minor', harmV: true, keys: [9, 4, 2, 11, 6], bassVoice: 'pick',
      progs: {
        verse: [['i', 'VII', 'VI', 'V'], ['i', 'VI', 'III', 'VII'], ['i', 'iv', 'VII', 'III'], ['i', 'bII', 'i', 'V']],
        chorus: [['VI', 'VII', 'i', 'i'], ['i', 'VII', 'VI', 'V'], ['iv', 'V', 'i', 'i'], ['VI', 'III', 'VII', 'V']],
        bridge: [['VI', 'VI', 'VII', 'VII'], ['bII', 'bII', 'i', 'i'], ['iv', 'iv', 'V', 'V']],
      },
      drums: { verse: { kick: [0, 8], snare: [4, 12], hat: 8 }, chorus: { kick: [0, 3, 8, 10], snare: [4, 12], hat: 16 } },
      bass: { verse: [[0, 'r', 3], [6, 'r', 2], [8, '5', 3], [14, '8', 2]], chorus: GALLOP.map(([s, i]) => [s, i, 1.6]) },
      comp: { verse: [['strum', [2, 6, 10, 14], 1.4]], chorus: [['power', [0, 3, 6, 8, 11, 14], 2.2], ['organ', [0], 15]] },
      leads: { verse: ['guitar', 'steel'], chorus: ['trumpet+guitar', 'guitar+trumpet', 'trumpet'], solo: ['fuzz', 'trumpet', 'guitar'], bridge: ['whistle', 'steel'] },
      rhythms: ['even', 'synco'], swing: 0,
    },
    {
      name: 'Surf Rocket', scale: 'dorian', keys: [4, 9, 2, 7], bassVoice: 'pick',
      progs: {
        verse: [['i', 'VII', 'VI', 'VII'], ['i', 'iv', 'i', 'VII'], ['i', 'i', 'iv', 'VII']],
        chorus: [['VI', 'VII', 'i', 'i'], ['iv', 'VII', 'III', 'VI'], ['i', 'VII', 'VI', 'VII']],
        bridge: [['iv', 'iv', 'VII', 'VII'], ['VI', 'VI', 'VII', 'VII']],
      },
      drums: { verse: { kick: [0, 6, 8], snare: [4, 12], hat: 16 }, chorus: { kick: [0, 6, 8, 14], snare: [4, 12, 14], hat: 16 } },
      bass: { verse: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, ['r', 'r', '5', 'r', '8', 'r', '5', 'r'][i], 1.8]), chorus: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, ['r', '8', 'r', '5', 'r', '8', '5', '3'][i], 1.8]) },
      comp: { verse: [['trem', [0, 8], 7]], chorus: [['trem', [0, 4, 8, 12], 3.5], ['power', [0, 8], 6]] },
      leads: { verse: ['surf', 'surf+farfisa'], chorus: ['surf+farfisa', 'surf', 'farfisa+surf'], solo: ['surf', 'fuzz'], bridge: ['steel', 'farfisa'] },
      rhythms: ['even', 'sparse'], swing: 0,
    },
    {
      name: 'Desert Boogie', scale: 'blues', keys: [4, 9, 7, 2, 0], bassVoice: 'upright',
      progs: {
        verse: [['I7', 'I7', 'IV7', 'I7'], ['I7', 'IV7', 'I7', 'V7']],
        chorus: [['IV7', 'IV7', 'I7', 'I7'], ['V7', 'IV7', 'I7', 'V7'], ['IV7', 'V7', 'I7', 'I7']],
        bridge: [['IV7', 'IV7', 'I7', 'I7'], ['V7', 'V7', 'IV7', 'IV7']],
      },
      drums: { verse: { kick: [0, 8], snare: [4, 12], hat: 8 }, chorus: { kick: [0, 6, 8], snare: [4, 12], hat: 8 } },
      bass: { verse: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, ['r', '3', '5', '6', 'b7', '6', '5', '3'][i], 1.8]), chorus: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, ['r', '3', '5', '6', 'b7', '6', '5', '3'][i], 1.8]) },
      comp: { verse: [['stab', [2, 6, 10, 14], 1.2]], chorus: [['stab', [2, 6, 10, 14], 1.2], ['organ', [0], 15]] },
      leads: { verse: ['harp', 'rhodes'], chorus: ['harp+rhodes', 'rhodes+harp', 'harp'], solo: ['harp', 'guitar', 'rhodes'], bridge: ['whistle', 'rhodes'] },
      rhythms: ['even'], swing: 1 / 6,
    },
    {
      name: 'Neon Motorik', scale: 'minor', keys: [9, 2, 7, 0, 5], bassVoice: 'synth',
      progs: {
        verse: [['i', 'i', 'VI', 'VI'], ['i', 'VII', 'VI', 'VII'], ['i', 'v', 'VI', 'iv']],
        chorus: [['VI', 'VII', 'i', 'i'], ['iv', 'VI', 'VII', 'i'], ['III', 'VII', 'VI', 'VII']],
        bridge: [['iv', 'iv', 'VI', 'VI'], ['VI', 'VI', 'VII', 'VII']],
      },
      drums: { verse: { kick: [0, 4, 8, 12], snare: [4, 12], hat: 'off' }, chorus: { kick: [0, 4, 8, 12], snare: [4, 12], hat: 16 } },
      bass: { verse: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, i % 2 ? '8' : 'r', 1.5]), chorus: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, ['r', '8', '5', '8', 'r', '8', 'b7', '8'][i], 1.5]) },
      comp: { verse: [['pad', [0], 16], ['pluck', [2, 6, 10, 14], 1]], chorus: [['pad', [0], 16], ['pluck', [0, 2, 4, 6, 8, 10, 12, 14], 1]] },
      leads: { verse: ['synth', 'marimba', 'rhodes'], chorus: ['synth+marimba', 'chip+synth', 'synth'], solo: ['chip', 'synth'], bridge: ['rhodes', 'marimba'] },
      rhythms: ['even', 'synco'], swing: 0,
    },
    {
      name: 'Ghost Town Doom', scale: 'phrygian', keys: [4, 2, 9, 7], bassVoice: 'fuzz',
      progs: {
        verse: [['i', 'i', 'bII', 'i'], ['i', 'VII', 'bII', 'i'], ['i', 'iv', 'bII', 'bII']],
        chorus: [['bII', 'i', 'VII', 'i'], ['VI', 'bII', 'i', 'i'], ['iv', 'bII', 'VII', 'i']],
        bridge: [['bII', 'bII', 'i', 'i'], ['iv', 'iv', 'bII', 'bII']],
      },
      drums: { verse: { kick: [0, 3, 10], snare: [8], hat: 'ride' }, chorus: { kick: [0, 3, 6, 10], snare: [8], hat: 8 } },
      bass: { verse: [[0, 'r', 6], [6, 'r', 2], [8, 'r', 6], [14, '-5', 2]], chorus: [[0, 'r', 3], [3, 'r', 3], [6, 'r', 2], [8, '8', 3], [11, 'r', 3], [14, 'b7', 2]] },
      comp: { verse: [['power', [0, 8], 7]], chorus: [['power', [0, 3, 6, 8, 11, 14], 2.5], ['organ', [0], 15]] },
      leads: { verse: ['fuzz', 'fiddle'], chorus: ['fuzz+fiddle', 'fiddle+fuzz'], solo: ['fuzz'], bridge: ['whistle', 'fiddle'] },
      rhythms: ['sparse', 'even'], swing: 0,
    },
    {
      name: 'Train Beat', scale: 'major', melScale: 'majPent', keys: [7, 2, 9, 4, 0], bassVoice: 'upright',
      progs: {
        verse: [['I', 'IV', 'I', 'V'], ['I', 'I', 'IV', 'V'], ['I', 'vi', 'IV', 'V']],
        chorus: [['IV', 'I', 'V', 'I'], ['IV', 'V', 'I', 'I'], ['vi', 'IV', 'I', 'V']],
        bridge: [['IV', 'IV', 'V', 'V'], ['vi', 'vi', 'IV', 'V']],
      },
      drums: { verse: { kick: [0, 8], snare: [4, 12], hat: 'brush' }, chorus: { kick: [0, 8, 10], snare: [4, 12], hat: 'brush' } },
      bass: { verse: [[0, 'r', 3], [8, '5', 3]], chorus: [[0, 'r', 3], [4, '5', 3], [8, 'r', 3], [12, '5', 3]] },
      comp: { verse: [['strum', [4, 12], 2]], chorus: [['strum', [2, 4, 6, 10, 12, 14], 1.4]] },
      leads: { verse: ['banjo', 'steel'], chorus: ['fiddle+banjo', 'fiddle', 'steel+fiddle'], solo: ['banjo', 'fiddle', 'steel'], bridge: ['steel', 'whistle'] },
      rhythms: ['even', 'synco'], swing: 0,
    },
  ];
  const BOSS_STYLE = {
    name: 'Area 51', scale: 'phrygian', keys: [4, 9, 2], boss: true, bassVoice: 'synth',
    progs: { attack: [['i', 'bII', 'i', 'bII'], ['i', 'i', 'bII', 'VII'], ['i', 'VII', 'VI', 'bII']] },
    drums: { attack: { kick: [0, 4, 8, 12], snare: [4, 12], hat: 16 } },
    bass: { attack: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, ['r', '8', '5', '8', 'r', '8', 'b7', '8'][i], 1.5]) },
    comp: { attack: [['pad', [0], 16], ['stab', [6, 14], 1]] },
    leads: { attack: ['theremin+synth', 'theremin'] }, rhythms: ['even', 'synco'], swing: 0,
  };
  const STRUCTURES = [
    ['verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus'],
    ['chorus', 'verse', 'chorus', 'bridge', 'verse', 'chorus'],
    ['verse', 'verse', 'chorus', 'bridge', 'chorus', 'chorus'],
    ['verse', 'chorus', 'bridge', 'verse', 'chorus', 'chorus'],
  ];
  const SOLO_NAMES = { guitar: 'GUITAR', surf: 'GUITAR', fuzz: 'GUITAR', trumpet: 'TRUMPET', banjo: 'BANJO', fiddle: 'FIDDLE', harp: 'HARMONICA', steel: 'STEEL GUITAR', synth: 'SYNTH', chip: 'CHIPTUNE', rhodes: 'KEYS', marimba: 'MARIMBA', farfisa: 'ORGAN' };
  const TITLE_A = ['Coyote', 'Rattlesnake', 'Mesa', 'Sundown', 'Mirage', 'Dust Devil', 'Tumbleweed', 'Route 95', 'Saguaro', 'Jackrabbit', 'Silver Dollar', 'Ghost Town', 'Neon Motel', 'Turquoise', 'Lonesome'];
  const TITLE_B = ['Gallop', 'Boogie', 'Stomp', 'Shuffle', 'Rodeo', 'Blues', 'Run', 'Twister', 'Rumble', 'Getaway', 'Drive', 'Express', 'Waltz', 'Showdown'];
  const BOSS_TITLES = ['Close Encounter', 'They Came From Rachel', 'Saucer Showdown', 'Little Green Rodeo', 'Abduction Boogie'];

  function makeSong(k, prevStyle) {
    const seed = Math.floor(Math.random() * 1e9);
    const R = seeded(seed);
    const pick = (a) => a[Math.floor(R() * a.length)];
    const boss = k % BOSS_EVERY === 0;
    let style = BOSS_STYLE;
    if (!boss) { do { style = pick(STYLES); } while (style.name === prevStyle && STYLES.length > 1); }
    const pc = pick(style.keys);
    const bpm = songBpm(k);
    let plan;
    if (boss) plan = Array(24).fill('attack');
    else {
      // About a minute: faster songs get more sections (verse/chorus pairs, a second bridge,
      // then a solo before the last chorus and a pre-chorus building into a chorus).
      const n = U.clamp(Math.round((60 * bpm / 240 - INTRO_BARS - OUTRO_BARS) / SEC), 6, 14);
      plan = pick(STRUCTURES).slice();
      while (plan.length < n) plan.splice(plan.length - 1, 0, ...(plan.length >= 8 && !plan.slice(6).includes('bridge') ? ['bridge'] : ['verse', 'chorus']));
      if (n >= 7) plan.splice(plan.length - 1, 0, 'solo');
      if (n >= 10) { const i = plan.indexOf('chorus', 2); if (i > 0 && plan[i - 1] === 'verse') plan.splice(i, 0, 'pre'); }
      while (plan.length > n + 1) { const i = plan.indexOf('verse', 2); if (i < 0) break; plan.splice(i, 2); }
      if (plan[plan.length - 1] !== 'chorus') plan.push('chorus');
    }
    const progs = Object.fromEntries(Object.entries(style.progs).map(([t, list]) => [t, pick(list)]));
    if (!boss) { progs.pre = pick(style.progs.bridge); progs.solo = progs.chorus; }
    const leads = Object.fromEntries(Object.entries(style.leads).map(([t, list]) => [t, pick(list)]));
    if (!boss) { leads.pre = leads.verse; leads.bridge = leads.bridge || 'whistle'; }
    const keyName = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][pc];
    return {
      k, seed, R, pick, style, boss, pc, keyName, bpm, plan, progs, leads,
      mode: style.scale === 'major' || style.scale === 'blues' ? 'major' : 'minor',
      tonic: 60 + pc + (pc < 2 ? 12 : 0),
      town: boss ? 'Area 51' : TOWNS[(k - 1) % TOWNS.length].replace('Area 51', 'Rachel'),
      title: boss ? pick(BOSS_TITLES) : `${pick(TITLE_A)} ${pick(TITLE_B)}`,
      // per-song tone and phrasing, so two songs in the same style still differ
      tone: { echo: 0.18 + R() * 0.3, leap: 0.05 + R() * 0.2, rest: R() * 0.15 },
      halfTime: bpm >= 180,                                                // melodies written in half time when fast
      row: Math.round(Math.max(20, 30 - (bpm - 100) * 0.07)),            // pixels of road per beat
      lead: Math.max(0.75, JUMP_LEAD * bpm / 60),                          // jump lead time, in beats
      melodies: new Map(), bars: new Map(), victoryBar: Infinity,
    };
  }

  // ================================================================ pixel art
  const PAL = {
    w: '#f4ead2', b: '#2b4a7a', k: '#1a1a1a', g: '#a0a0a0', G: '#707070', r: '#b5532b', o: '#6fa8d6', l: '#ff3b3b',
    c: '#3fa34d', C: '#25793a', y: '#e8c87a', t: '#a97b43', T: '#6e4a22', s: '#9a8f86', S: '#655c55',
    R: '#d8372f', h: '#f0e6d0', n: '#8b5a2b', Y: '#ffd23a', d: '#c79558', B: '#3a7bff', P: '#2f6fd8', q: '#5ad1ff',
    a: '#7dff7a', A: '#3fbf4a', m: '#b8c4d0', M: '#7d8a99', e: '#111111', x: '#c8f7ff',
  };
  const LIT = { c: '#e6ffd9', C: '#b8f5a8', y: '#fff3c4', Y: '#ffffff' };
  const SPRITES = {
    rv: [
      '...wwwwwwww...', '..wbbbbbbbbw..', '.kwbbbbbbbbwk.', '.kwwwwwwwwwwk.', '..wwwwwwwwww..', '..wwggggggww..',
      '..wwgGGGGgww..', '..wwggggggww..', '..wwwwwwwwww..', '..rrrrrrrrrr..', '..wwwwwwwwww..', '..wwwwwwwwww..',
      '..wwwwwwwwww..', '..rrrrrrrrrr..', '..woowwwwwww..', '.kwoowwwwwwwk.', '.kwwwwwwwwwwk.', '..wwwwwwwwww..',
      '..wwwwwwwwww..', '..wwwwwwwwww..', '..wllwwwwllw..', '...wwwwwwww...',
    ],
    cactus: [
      '....ccc....', '...cCccc...', '...cCccc...', '...cCccc.c.', 'c..cCccc.cc', 'cc.cCccc.cc', 'cc.cCccccc.',
      'cc.cCcccc..', '.cccCccc...', '..ccCccc...', '...cCccc...', '...cCccc...', '...cCccc...', '..ddddddd..',
    ],
    tumble1: ['..ttttt..', '.t.T.t.t.', 'tt.t.tT.t', 't.T.t.t.t', 'ttt.T.ttt', 't.t.t.T.t', 't.Tt.t.tt', '.t.t.T.t.', '..ttttt..'],
    tumble2: ['..ttttt..', '.tt.t.Tt.', 't.t.T.t.t', 'tT.t.t.tt', 't.t.t.t.t', 'tt.T.t.Tt', 't.t.t.t.t', '.T.t.tt..', '..ttttt..'],
    boulder1: ['...ssss...', '.ssSssss..', '.sSsssssS.', 'ssssssssSs', 'sSssssssSs', 'ssssssSsSs', 'sssssSssSs', '.sssssSSs.', '..sSSSSs..', '...ssss...'],
    boulder2: ['...ssss...', '..ssssSss.', '.Sssssssss', 'sSsssSssss', 'sSssssssSs', 'ssSsssssSs', 'sssssssSss', '.sSssssss.', '..sSSSSs..', '...ssss...'],
    note: ['...YY..', '...YYY.', '...Y.YY', '...Y...', '.YYY...', 'YYYY...', 'YYYY...', '.YY....'],
    spare: ['..kkkk..', '.kkggkk.', 'kkg..gkk', 'kg....gk', 'kg....gk', 'kkg..gkk', '.kkggkk.', '..kkkk..'],
    nitro: ['..gg..', '.PPPP.', 'PPqPPP', 'PPqPPP', 'PPqPPP', 'PPqPPP', 'PPPPPP', 'PPPPPP', '.PPPP.'],
    police: [
      '...kkkkkk...', '..kbbbbbbk..', '.kkbbbbbbkk.', '.kkkkkkkkkk.', '..hhhhhhhh..', '..RRRRBBBB..', '..hhhhhhhh..',
      '..hhhhhhhh..', '..kkkkkkkk..', '..kkkkkkkk..', '..hhhhhhhh..', '.kkhhhhhhkk.', '.kkhhhhhhkk.', '..kkkkkkkk..', '...kkkkkk...',
    ],
    sedan: ['..RRRRRR..', '.RbbbbbbR.', 'kRbbbbbbRk', 'kRRRRRRRRk', '.RRRRRRRR.', '.RRRRRRRR.', 'kRbbbbbbRk', 'kRRRRRRRRk', '..RRRRRR..'],
    saucer: [
      '.......xxxxxx.......', '......xxaaaaxx......', '.....xxaeaaeaxx.....', '.....xxaaaaaaxx.....',
      '..mmmmmmmmmmmmmmmm..', '.mMmMmMmMmMmMmMmMmm.', 'mmmmmmmmmmmmmmmmmmmm', '.MMMMYMMMMMMMMYMMMM.', '...MMMMMMMMMMMMMM...',
    ],
    orb: ['.aa.', 'aaaa', 'aAAa', '.aa.'],
    bush: ['.c.c.', 'ccCcc', '.ccc.', '..n..'],
    small: ['..c..', 'c.c..', 'ccc.c', '..ccc', '..c..', '..c..'],
    skull: ['.hhh.', 'hkhkh', 'hhhhh', '.h.h.'],
    rock: ['.ss.', 'sSss', 'ssSs'],
    sign: ['yyyyy', 'ykyky', 'yyyyy', '..n..', '..n..'],
    warn: ['..Y..', '.YkY.', '.YkY.', 'YYYYY', 'YYkYY'],
    hay: ['.yyyyyyy.', 'yyYyyyYyy', 'ynnnnnnny', 'yyyYyyyyy', 'yyyyyYyyy', 'ynnnnnnny', 'yyYyyyyYy', '.yyyyyyy.'],
  };

  Cabinet.register({
    id: 'rocknroll',
    slug: 'rocknroller',
    title: 'RocknRoller',
    color: '#ff9a3c',
    tagline: 'A tour of the Nevada desert in an RV. Every stop is a brand-new one-minute song, and the road is the song.',
    badge: 'Original · rhythm runner',
    modes: [
      { id: 'classic', you: 'RV driver', cpu: 'The desert (and the band)',
        touch: { left: [{ label: '◀', key: 'ArrowLeft' }, { label: '▶', key: 'ArrowRight' }], right: [{ label: 'JUMP', key: 'Space', wide: true }] },
        touchHow: 'Every stop is a new one-minute song, faster than the last. Follow the notes: they sit on the safe route. Hold ◀ ▶ to slide between lanes, JUMP to hop (you always land on a beat). Grab notes, spare tires and nitro; jump tumbleweeds and broken planks. Every 5th stop is an Area 51 boss: stay on the route under the saucer to shoot it.',
        how: 'Every stop is a new one-minute song, 16 BPM faster than the last. Follow the notes: they sit on the planned route, and nothing deadly is ever on it. Hold Left/Right (A/D) to slide between 4 lanes, Up/W/Space to jump (you always land on a beat). Grab notes for the Groove meter (ENCORE!), spare tires for a shield, nitro for an untouchable chorus. Jump tumbleweeds and cracked bridge planks; dodge wrecks, boulders and the police. Every 5th stop is Area 51: stay on the route under the saucer and the RV shoots it on the beat. 3 dents and you’re wrecked.' },
    ],

    create(api) {
      // ============================================================ audio (one context for the tour)
      // Mix: everything -> hit filter -> compressor -> master. A generated reverb room and a
      // slapback echo are sends; instruments are placed left/right in stereo.
      let ac = null, lat = 0, simT = 0, stuck = 0, lastAc = -1;
      let master, filter, bus, delay, dist, noiseBuf, revIn;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) { ac = new AC(); if (ac.state === 'suspended') ac.resume(); setupAudio(); }
      } catch (e) { ac = null; }

      function setupAudio() {
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.18;
        master = ac.createGain();
        master.gain.value = Cabinet.isMuted() ? 0 : 0.85;
        comp.connect(master);
        master.connect(ac.destination);
        filter = ac.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 18000;
        filter.connect(comp);
        bus = ac.createGain();
        bus.gain.value = 0.85;
        bus.connect(filter);
        const conv = ac.createConvolver();
        conv.buffer = impulse(2.2, 3.2);
        revIn = ac.createGain();
        const revOut = ac.createGain(); revOut.gain.value = 0.3;
        revIn.connect(conv); conv.connect(revOut); revOut.connect(filter);
        delay = ac.createDelay(1);
        const fb = ac.createGain(), wet = ac.createGain();
        fb.gain.value = 0.3; wet.gain.value = 0.25;
        delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(filter);
        dist = ac.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 512) - 1) * 4);
        dist.curve = curve;
        const dg = ac.createGain(); dg.gain.value = 0.4;
        dist.connect(dg); dg.connect(bus);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      // A synthetic room: stereo noise that dies away.
      function impulse(sec, decay) {
        const len = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, len, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
        return b;
      }
      // Send a sound to the mix: optional stereo position, reverb, echo, or a different destination.
      function route(node, o) {
        let n = node;
        if (o.pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = o.pan; node.connect(p); n = p; }
        n.connect(o.dest || bus);
        if (o.echo) n.connect(delay);
        if (o.rev) { const sg = ac.createGain(); sg.gain.value = o.rev; n.connect(sg); sg.connect(revIn); }
      }
      // An oscillator voice: optional unison detune, pitch glide, filter sweep, vibrato, plucky decay.
      function voice(type, f, t, dur, vol, o = {}) {
        const g = ac.createGain();
        const rel = o.release !== undefined ? o.release : 0.06;
        const end = t + Math.max(0.03, dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.005));
        if (o.decay) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * o.decay), end);
        else g.gain.setValueAtTime(vol, end);
        g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
        let into = g;
        if (o.lp) {
          const fl = ac.createBiquadFilter();
          fl.type = o.bp ? 'bandpass' : 'lowpass';
          fl.Q.value = o.q || 0.7;
          fl.frequency.setValueAtTime(o.lpFrom || o.lp, t);
          if (o.lpFrom) fl.frequency.exponentialRampToValueAtTime(o.lp, t + (o.lpTime || 0.1));
          fl.connect(g);
          into = fl;
        }
        const cents = o.unison || [0];
        for (const c of cents) {
          const osc = ac.createOscillator();
          osc.type = type;
          osc.detune.value = c;
          osc.frequency.setValueAtTime(o.from || f, t);
          if (o.from) osc.frequency.exponentialRampToValueAtTime(f, t + (o.glide || 0.03));
          if (o.vibrato) {
            const lfo = ac.createOscillator(), lg = ac.createGain();
            lfo.frequency.value = o.vibrato;
            lg.gain.setValueAtTime(0, t);
            lg.gain.linearRampToValueAtTime(f * (o.depth || 0.012), t + (o.vibDelay || 0.01));
            lfo.connect(lg); lg.connect(osc.frequency);
            lfo.start(t); lfo.stop(end + rel + 0.05);
          }
          if (cents.length > 1) { const x = ac.createGain(); x.gain.value = 1 / Math.sqrt(cents.length); osc.connect(x); x.connect(into); }
          else osc.connect(into);
          osc.start(t);
          osc.stop(end + rel + 0.05);
        }
        route(g, o);
      }
      function noise(t, dur, vol, type, freq, q = 0.7, o = {}) {
        const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        src.buffer = noiseBuf;
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g);
        route(g, o);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.05);
      }
      // Metallic cymbals the 808 way: six detuned square waves through a high-pass filter.
      function metal(t, dur, vol, o = {}) {
        const hp = ac.createBiquadFilter(), g = ac.createGain();
        hp.type = 'highpass'; hp.frequency.value = 7000;
        g.gain.setValueAtTime(vol * 0.35, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        hp.connect(g);
        for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
          const osc = ac.createOscillator();
          osc.type = 'square'; osc.frequency.value = f * 1.6;
          osc.connect(hp); osc.start(t); osc.stop(t + dur + 0.02);
        }
        route(g, o);
      }
      // Plucked strings (Karplus-Strong): a burst of noise circulating in a tiny delay line and
      // softening each time round, which sounds like a real string. One buffer per note, cached.
      const ksCache = new Map();
      function ksBuf(m, bright) {
        const key = m + (bright ? 'b' : 'w');
        if (ksCache.has(key)) return ksCache.get(key);
        const sr = ac.sampleRate, f = hz(m), period = sr / f;
        const N = Math.max(2, Math.floor(period - 0.5));
        const len = Math.floor(sr * (bright ? 0.9 : 1.8));
        const buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
        const ring = new Float32Array(N);
        for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
        if (!bright) for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N; i++) ring[i] = 0.5 * (ring[i] + ring[i - 1]);
        const damp = bright ? 0.994 : 0.997;
        for (let i = 0, idx = 0; i < len; i++) {
          const cur = ring[idx], nxt = ring[(idx + 1) % N];
          ring[idx] = damp * 0.5 * (cur + nxt);
          d[i] = cur;
          idx = (idx + 1) % N;
        }
        const out = { buf, rate: f * (N + 0.5) / sr }; // corrects the tuning of the integer-length loop
        ksCache.set(key, out);
        return out;
      }
      function pluck(t, m, dur, vol, o = {}) {
        const { buf, rate } = ksBuf(m, o.bright);
        const src = ac.createBufferSource(), g = ac.createGain();
        src.buffer = buf;
        src.playbackRate.setValueAtTime(rate * (o.bend ? Math.pow(2, -o.bend / 12) : 1), t);
        if (o.bend) src.playbackRate.exponentialRampToValueAtTime(rate, t + 0.06);
        const end = t + Math.max(0.05, dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.setValueAtTime(vol, end);
        g.gain.exponentialRampToValueAtTime(0.0001, end + 0.07);
        let n = src;
        if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; src.connect(f); n = f; }
        n.connect(g);
        route(g, o);
        src.start(t);
        src.stop(end + 0.1);
      }
      // Electric piano: a simple FM bell.
      function fm(t, f, dur, vol, o = {}) {
        const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
        car.frequency.value = f; mod.frequency.value = f * (o.ratio || 1);
        mg.gain.setValueAtTime(f * (o.index || 2), t);
        mg.gain.exponentialRampToValueAtTime(f * 0.05, t + Math.min(0.6, dur));
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
        g.gain.exponentialRampToValueAtTime(vol * 0.2, t + dur);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
        route(g, o);
        car.start(t); mod.start(t);
        car.stop(t + dur + 0.2); mod.stop(t + dur + 0.2);
      }
      const I = {
        kick: (t, v = 0.85) => { voice('sine', 46, t, 0.22, v, { from: 165, glide: 0.08, decay: 0.08, release: 0.08 }); noise(t, 0.012, v * 0.25, 'highpass', 2500); },
        snare: (t, v = 0.3) => { noise(t, 0.16, v, 'bandpass', 1900, 0.8, { rev: 0.25 }); noise(t, 0.05, v * 0.5, 'highpass', 6500); voice('triangle', 180, t, 0.07, v * 0.6, { from: 240, glide: 0.04, decay: 0.15 }); },
        hat: (t, v = 0.06) => metal(t, 0.035, v * 1.3, { pan: 0.3 }),
        openhat: (t) => metal(t, 0.22, 0.07, { pan: 0.3 }),
        brush: (t, v) => noise(t, 0.08, v, 'bandpass', 3500, 0.6, { pan: -0.2 }),
        ride: (t) => metal(t, 0.4, 0.05, { pan: 0.35, rev: 0.15 }),
        shaker: (t, v = 0.13) => noise(t, 0.07, v, 'bandpass', 6500, 1.5, { pan: 0.45 }),
        crash: (t) => { noise(t, 1.4, 0.12, 'highpass', 4000, 0.7, { rev: 0.3, pan: -0.25 }); metal(t, 1.0, 0.08, { pan: -0.25 }); },
        snap: (t, m) => { noise(t, 0.12, 0.3, 'bandpass', 1300, 1.5, { rev: 0.2 }); voice('sine', hz(m), t, 0.2, 0.3, { from: hz(m + 12), glide: 0.06, decay: 0.1 }); }, // a plank breaking, tuned to the root
        tom: (t, m) => { voice('sine', hz(m), t, 0.3, 0.45, { from: hz(m) * 1.6, glide: 0.1, decay: 0.08, pan: (m % 12) / 12 - 0.5, rev: 0.15 }); noise(t, 0.03, 0.12, 'lowpass', 900); },
        bass: (t, m, dur, kind) => {
          dur = Math.max(dur, 0.09);
          if (kind === 'synth') voice('sawtooth', hz(m), t, dur, 0.09, { unison: [-7, 7], lp: 500, lpFrom: 2800, lpTime: 0.12, q: 5, decay: 0.5 });
          else if (kind === 'fuzz') { voice('sawtooth', hz(m), t, dur, 0.06, { dest: dist, lp: 700 }); voice('sine', hz(m - 12), t, dur, 0.18, { decay: 0.6 }); }
          else if (kind === 'upright') { voice('triangle', hz(m), t, dur, 0.24, { lp: 900, decay: 0.2, attack: 0.003 }); noise(t, 0.02, 0.05, 'lowpass', 600); }
          else { voice('sawtooth', hz(m), t, dur, 0.08, { lp: 650, lpFrom: 2200, lpTime: 0.1, decay: 0.45 }); voice('sine', hz(m), t, dur, 0.14, { decay: 0.6 }); }
        },
        drop: (t, from, to, dur) => { voice('sawtooth', hz(to), t, dur, 0.15, { from: hz(from), glide: dur * 0.9, lp: 500 }); voice('sine', hz(to), t, dur, 0.3, { from: hz(from), glide: dur * 0.9 }); },
        strum: (t, tones, dur) => tones.forEach((m, i) => pluck(t + i * 0.014, m + 12, Math.max(dur, 0.12), 0.08, { pan: -0.35, lp: 3200 })),
        trem: (t, tones, dur) => { const n = Math.max(2, Math.floor(dur / 0.075)); for (let k = 0; k < n; k++) tones.forEach((m, i) => pluck(t + k * dur / n + i * 0.005, m + 12, dur / n, 0.045, { pan: -0.3, rev: 0.4, bright: true })); },
        stab: (t, tones, dur) => tones.forEach((m) => voice('square', hz(m + 12), t, Math.max(dur, 0.08), 0.018, { lp: 1800, pan: 0.25 })),
        pluck: (t, m, dur) => voice('square', hz(m), t, Math.max(dur, 0.08), 0.03, { lp: 900, lpFrom: 4500, lpTime: 0.08, decay: 0.25, pan: 0.3, echo: true }),
        pad: (t, tones, dur) => tones.forEach((m, i) => voice('sawtooth', hz(m), t, dur, 0.014, { unison: [-12, 0, 12], lp: 1300, attack: 0.25, release: 0.4, rev: 0.4, pan: (i - 1) * 0.4 })),
        organ: (t, tones, dur) => tones.forEach((m, i) => { const o = { attack: 0.02, vibrato: 6, depth: 0.004, pan: 0.25 * (i - 1), rev: 0.15 }; voice('sine', hz(m), t, dur, 0.03, o); voice('sine', hz(m + 12), t, dur, 0.016, o); voice('sine', hz(m + 19), t, dur, 0.008, o); }),
        power: (t, root, dur) => { for (const iv of [12, 19]) voice('sawtooth', hz(root + iv), t, Math.max(dur, 0.1), 0.035, { unison: [-9, 9], dest: dist, lp: 2600, pan: 0.2 }); },
        solo: (t, m, dur) => playLead('fuzz', t, m, dur, 0.8),
        siren: (t, m, dur) => voice('square', hz(m), t, dur, 0.035, { lp: 2400, vibrato: 9, pan: -0.3 }),
        click: (t, m) => voice('square', hz(m), t, 0.06, 0.05, { lp: 3000 }),
      };
      // The lead instruments. k scales the volume (a doubling plays quieter, an octave up).
      function playLead(inst, t, m, dur, k = 1) {
        const f = hz(m);
        dur = Math.max(dur, 0.08);
        switch (inst) {
          case 'guitar': pluck(t, m, dur, 0.26 * k, { bend: 1, lp: 3800, echo: true, rev: 0.15 }); break;
          case 'surf': { const n = Math.max(1, Math.round(dur / 0.075)); for (let i = 0; i < n; i++) pluck(t + i * dur / n, m, dur / n, 0.2 * k, { bright: true, rev: 0.45, echo: i === 0 }); break; }
          case 'banjo': pluck(t, m, Math.min(dur, 0.4), 0.24 * k, { bright: true, pan: 0.1 }); break;
          case 'steel': voice('triangle', f, t, dur, 0.1 * k, { from: hz(m - 2), glide: 0.12, vibrato: 5.5, depth: 0.007, vibDelay: 0.15, rev: 0.3, echo: true }); voice('sine', f * 2, t, dur, 0.03 * k, { from: hz(m + 10), glide: 0.12 }); break;
          case 'trumpet': voice('sawtooth', f, t, dur, 0.055 * k, { unison: [-5, 5], lp: 2800, lpFrom: 450, lpTime: 0.07, attack: 0.03, vibrato: 5.5, depth: 0.006, vibDelay: 0.2, rev: 0.25 }); break;
          case 'whistle': voice('sine', hz(m + 12), t, dur, 0.09 * k, { attack: 0.03, vibrato: 5.5, depth: 0.012, rev: 0.3, echo: true }); break;
          case 'harp': voice('square', f, t, dur, 0.05 * k, { bp: true, lp: 1500, q: 1.1, from: hz(m - 1), glide: 0.05, vibrato: 5, depth: 0.012, attack: 0.02, rev: 0.15 }); voice('sawtooth', f, t, dur, 0.015 * k, { lp: 2500, attack: 0.02 }); break;
          case 'rhodes': fm(t, f, Math.max(dur, 0.3), 0.12 * k, { ratio: 1, index: 2.5, pan: -0.15, rev: 0.2 }); break;
          case 'synth': voice('sawtooth', f, t, dur, 0.05 * k, { unison: [-9, 9], lp: 2400, lpFrom: 5200, lpTime: 0.18, q: 2, from: S.lastSynth ? hz(S.lastSynth) : 0, glide: 0.04, echo: true }); S.lastSynth = m; break;
          case 'chip': voice('square', f, t, dur * 0.85, 0.04 * k, { lp: 5200 }); break;
          case 'fuzz': voice('sawtooth', f, t, dur, 0.035 * k, { unison: [-7, 7], dest: dist, lp: 3000, vibrato: 5, depth: 0.008, vibDelay: 0.15, from: hz(m - 1), glide: 0.04 }); break;
          case 'fiddle': voice('sawtooth', f, t, dur, 0.05 * k, { unison: [-4, 4], lp: 3200, attack: 0.05, vibrato: 6, depth: 0.01, vibDelay: 0.08, rev: 0.25 }); break;
          case 'marimba': voice('sine', f, t, Math.min(dur, 0.45), 0.13 * k, { decay: 0.01, release: 0.05 }); voice('sine', f * 4, t, 0.08, 0.03 * k, { decay: 0.01 }); break;
          case 'farfisa': voice('square', f, t, dur, 0.03 * k, { lp: 2600, vibrato: 7, depth: 0.006 }); voice('sawtooth', f * 2, t, dur, 0.012 * k, { lp: 3000 }); break;
          case 'theremin': voice('sine', hz(m + 12), t, dur, 0.1 * k, { attack: 0.04, vibrato: 6, depth: 0.03, from: S.lastLead ? hz(S.lastLead + 12) : 0, glide: 0.08, echo: true, rev: 0.3 }); S.lastLead = m; break;
          default: pluck(t, m, dur, 0.22 * k, { bend: 1, echo: true });
        }
      }

      // ============================================================ tour + song state
      const tour = { k: 0, score: 0, hp: 3, spare: false, results: [], style: '' };
      let song = null, S = null;

      // ------------------------------------------------------------ song structure
      const endBar = () => Math.min(INTRO_BARS + song.plan.length * SEC, song.victoryBar) + OUTRO_BARS;
      function sectionOf(bar) {
        if (bar < INTRO_BARS) return { type: 'intro', s: -1, inSec: bar };
        if (bar >= song.victoryBar) return { type: 'outro', s: 999, inSec: bar - song.victoryBar };
        const i = bar - INTRO_BARS, s = Math.floor(i / SEC);
        if (s < song.plan.length) return { type: song.plan[s], s, inSec: i % SEC };
        return { type: 'outro', s: song.plan.length, inSec: i - song.plan.length * SEC };
      }
      function chordSym(bar) {
        const sec = sectionOf(bar);
        const main = song.boss ? 'attack' : 'chorus';
        if (sec.type === 'intro') return song.progs[song.boss ? 'attack' : 'verse'][0];
        if (sec.type === 'outro') return sec.inSec >= OUTRO_BARS - 1 ? song.progs[main][0] : song.progs[main][sec.inSec % 4];
        return song.progs[sec.type][sec.inSec % 4];
      }
      function chordOf(bar) {
        const sym = chordSym(bar);
        const [off, q] = CHORDS[sym];
        const rootPc = (song.pc + off) % 12;
        const third = q === 'm' ? 3 : 4;
        const bassRoot = 40 + ((rootPc - 4 + 12) % 12);
        const comp = 52 + ((rootPc - 4 + 12) % 12);
        const tones = [comp, comp + third, comp + 7];
        if (q === '7') tones.push(comp + 10);
        return { sym, rootPc, bassRoot, third, tones, pcs: tones.map((m) => m % 12) };
      }
      function scaleFor(chord) {
        const iv = SCALES[song.style.melScale || song.style.scale].slice();
        if (song.style.harmV && chord.sym === 'V') { const i = iv.indexOf(10); if (i >= 0) iv[i] = 11; }
        const set = new Set(iv.map((x) => (song.pc + x) % 12));
        const out = [];
        for (let m = 55; m <= 90; m++) if (set.has(m % 12)) out.push(m);
        return out;
      }
      const nearestIn = (list, m) => list.reduce((b, x) => (Math.abs(x - m) < Math.abs(b - m) ? x : b), list[0]);

      // Melody for one section: 2-bar phrases (A B, or A A for a hook) built from motifs whose
      // rhythms come from the style; downbeats and phrase ends land on chord tones. Above 180 BPM
      // the melody is written in half time (each phrase stretched over 4 bars) so it stays singable.
      function melodyFor(s) {
        if (song.melodies.has(s)) return song.melodies.get(s);
        const type = song.plan[s];
        const bars = type === 'solo' ? soloFor(s) : tuneFor(s, type);
        song.melodies.set(s, bars);
        return bars;
      }
      function tuneFor(s, type) {
        const R = song.R;
        const center = song.tonic + (type === 'chorus' || type === 'attack' ? 7 : type === 'bridge' ? 3 : type === 'pre' ? 5 : 2);
        const fast = song.bpm >= 150;
        const rhythms = song.style.rhythms.filter((k) => !(fast && k === 'synco')).flatMap((k) => RHYTHMS[k]);
        const stretch = song.halfTime ? 2 : 1;
        const motif = () => song.pick(rhythms).filter(() => R() > song.tone.rest).map(([st, len]) => {
          const r = R();
          let mv = r < song.tone.leap ? (R() < 0.5 ? -4 : 4) : r < song.tone.leap + 0.13 ? 0 : (R() < 0.5 ? -1 : 1) * (R() < 0.7 ? 1 : 2);
          if (type === 'pre' && R() < 0.4) mv = Math.abs(mv) || 1; // a pre-chorus climbs
          return { st: st * stretch, len: len * stretch, mv };
        });
        const A = motif(), B = motif();
        const nPhrases = SEC / (2 * stretch);
        const phrases = nPhrases >= 2 ? (type === 'chorus' && R() < 0.4 ? [A, A] : [A, B]) : [type === 'verse' ? A : B];
        const bars = Array.from({ length: SEC }, () => []);
        let prev = center;
        phrases.forEach((ph, p) => {
          ph.forEach((n, i) => {
            const bi = p * 2 * stretch + Math.floor(n.st / 16);
            if (bi >= SEC) return;
            const bar = INTRO_BARS + s * SEC + bi;
            const chord = chordOf(bar);
            const scale = scaleFor(chord);
            let m;
            if (i === 0) { const ct = scale.filter((x) => chord.pcs.includes(x % 12)); m = nearestIn(ct.length ? ct : scale, prev); }
            else {
              const idx = scale.indexOf(nearestIn(scale, prev)) + n.mv;
              m = scale[U.clamp(idx, 0, scale.length - 1)];
              if (m > center + 10 || m < center - 9) m = scale[U.clamp(scale.indexOf(nearestIn(scale, prev)) - n.mv, 0, scale.length - 1)];
            }
            const last = i === ph.length - 1;
            if (n.st % 16 === 0 || last) {
              const tones = scale.filter((x) => chord.pcs.includes(x % 12) && (!(last && p === phrases.length - 1) || x % 12 === chord.rootPc));
              m = nearestIn(tones.length ? tones : scale, m);
            }
            prev = m;
            bars[bi].push([n.st % 16, m, n.len]);
          });
        });
        return bars;
      }
      // A solo: four bars of figures (arpeggios up/down, scale runs, bent long notes) over the
      // chords, in 8ths (quarters when fast), ending on a long root.
      function soloFor(s) {
        const R = song.R, step = song.halfTime ? 4 : 2;
        const bars = Array.from({ length: SEC }, () => []);
        let m = song.tonic + 12;
        for (let b = 0; b < SEC; b++) {
          const bar = INTRO_BARS + s * SEC + b, chord = chordOf(bar), scale = scaleFor(chord).filter((x) => x >= song.tonic + 3 && x <= song.tonic + 22);
          const tones = scale.filter((x) => chord.pcs.includes(x % 12));
          if (b === SEC - 1) { bars[b].push([0, nearestIn(scale.filter((x) => x % 12 === chord.rootPc), m), 12]); continue; }
          const fig = song.pick(['arpUp', 'arpDown', 'runUp', 'runDown', 'bend']);
          if (fig === 'bend') {
            bars[b].push([0, nearestIn(tones, m), 6], [8, nearestIn(tones, m + 3), 6]);
            m = nearestIn(tones, m + 3);
            continue;
          }
          const src = fig.startsWith('arp') ? tones : scale;
          let i = src.indexOf(nearestIn(src, m));
          const dir = fig.endsWith('Up') ? 1 : -1;
          for (let st = 0; st < 16; st += step) {
            i = U.clamp(i + dir, 0, src.length - 1);
            if (i === 0 || i === src.length - 1) i = U.clamp(i - 2 * dir, 0, src.length - 1);
            m = src[i];
            bars[b].push([st, m, step]);
          }
          if (R() < 0.3) m += dir * 2;
        }
        return bars;
      }
      function barInfo(bar) {
        if (song.bars.has(bar)) return song.bars.get(bar);
        const sec = sectionOf(bar);
        let melody = [];
        if (['verse', 'chorus', 'bridge', 'attack', 'solo', 'pre'].includes(sec.type)) melody = melodyFor(sec.s)[sec.inSec];
        else if (sec.type === 'outro') {
          if (sec.inSec < OUTRO_BARS - 1) {
            const lastMain = song.plan.lastIndexOf(song.boss ? 'attack' : 'chorus');
            melody = melodyFor(lastMain)[sec.inSec % SEC];
          } else if (sec.inSec === OUTRO_BARS - 1) melody = [[0, nearestIn(scaleFor(chordOf(bar)).filter((x) => x % 12 === song.pc), song.tonic + 7), 16]];
        }
        const info = { bar, sec, type: sec.type, inSec: sec.inSec, chord: chordOf(bar), melody };
        song.bars.set(bar, info);
        return info;
      }
      const melodyRange = () => [song.tonic - 7, song.tonic + 16];
      const laneOfPitch = (m) => { const [lo, hi] = melodyRange(); return U.clamp(Math.round(((m - lo) / (hi - lo)) * (NL - 1)), 0, NL - 1); };
      const D = () => Math.min(10, song.k);

      // ------------------------------------------------------------ clock
      const timeAt = (beat) => (beat * 60) / song.bpm;
      const beatAt = (t) => (t * song.bpm) / 60;
      const stepDur = () => 15 / song.bpm;
      const stepsFor = (sec) => Math.ceil(sec / stepDur() - 1e-9);
      // Swing styles push the "and" of each beat late (a shuffle). Everything uses this, so the
      // obstacles swing with the music.
      const stepBeat = (n) => n / 4 + (song.style.swing && U.wrap(n, 4) === 2 ? song.style.swing : 0);
      const songTime = () => (ac ? ac.currentTime - S.t0 - lat : simT - S.simStart);
      // Bridge: cracks every jumpGap beats (2 if a jump fits in a beat, else 4), so they're always clearable.
      const jumpGap = () => (Math.ceil(song.lead) + 1 <= 2 ? 2 : 4);
      const crackSteps = () => (jumpGap() === 2 ? [0, 8] : [0]);

      // ============================================================ the arrangement
      // stepEvents(n): what the band plays on 16th step n. Pure, so audio, visuals and charting agree.
      const interval = (tok, chord) => (tok === '3' ? chord.third : IV_[tok]);
      function stepEvents(n) {
        const bar = Math.floor(n / 16), s = n % 16;
        const info = barInfo(bar);
        const { sec, chord, melody, type } = info;
        const sd = stepDur(), st = song.style;
        // Above ~200 BPM, 16th notes become a blur: the band switches to an 8th-note grid.
        const stride = sd < 0.075 ? 2 : 1, onGrid = s % stride === 0;
        const ev = { info, s, stepDur: sd, kick: 0, snares: [], hat: 0, open: false, brush: 0, ride: false, crash: false, snap: false, bass: null, drop: null, comps: [], toms: [], notes: [], lead: song.leads.verse || song.leads.attack, click: null };
        if (bar >= endBar()) return ev;
        if (type === 'intro') {
          if (s % 4 === 0) ev.kick = 0.6;
          if (s % (2 * stride) === 0) ev.hat = 0.04;
          if (bar === INTRO_BARS - 1 && s % 4 === 0) ev.click = s === 0 ? song.tonic + 12 : song.tonic + 7;
          return ev;
        }
        const r = chord.bassRoot;
        if (type === 'outro' && sec.inSec === OUTRO_BARS - 1) {
          if (s === 0) {
            ev.kick = 1; ev.crash = true; ev.bass = [r, sd * 14]; ev.comps.push(['power', [r + 12], sd * 14], ['pad', chord.tones, sd * 16]);
            ev.lead = song.leads.chorus || song.leads.attack;
            for (const [ss, m, len] of melody) if (ss === s) ev.notes.push([m, sd * len * 0.95]);
          }
          return ev;
        }
        const role = type === 'outro' ? (song.boss ? 'attack' : 'chorus') : type === 'pre' ? 'verse' : type === 'solo' ? 'chorus' : type;
        const fill = sec.inSec === SEC - 1 && !['outro', 'bridge', 'pre'].includes(type);
        if (type === 'bridge') {
          // Half-time; the planks crack (snap) on the bridge's own beat, tuned to the chord root.
          if (s === 0 || s === 10) ev.kick = 0.85;
          if (crackSteps().includes(s)) ev.snap = true;
          else if (s === 8) ev.snares.push(0.25);
          if (s % 4 === 0) ev.ride = true;
          if (s === 0 && sec.inSec === 0) ev.drop = [r + 12, r - 12, sd * 6];
          else if (s === 0 || s === 8) ev.bass = [s ? r + 7 : r, sd * 7];
          if (s === 0) ev.comps.push(['pad', chord.tones, sd * 16]);
          ev.lead = song.leads.bridge || 'whistle';
        } else {
          const dr = st.drums[role];
          const late = fill && s >= 8;
          if (onGrid) {
            if (dr.kick.includes(s)) ev.kick = 0.85;
            if (dr.snare.includes(s) && !late) ev.snares.push(0.3);
            if (!late) {
              if (dr.hat === 16) ev.hat = s % 2 ? 0.025 : 0.06;
              else if (dr.hat === 8 && s % 2 === 0) ev.hat = 0.05;
              else if (dr.hat === 'off') { if (s % 4 === 2) ev.open = true; else if (s % 2 === 0) ev.hat = 0.03; }
              else if (dr.hat === 'ride' && s % 4 === 0) ev.ride = true;
              else if (dr.hat === 'brush') ev.brush = s % 4 === 0 ? 0.1 : 0.04;
            }
            for (const [ss, tok, len] of st.bass[role]) if (ss === s) ev.bass = [r + interval(tok, chord), sd * len];
            for (const [kind, steps, len] of st.comp[role]) {
              if (!steps.includes(s)) continue;
              if (kind === 'power') ev.comps.push(['power', [r + 12], sd * len]);
              else if (kind === 'pluck') ev.comps.push(['pluck', [chord.tones[(s / 2) % chord.tones.length] + 12], sd * len]);
              else ev.comps.push([kind, chord.tones, sd * len]);
            }
          }
          // The pre-chorus builds: a pad swells under it and the last bar is a rising snare roll.
          if (type === 'pre') {
            if (s === 0) ev.comps.push(['pad', chord.tones, sd * 16]);
            if (sec.inSec === SEC - 1 && s % (2 * stride) === 0) ev.snares.push(0.06 + 0.016 * s);
          }
          if (fill && [8, 10, 12, 14].includes(s)) ev.toms.push(r + 24 - [0, 5, 12 - chord.third, 12][(s - 8) / 2]);
          if (s === 0 && sec.inSec === 0 && (role === 'chorus' || role === 'attack')) ev.crash = true;
          ev.lead = song.leads[type] || song.leads[role];
        }
        for (const [ss, m, len] of melody) if (ss === s) ev.notes.push([m, sd * len * 0.95]);
        return ev;
      }
      function stepEv(n) {
        if (n < 0) return null;
        let ev = S.evCache.get(n);
        if (!ev) {
          ev = stepEvents(n);
          S.evCache.set(n, ev);
          if (S.evCache.size > 900) S.evCache.delete(S.evCache.keys().next().value);
        }
        return ev;
      }
      const nitroOn = (bar) => S.nitroSec >= 0 && sectionOf(bar).s === S.nitroSec && sectionOf(bar).type === 'chorus';
      const encoreOn = (bar) => !!S.encore && bar >= S.encore.from && bar < S.encore.to;

      function playStep(n, t) {
        const ev = stepEv(n);
        const bar = Math.floor(n / 16);
        if (ev.kick) I.kick(t, ev.kick);
        for (const v of ev.snares) I.snare(t, v);
        if (ev.hat) I.hat(t, ev.hat);
        if (ev.open) I.openhat(t);
        if (ev.brush) I.brush(t, ev.brush);
        if (ev.ride) I.ride(t);
        if (ev.crash) I.crash(t);
        if (ev.snap) I.snap(t, ev.info.chord.bassRoot);
        if (ev.click) I.click(t, ev.click);
        for (const m of ev.toms) I.tom(t, m);
        if (ev.bass) I.bass(t, ev.bass[0], ev.bass[1], song.style.bassVoice);
        if (ev.drop) I.drop(t, ev.drop[0], ev.drop[1], ev.drop[2]);
        for (const [kind, tones, dur] of ev.comps) {
          if (kind === 'power') I.power(t, tones[0], dur);
          else if (kind === 'pluck') I.pluck(t, tones[0], dur);
          else I[kind](t, tones, dur);
        }
        const [leadA, leadB] = ev.lead.split('+');
        for (const [m, dur] of ev.notes) {
          playLead(leadA, t, m, dur, 1);
          if (leadB) playLead(leadB, t, m + 12, dur, 0.4); // the doubling, an octave up and quieter
        }
        if (encoreOn(bar)) { // ENCORE: a guitar solo up and down the chord in 16ths
          const c = ev.info.chord, tones = [c.bassRoot + 24, c.bassRoot + 24 + c.third, c.bassRoot + 31, c.bassRoot + 36];
          I.solo(t, tones[[0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2][ev.s]], ev.stepDur * 0.9);
        }
        for (const snd of S.sounds.get(n) || []) {
          if (snd.k === 'siren') I.siren(t, snd.m, ev.stepDur * 1.8);
          else I.shaker(t);
        }
        S.sounds.delete(n);
      }
      function schedule() {
        if (!ac) return;
        const horizon = ac.currentTime + 0.15;
        for (;;) {
          const t = S.t0 + timeAt(stepBeat(S.nextStep));
          if (t > horizon || S.nextStep >= endBar() * 16) break;
          if (t >= ac.currentTime - 0.03) playStep(S.nextStep, t);
          S.nextStep++;
        }
      }
      const RATES = { kick: 9, snare: 10, hat: 14, bass: 7, chord: 5, note: 6, crash: 2.2, tom: 8, snap: 7 };
      function envelopes(t) {
        const out = { kick: 0, snare: 0, hat: 0, bass: 0, chord: 0, note: 0, crash: 0, tom: 0, snap: 0, hatN: 0 };
        const n0 = Math.floor(beatAt(t) * 4), found = {};
        for (let n = n0; n > n0 - 24; n--) {
          const ev = stepEv(n);
          if (!ev) break;
          const et = timeAt(stepBeat(n));
          if (et > t) continue;
          const hit = {
            kick: ev.kick > 0, snare: ev.snares.length > 0 || ev.snap, hat: ev.hat > 0 || ev.open || ev.brush > 0 || ev.ride, bass: !!ev.bass || !!ev.drop,
            chord: ev.comps.length > 0, note: ev.notes.length > 0, crash: ev.crash, tom: ev.toms.length > 0, snap: ev.snap,
          };
          for (const k in RATES) {
            if (found[k] || !hit[k]) continue;
            found[k] = true;
            out[k] = Math.exp(-Math.max(0, t - et) * RATES[k]);
            if (k === 'hat') out.hatN = n;
          }
        }
        return out;
      }

      // ============================================================ route planning + charting
      function routeLane(n) {
        let lane = 1;
        for (const c of S.changes) { if (c.n <= n) lane = c.to; else break; }
        return lane;
      }
      function reserved(lane, n) {
        if (routeLane(n) === lane) return true;
        for (const c of S.changes) { if (c.to === lane && n >= c.n - c.w && n <= c.n) return true; if (c.n - c.w > n) break; }
        return false;
      }
      const has = (m, k, l) => m.get(k) && m.get(k).has(l);
      const setAdd = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
      const span = (a) => { const out = []; for (let d = -a; d <= a; d++) out.push(d); return out; };
      // May a hazard go in `lane` at step n? Never on (or near) the route, never on a landing.
      function canBlock(lane, n, steps) {
        if (lane < 0 || lane >= NL) return false;
        steps = steps || span(Math.max(1, stepsFor(MARGIN)));
        return steps.every((d) => !reserved(lane, n + d) && !has(S.occ, n + d, lane) && !has(S.land, n + d, lane));
      }
      const laneFree = (lane, a, b) => { for (let k = a; k <= b; k++) if (has(S.occ, k, lane)) return false; return true; };
      function addHazard(type, lane, n, extra = {}) {
        S.events.push({ type, lane, n, beat: stepBeat(n), ...extra });
        if (lane >= 0) setAdd(S.occ, n, lane);
      }
      const addPickup = (type, lane, n, extra = {}) => S.events.push({ type, lane, n, beat: stepBeat(n), ...extra });
      const addSound = (n, snd) => S.sounds.set(n, [...(S.sounds.get(n) || []), snd]);
      function besideRoute(n, steps) {
        const r = routeLane(n), side = (n >> 1) % 2 ? 1 : -1;
        for (const l of [r + side, r - side, r + 2 * side, r - 2 * side, r + 3 * side, r - 3 * side]) if (canBlock(l, n, steps)) return l;
        return -1;
      }
      const notePriority = (st, len) => (st % 16 === 0 ? 4 : st % 8 === 0 ? 3 : st % 4 === 0 ? 2 : 1) + (len >= 4 ? 0.5 : 0);

      function chartBar(bar) {
        const info = barInfo(bar);
        const { sec, type, melody } = info;
        if (type === 'intro' || bar >= endBar()) return;
        const n0 = bar * 16, d = D();
        const W = Math.max(4, stepsFor(SLIDE_WINDOW));                       // time to slide over
        const minChange = Math.max(d <= 2 ? 8 : 4, stepsFor(MIN_MOVE_GAP), W); // the route moves at most this often
        const maxStay = Math.max(minChange + 2, stepsFor(maxStillFor(song.k))); // ...and at least this often
        const quiet = (a, b) => { for (let k = a; k <= b; k++) S.quiet.add(k); };
        const isQuiet = (n) => S.quiet.has(n);
        const hazardKind = song.boss ? 'orb' : 'cactus';

        // --- jump moments, decided by the arrangement
        if (type === 'bridge') {
          // The planks crack on the bridge's beat (sub-drop on bar 1, then the snare) - no tumbleweeds.
          const qs = stepsFor(MARGIN) + 2;
          for (const st of crackSteps()) { addHazard('crack', -1, n0 + st); quiet(n0 + st - qs, n0 + st + qs); }
        }
        if (type === 'chorus' && sec.inSec === 1 && d >= 2) {
          // Tumbleweeds (the shaker) bounce across one lane per beat.
          const dir = (S.tumbleCount++ % 2) ? -1 : 1;
          S.tumbles.push({ b0: bar * 4, dir });
          addSound(n0, { k: 'shaker' });
          for (let k = 1; k <= NL; k++) {
            const lane = dir > 0 ? k - 1 : NL - k, n = n0 + k * 4;
            setAdd(S.land, n, lane);
            S.events.push({ type: 'land', lane, n, beat: stepBeat(n) });
            addSound(n, { k: 'shaker' });
          }
          quiet(n0, n0 + NL * 4 + 2);
        }

        // Rhythm-section hits (chords, bass, kick, snare) that aren't already melody notes: they
        // keep the route moving when the melody is sparse (e.g. written in half time at speed).
        const chordHits = [];
        for (let st = 0; st < 16; st += 2) {
          const ev = stepEv(n0 + st);
          if (!ev.notes.length && (ev.comps.length || ev.bass || ev.kick || ev.snares.length)) chordHits.push(st);
        }

        // --- 1) plan the route: it follows the melody's pitch, and if it has sat still too long a
        //        chord hit moves it on, so it keeps moving at every tempo
        if (type !== 'outro') {
          const cands = melody.map(([st, m]) => ({ st, m })).concat(chordHits.map((st) => ({ st, m: null }))).sort((a, b) => a.st - b.st);
          for (const { st, m } of cands) {
            const n = n0 + st;
            if (isQuiet(n) || n - S.lastChange < minChange) continue;
            const cur = S.routeCur, stale = n - S.lastChange >= maxStay;
            if (m === null && !stale) continue;
            const target = m === null ? cur : laneOfPitch(type === 'solo' ? m - 12 : m);
            if (target === cur && !stale) continue;
            const to = target !== cur ? cur + Math.sign(target - cur) : cur === 0 ? 1 : cur === NL - 1 ? NL - 2 : hash(n) < 0.5 ? cur - 1 : cur + 1;
            if (!laneFree(to, n - W - 1, n + 1)) continue;
            S.changes.push({ n, from: cur, to, w: W, chord: m === null });
            S.routeCur = to;
            S.lastChange = n;
          }
        }

        // --- 2) instrument hazards around the route
        if (sec.inSec === 0 && (type === 'chorus' || type === 'attack') && d >= 2) {
          // The crash cymbal: a pile-up (or, at Area 51, tractor beams) in two lanes beside the route.
          const n = n0, r = routeLane(n);
          const pairs = [[0, 1], [1, 2], [2, 3]].filter(([a, b]) => canBlock(a, n) && canBlock(b, n))
            .sort((p, q) => Math.abs((p[0] + p[1]) / 2 - r) - Math.abs((q[0] + q[1]) / 2 - r));
          if (pairs.length) for (const l of pairs[0]) addHazard(song.boss ? 'beam' : 'wreck', l, n);
        }
        if (type === 'chorus' && sec.inSec === 2 && d >= 2 && !isQuiet(n0 + 8)) {
          // The siren: a police car races up from behind; its siren plays chord tones.
          const n = n0 + 8, sirenAt = [8, 6, 4, 2].map((k) => n - Math.max(k, Math.round(k * stepsFor(0.12) / 2)));
          const lane = besideRoute(n, span(Math.max(2, stepsFor(MARGIN))).concat(sirenAt.map((x) => x - n)));
          if (lane >= 0) {
            const c = info.chord;
            addHazard('police', lane, n);
            sirenAt.forEach((sn, k) => { addSound(sn, { k: 'siren', m: c.bassRoot + 36 + (k % 2 ? 7 : c.third) }); S.sirens.push(sn); });
          }
        }
        {
          for (const st of d >= 2 ? [8, 10, 12, 14] : [12, 14]) { // the tom fill rolls boulders (orbs at Area 51)
            const n = n0 + st;
            if (isQuiet(n) || !stepEv(n).toms.length) continue;
            const lane = besideRoute(n);
            if (lane >= 0) addHazard(song.boss ? 'orb' : 'boulder', lane, n);
          }
        }

        // --- 3) every melody note becomes an element
        for (const [st, m, len] of melody) {
          const n = n0 + st;
          const change = S.changes.find((c) => c.n === n);
          if (type === 'outro' || isQuiet(n)) { addPickup('note', routeLane(n), n, { m }); continue; }
          if (change && canBlock(change.from, n, span(Math.max(1, stepsFor(MARGIN))).filter((x) => x >= 0))) { addHazard(hazardKind, change.from, n, { m, push: true }); continue; }
          if (type === 'solo' || notePriority(st, len) >= 3) { addPickup('note', routeLane(n), n, { m }); continue; } // a solo rains notes onto the route
          const lane = besideRoute(n);
          if (lane >= 0) addHazard(hazardKind, lane, n, { m });
          else addPickup('note', routeLane(n), n, { m });
          if (d >= 4 && len >= 3) { const l2 = besideRoute(n); if (l2 >= 0) addHazard(hazardKind, l2, n, { m }); }
        }

        // --- 3b) chord hits: a hay bale pushes you along when a chord moves the route, and more hay
        //         goes beside the route until this stop's obstacle rate is met
        if (type !== 'outro') {
          const hayKind = song.boss ? 'orb' : 'hay';
          for (const c of S.changes) {
            if (!c.chord || c.n < n0 || c.n >= n0 + 16 || isQuiet(c.n)) continue;
            const ev = stepEv(c.n), src = ev.comps.length ? 'chord' : ev.bass ? 'bass' : 'drum';
            if (canBlock(c.from, c.n, span(Math.max(1, stepsFor(MARGIN))).filter((x) => x >= 0))) addHazard(hayKind, c.from, c.n, { push: true, src });
          }
          const target = Math.round(hazardRate(song.k) * 240 / song.bpm);
          let have = S.events.filter((e) => e.n >= n0 && e.n < n0 + 16 && LANE_HAZARDS.has(e.type)).length;
          // Rhythm-section moments, best first: chord hits, then bass notes, then kick/snare hits.
          const moments = [];
          for (let st = 0; st < 16; st += 2) {
            const ev = stepEv(n0 + st);
            // (in a solo every step is a note pickup, so a bale may sit beside the route on the note)
            if (ev.notes.length && type !== 'solo') continue;
            const src = ev.notes.length ? 'note' : ev.comps.length ? 'chord' : ev.bass ? 'bass' : ev.kick || ev.snares.length || ev.snap ? 'drum' : null;
            if (src) moments.push({ st, src, rank: { chord: 0, note: 0, bass: 1, drum: 2 }[src] * 4 + (st % 4 ? 1 : 0) });
          }
          moments.sort((a, b) => a.rank - b.rank || a.st - b.st);
          for (let pass = 0; pass < 2 && have < target; pass++) { // a second pass may add a second bale beside the route
            for (const { st, src } of moments) {
              if (have >= target) break;
              const n = n0 + st;
              if (isQuiet(n)) continue;
              const lane = besideRoute(n);
              if (lane >= 0) { addHazard(hayKind, lane, n, { src }); have++; }
            }
          }
        }

        // --- 4) boss shots: on the kick on beats 1 and 3, if you're on the route you're lined up
        if (type === 'attack') for (const st of [0, 8]) S.events.push({ type: 'shot', lane: routeLane(n0 + st), n: n0 + st, beat: stepBeat(n0 + st) });

        // --- 5) power-ups on the route
        if ((type === 'verse' || (type === 'attack' && sec.s % 4 === 1)) && sec.inSec === 1) addPickup('spare', routeLane(n0 + 8), n0 + 8);
        if ((type === 'verse' || type === 'bridge' || type === 'pre') && sec.inSec === 2 && song.plan[sec.s + 1] === 'chorus') addPickup('nitro', routeLane(n0 + 8), n0 + 8, { forSec: sec.s + 1 });
        if (type === 'outro' && sec.inSec === OUTRO_BARS - 1) S.events.push({ type: 'finish', lane: -1, n: n0, beat: stepBeat(n0) });
        S.events.sort((a, b) => a.n - b.n);
      }

      // ============================================================ playing
      const rv = { lane: 1, x: LANES[1] };
      const hold = { dir: 0, t: 0 };
      const pops = [], dust = [], booms = [];
      let shake = 0, hurtT = 0, over = false;

      function startSong() {
        tour.k++;
        song = makeSong(tour.k, tour.style);
        if (!song.boss) tour.style = song.style.name;
        S = {
          t0: ac ? ac.currentTime + 0.35 : 0, simStart: simT + 0.35,
          evCache: new Map(), events: [], tumbles: [], occ: new Map(), land: new Map(), quiet: new Set(), sounds: new Map(),
          sirens: [], changes: [], routeCur: 1, lastChange: -99, tumbleCount: 0,
          genBar: INTRO_BARS, nextStep: 0, lastBeat: -1, bp: 0, lastLead: 0,
          groove: 0, encore: null, nitroSec: -1, notesTotal: 0, notesGot: 0, hits: 0, streak: 0, bestStreak: 0,
          phase: 'play', resultsT: 0, grade: '', landT: -99, takeoff: -99, nextJump: -99, landed: true,
          // Two shots a bar when lined up: ~50 shots is roughly a song's length of fighting.
          boss: song.boss ? { hp: 44 + 8 * (tour.k / BOSS_EVERY), max: 44 + 8 * (tour.k / BOSS_EVERY), dead: false, hitT: -9, lasers: [] } : null,
        };
        rv.lane = 1; rv.x = LANES[1];
        if (ac) { filter.frequency.cancelScheduledValues(ac.currentTime); filter.frequency.setValueAtTime(18000, ac.currentTime); delay.delayTime.setValueAtTime(song.tone.echo, ac.currentTime); }
      }

      const chordNow = () => chordOf(Math.max(INTRO_BARS, Math.floor(S.bp / 4)));
      const sfxOn = () => ac && !Cabinet.isMuted();
      // ---- every sound effect is built from the current chord, so it's always in key
      const SFX = {
        lane(l) { if (!sfxOn()) return; const c = chordNow(); pluck(ac.currentTime, [c.tones[0], c.tones[1], c.tones[2], c.tones[0] + 12][l] + 12, 0.12, 0.06, { bright: true, pan: (l - 1.5) * 0.3 }); },
        jump() { if (!sfxOn()) return; const c = chordNow(); playLead('steel', ac.currentTime, c.bassRoot + 31, 0.28, 0.7); },
        land() { if (!sfxOn()) return; const c = chordNow(); voice('sine', hz(c.bassRoot), ac.currentTime, 0.2, 0.25, { from: hz(c.bassRoot + 12), glide: 0.08, decay: 0.1 }); },
        note(m) { if (!sfxOn()) return; pluck(ac.currentTime, m + 12, 0.2, 0.08, { bright: true, rev: 0.2 }); },
        hit() { if (!sfxOn()) return; const c = chordNow(); I.power(ac.currentTime, c.bassRoot - 12, 0.5); },
        arp(octaves) { if (!sfxOn()) return; const c = chordNow(), t = ac.currentTime; for (let i = 0; i < octaves * 3; i++) pluck(t + i * 0.06, c.tones[i % 3] + 12 * (1 + Math.floor(i / 3)), 0.2, 0.09, { bright: true, rev: 0.25 }); },
        smash(l) { if (!sfxOn()) return; const c = chordNow(); pluck(ac.currentTime, c.tones[l % 3] + 24, 0.1, 0.08, { bright: true }); },
        zap() { if (!sfxOn()) return; const c = chordNow(), t = ac.currentTime; [0, 1, 2].forEach((i) => voice('square', hz(c.tones[i] + 24), t + i * 0.025, 0.08, 0.04, { lp: 3500, pan: 0.2 })); },
        boom() { if (!sfxOn()) return; const c = chordNow(); I.crash(ac.currentTime); I.drop(ac.currentTime, c.bassRoot + 12, c.bassRoot - 12, 0.8); },
      };

      // ---- jumping: a press lifts you over the next beat (at least JUMP_LEAD s); you land on a beat
      const airborne = (t) => t >= S.takeoff && t < S.landT;
      function jump() {
        const t = songTime();
        if (!S.landed || airborne(t) || t < S.nextJump) return;
        S.takeoff = t;
        S.landT = timeAt(Math.ceil(beatAt(t) + song.lead));
        S.landed = false;
        SFX.jump();
      }
      function move(dir) {
        const l = U.clamp(rv.lane + dir, 0, NL - 1);
        if (l !== rv.lane) { rv.lane = l; SFX.lane(l); }
      }
      function steer(dt) {
        const k = api.keys;
        const left = k.has('ArrowLeft') || k.has('KeyA'), right = k.has('ArrowRight') || k.has('KeyD');
        const tapL = api.pressed('ArrowLeft') || api.pressed('KeyA'), tapR = api.pressed('ArrowRight') || api.pressed('KeyD');
        if (tapL || tapR) { const d = tapL ? -1 : 1; move(d); hold.dir = d; hold.t = HOLD_DELAY; }
        else if (left !== right) {
          const d = left ? -1 : 1;
          if (hold.dir !== d) { move(d); hold.dir = d; hold.t = HOLD_DELAY; }
          else { hold.t -= dt; if (hold.t <= 0) { move(d); hold.t = HOLD_REPEAT; } }
        } else hold.dir = 0;
        if (k.has('ArrowUp') || k.has('KeyW') || k.has('Space') || api.pressed('ArrowUp') || api.pressed('KeyW') || api.pressed('Space')) jump();
      }

      const mult = () => {
        const bar = Math.floor(S.bp / 4);
        return (1 + Math.min(3, Math.floor(S.streak / 16))) * (encoreOn(bar) ? 2 : 1) * (nitroOn(bar) ? 2 : 1);
      };
      const addScore = (pts) => { tour.score += pts * mult(); };
      function pop(text, color, big) { pops.push({ text, color, x: rv.x * PX, y: (RV_Y - 34) * PX, t: 0.8, big, rise: true }); }
      function hit(what) {
        S.streak = 0;
        shake = 0.35;
        hurtT = 0.6;
        SFX.hit();
        if (tour.spare) { tour.spare = false; pop('SPARE TIRE!', '#ffd23a', true); return; }
        tour.hp--;
        S.hits++;
        S.groove = Math.max(0, S.groove - 4);
        pop(what, '#ff5a5a', true);
        if (ac) {
          filter.frequency.cancelScheduledValues(ac.currentTime);
          filter.frequency.setTargetAtTime(500, ac.currentTime, 0.02);
          filter.frequency.setTargetAtTime(18000, ac.currentTime + 120 / song.bpm, 0.4);
        }
        if (tour.hp <= 0) wreck();
      }
      function wreck() {
        over = true;
        if (ac) filter.frequency.setTargetAtTime(200, ac.currentTime, 0.3);
        const done = tour.results.length;
        api.after(1.6, () => api.end({
          title: 'WRECKED',
          score: tour.score,
          lines: [
            `Wrecked on “${song.title}” (${song.style.name}) near ${song.town}`,
            `Stops cleared: ${done}${done ? ` · grades ${tour.results.map((r) => r.grade).join(' ')}` : ''}`,
            `Score ${tour.score}`,
          ],
        }));
      }
      // The saucer is shot down: it blows up on the next downbeat and the victory outro plays.
      function bossDown(bar) {
        const v = bar + 1;
        song.victoryBar = v;
        for (const k of [...song.bars.keys()]) if (k >= v) song.bars.delete(k);
        for (const k of [...S.evCache.keys()]) if (k >= v * 16) S.evCache.delete(k);
        for (const e of S.events) if (e.n >= v * 16) e.cancelled = true; // planned past the victory: dropped
        S.events = S.events.filter((e) => e.n < v * 16);
        for (const k of [...S.sounds.keys()]) if (k >= v * 16) S.sounds.delete(k);
        S.genBar = Math.min(S.genBar, v);
        S.boss.dead = true;
        S.boss.boomBeat = v * 4;
        pops.push({ text: 'SAUCER DOWN!', color: '#7dff7a', x: W / 2, y: 150, t: 2.5, big: true });
      }

      function resolve(t) {
        const bar = Math.floor(S.bp / 4);
        const nitro = nitroOn(bar);
        for (const e of S.events) {
          if (e.done) continue;
          const et = timeAt(e.beat);
          const instant = e.type === 'note' || e.type === 'spare' || e.type === 'nitro' || e.type === 'shot';
          if (t < et + (instant ? -0.02 : LATE)) { if (et > t + 1) break; continue; }
          e.done = true;
          const same = rv.lane === e.lane;
          if (e.type === 'note') {
            S.notesTotal++;
            if (same) {
              S.notesGot++; S.streak++; e.got = true; addScore(50); SFX.note(e.m);
              if (++S.groove >= GROOVE_FULL && !encoreOn(bar) && !encoreOn(bar + 1)) {
                S.groove = 0;
                S.encore = { from: bar + 1, to: bar + 1 + ENCORE_BARS };
                pops.push({ text: 'ENCORE!', color: '#ff4fd8', x: W / 2, y: 150, t: 2, big: true });
              }
            }
          } else if (e.type === 'shot') {
            if (same && S.boss && !S.boss.dead) {
              S.boss.hp--; S.boss.hitT = t; S.boss.lasers.push({ x: rv.x, t });
              SFX.zap(); addScore(100); S.streak++;
              if (S.boss.hp <= 0) { bossDown(bar); return; }
            }
          } else if (e.type === 'spare') {
            if (same) { tour.spare = true; e.got = true; SFX.arp(1); pop('SPARE TIRE', '#ffd23a'); }
          } else if (e.type === 'nitro') {
            if (same) { S.nitroSec = e.forSec; e.got = true; SFX.arp(2); pop('NITRO READY', '#5ad1ff'); }
          } else if (e.type === 'land' || e.type === 'crack') {
            if (e.type === 'land' && !same) continue;
            if (nitro || airborne(et) || airborne(et + LATE)) { addScore(20); S.streak++; pop(e.type === 'crack' ? 'CLEARED!' : 'HOP!', '#ffd23a'); }
            else hit(e.type === 'crack' ? 'CRACKED!' : 'TUMBLED!');
          } else if (e.type === 'finish') {
            // the finish line is just for show
          } else if (same) {
            if (nitro) { addScore(30); e.smashed = true; SFX.smash(e.lane); }
            else hit({ boulder: 'ROCKED!', wreck: 'PILE-UP!', police: 'BUSTED!', orb: 'ZAPPED!', beam: 'ABDUCTED!', hay: 'BALED!' }[e.type] || 'OUCH!');
          } else {
            addScore(10); S.streak++;
          }
          if (over) return;
        }
        S.bestStreak = Math.max(S.bestStreak, S.streak);
      }

      function finishSong() {
        S.phase = 'results';
        S.resultsT = 0;
        const pct = S.notesTotal ? S.notesGot / S.notesTotal : 0;
        if (S.boss && !S.boss.dead) S.grade = 'C';
        else S.grade = pct >= 0.95 && S.hits === 0 ? 'S' : pct >= 0.85 && S.hits <= 1 ? 'A' : pct >= 0.7 ? 'B' : 'C';
        tour.results.push({ title: song.title, grade: S.grade });
        tour.score += { S: 2000, A: 1200, B: 600, C: 200 }[S.grade] + (S.boss && S.boss.dead ? 3000 : 0);
        if (sfxOn()) {
          const c = chordOf(endBar() - 1);
          for (let i = 0; i < 7; i++) voice('triangle', hz(c.tones[i % 3] + 12 * (1 + Math.floor(i / 3))), ac.currentTime + i * 0.09, 0.4, 0.06, { echo: true });
        }
      }
      function nextSong() {
        tour.hp = Math.min(3, tour.hp + 1); // the mechanic at the next stop fixes a dent
        startSong();
      }

      function onBeat(b) {
        const bar = Math.floor(b / 4);
        if (bar >= INTRO_BARS && bar < endBar()) addScore(1);
        const sec = sectionOf(bar);
        if (b % 4 === 0 && sec.type !== 'intro' && sec.inSec === 0 && bar < endBar() && sec.type !== 'attack') {
          const label = sec.type === 'solo' ? `${SOLO_NAMES[song.leads.solo.split('+')[0]] || 'GUITAR'} SOLO!` : sec.type === 'pre' ? 'PRE-CHORUS' : sec.type.toUpperCase();
          pops.push({ text: `♪ ${label}${nitroOn(bar) ? ' · NITRO!' : ''}`, color: nitroOn(bar) ? '#5ad1ff' : sec.type === 'solo' ? '#ff4fd8' : '#fff', x: W / 2, y: 130, t: 1.6 });
        }
        if (S.boss && S.boss.dead && b === S.boss.boomBeat) {
          SFX.boom(); shake = 0.6;
          for (let i = 0; i < 40; i++) booms.push({ x: S.boss.x || 100, y: 22, vx: U.rand(-60, 60), vy: U.rand(-40, 50), t: U.rand(0.5, 1.2), c: U.pick(['#7dff7a', '#ffd23a', '#fff', '#5ad1ff']) });
        }
      }

      startSong();

      // ============================================================ drawing
      let buf = null, bx = null;
      const cache = {};
      function sprite(name) {
        if (cache[name]) return cache[name];
        const lit = name.endsWith('Lit');
        const rows = SPRITES[lit ? name.slice(0, -3) : name];
        const c = document.createElement('canvas');
        c.width = rows[0].length; c.height = rows.length;
        const x = c.getContext('2d');
        rows.forEach((row, y) => [...row].forEach((ch, i) => {
          const col = (lit && LIT[ch]) || PAL[ch];
          if (col) { x.fillStyle = col; x.fillRect(i, y, 1, 1); }
        }));
        return (cache[name] = c);
      }
      function spr(name, cx, by, sx = 1, sy = 1, rot = 0) {
        const c = sprite(name);
        const w = Math.max(1, Math.round(c.width * sx)), h = Math.max(1, Math.round(c.height * sy));
        if (!rot) { bx.drawImage(c, Math.round(cx - w / 2), Math.round(by - h), w, h); return; }
        bx.save(); bx.translate(Math.round(cx), Math.round(by - h / 2)); bx.rotate(rot); bx.drawImage(c, -w / 2, -h / 2, w, h); bx.restore();
      }
      const rect = (x, y, w, h, col) => { bx.fillStyle = col; bx.fillRect(Math.round(x), Math.round(y), w, h); };
      function mix(a, b, t) {
        const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
        return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * U.clamp(t, 0, 1)).toString(16).padStart(2, '0')).join('');
      }
      const yOf = (beat, now, speed = 1) => RV_Y + 6 - (beat - now) * song.row * speed;
      // Where the saucer hovers: over the lane of the next shot, gliding there in the beat before it.
      function saucerX(beat) {
        const shots = S.events.filter((e) => e.type === 'shot');
        let prev = null, next = null;
        for (const e of shots) { if (e.beat <= beat) prev = e; else { next = e; break; } }
        const px = LANES[prev ? prev.lane : 1], nx = next ? LANES[next.lane] : px;
        if (!next) return px;
        const f = U.clamp(1 - (next.beat - beat), 0, 1);
        return U.lerp(px, nx, f * f * (3 - 2 * f));
      }

      function drawWorld(beat, env) {
        const frac = beat - Math.floor(beat);
        const scroll = beat * song.row;
        const bar = Math.floor(beat / 4);
        const sec = sectionOf(Math.max(0, bar)).type;
        const enc = encoreOn(bar), nit = nitroOn(bar), boss = song.boss;
        let sand = mix(boss ? '#c9b48c' : '#e2b574', '#f6d290', env.chord * 0.35);
        let road = boss ? '#3b3846' : '#4a3e3c';
        if (enc) road = mix(road, '#6a2b5c', 0.6 + 0.3 * env.note);
        if (nit) road = mix(road, '#2b4a7a', 0.6);
        if (sec === 'solo') road = mix(road, '#5a2b6a', 0.35 + 0.35 * env.note); // stage lights on every solo note
        rect(0, 0, LW, LH, sand);
        for (let y = -2; y < LH; y += 3) {
          const wy = Math.floor(y - scroll);
          for (let k = 0; k < 2; k++) {
            const x = Math.floor(hash(wy * 3 + k) * LW);
            if (x > ROAD_L - 4 && x < ROAD_R + 4) continue;
            rect(x, y + U.wrap(scroll, 3), 1, 1, k ? '#c99456' : '#f0cc8c');
          }
        }
        if (env.hat > 0.15) for (let i = 0; i < 6; i++) { // hi-hats: heat sparkles
          const h1 = hash(env.hatN * 31 + i);
          const x = h1 < 0.5 ? h1 * 2 * (ROAD_L - 6) : ROAD_R + 4 + (h1 - 0.5) * 2 * (LW - ROAD_R - 6);
          rect(x, hash(env.hatN * 17 + i) * LH, 1, 1, `rgba(255,255,230,${env.hat.toFixed(2)})`);
        }
        rect(ROAD_L, 0, ROAD_R - ROAD_L, LH, road);
        for (let y = 0; y < LH; y += 4) {
          const wy = Math.floor((y - scroll) / 4);
          if (hash(wy) < 0.5) rect(ROAD_L + 4 + hash(wy + 99) * (ROAD_R - ROAD_L - 8), y + U.wrap(scroll, 4), 1, 1, mix(road, '#ffffff', 0.08));
        }
        for (let y = -6; y < LH + 6; y += 6) { // rumble strips: white on the snare, orange on the toms
          const yy = y + U.wrap(scroll, 12);
          const alt = Math.floor((y + 600) / 6) % 2 === 0;
          const col = env.tom > 0.45 ? '#ff9a3c' : env.snare > 0.45 ? '#ffffff' : alt ? '#d8372f' : '#f4ead2';
          rect(ROAD_L - 3, yy, 3, 3, col);
          rect(ROAD_R, yy, 3, 3, col);
        }
        rect(ROAD_L, 0, 1, LH, '#e9d8b0');
        rect(ROAD_R - 1, 0, 1, LH, '#e9d8b0');
        rect(ROAD_MID - 2, 0, 1, LH, '#ffcc33'); // double yellow line down the middle
        rect(ROAD_MID + 1, 0, 1, LH, '#ffcc33');

        // THE BRIDGES: every bridge section crosses a canyon river, from its first beat to its last.
        const onB = [];
        song.plan.forEach((t, s) => {
          if (t !== 'bridge') return;
          const bStart = (INTRO_BARS + s * SEC) * 4, bEnd = bStart + SEC * 4;
          const yTop = Math.max(0, Math.floor(yOf(bEnd, beat))), yBot = Math.min(LH, Math.ceil(yOf(bStart, beat)));
          if (yBot <= yTop) return;
          onB.push([yTop, yBot]);
          const deckH = yBot - yTop;
          rect(0, yTop, LW, deckH, '#24507a');
          for (let y = yTop; y < yBot; y += 3) {
            const wy = Math.floor((y - scroll * 0.5) / 3);
            for (let k = 0; k < 3; k++) rect(hash(wy * 5 + k) * LW, y, 3, 1, k ? '#2f6596' : '#3d7ab0');
          }
          if (env.hat > 0.2 || env.note > 0.3) for (let i = 0; i < 8; i++) {
            const h1 = hash(env.hatN * 13 + i);
            rect(h1 < 0.5 ? h1 * 2 * (ROAD_L - 8) : ROAD_R + 6 + (h1 - 0.5) * 2 * (LW - ROAD_R - 8), yTop + hash(env.hatN * 7 + i) * deckH, 1, 1, '#d9f2ff');
          }
          if (yBot < LH) rect(0, yBot - 3, LW, 3, '#8a5a36');
          if (yTop > 0) rect(0, yTop, LW, 3, '#8a5a36');
          rect(ROAD_L - 2, yTop, ROAD_R - ROAD_L + 4, deckH, enc ? '#6a3a4a' : '#5b4636');
          for (let y = yTop - U.wrap(-scroll, 4); y < yBot; y += 4) if (y >= yTop) rect(ROAD_L - 2, y, ROAD_R - ROAD_L + 4, 1, '#4a382b');
          rect(ROAD_MID - 2, yTop, 1, deckH, '#ffcc33');
          rect(ROAD_MID + 1, yTop, 1, deckH, '#ffcc33');
          const railCol = env.snare > 0.45 ? '#ffffff' : '#9aa6b2';
          rect(ROAD_L - 4, yTop, 2, deckH, '#6b7682');
          rect(ROAD_R + 2, yTop, 2, deckH, '#6b7682');
          for (let y = yTop - U.wrap(-scroll, 8); y < yBot; y += 8) if (y >= yTop) { rect(ROAD_L - 5, y, 4, 2, railCol); rect(ROAD_R + 1, y, 4, 2, railCol); }
        });
        const onBridge = (y) => onB.some(([a, b]) => y >= a && y < b);

        const draws = [];
        const PROPS = ['small', 'bush', 'skull', 'rock', 'small', 'sign'];
        for (let k = Math.floor(beat) - 2; k < Math.floor(beat) + 8; k++) {
          const h1 = hash(k * 7 + 3);
          if (h1 > 0.7) continue;
          const left = h1 < 0.35;
          const x = left ? 4 + hash(k * 13 + 1) * (ROAD_L - 12) : ROAD_R + 8 + hash(k * 13 + 1) * (LW - ROAD_R - 12);
          const y = RV_Y - (k - beat) * song.row + hash(k * 5) * song.row;
          const kind = PROPS[Math.floor(hash(k * 11 + 7) * PROPS.length)];
          if (onBridge(y) || onBridge(y - 6)) continue;
          draws.push({ y, f: () => spr(kind, x, y, 1 - 0.12 * env.chord, 1 + 0.3 * env.chord) });
        }
        const sx = boss ? saucerX(beat) : 0, sy = 24 + Math.sin(beat * Math.PI) * 2 - 2 * env.bass;
        if (S.boss) S.boss.x = sx;
        for (const e of S.events) {
          const ahead = e.beat - beat;
          if (ahead > 6.5 || ahead < -1.5 || e.type === 'land' || e.type === 'shot') continue;
          if (e.type === 'police') {
            const y = RV_Y + 6 + (e.beat - beat) * song.row * 3;
            const x = LANES[e.lane];
            if (ahead > 0 && ahead < 2.2) {
              const last = S.sirens.filter((s) => s / 4 <= beat && s / 4 > e.beat - 2.2).pop();
              if (last !== undefined) {
                const on = Math.exp(-(beat - last / 4) * 6).toFixed(2);
                rect(x - 6, LH - 4, 6, 4, `rgba(216,55,47,${on})`);
                rect(x, LH - 4, 6, 4, `rgba(58,123,255,${on})`);
              }
            }
            if (y < LH + 20 && y > -20) draws.push({ y: y + 50, f: () => spr('police', x, y + 8) });
            continue;
          }
          if (e.type === 'orb') {
            // Fired from the saucer two beats out, arriving in its lane on its note.
            if (ahead > 2 || ahead < -0.5) continue;
            const f = U.clamp(1 - ahead / 2, 0, 1.25);
            const x = U.lerp(sx, LANES[e.lane], Math.min(1, f)), y = U.lerp(sy + 4, RV_Y + 6, f);
            draws.push({ y, f: () => { rect(x - 3, y - 1, 6, 2, 'rgba(125,255,122,.25)'); spr('orb', x, y, 1 + 0.4 * env.note, 1 + 0.4 * env.note); } });
            continue;
          }
          if (e.type === 'beam') {
            // Tractor beam: warns for a beat, then the column lights up on the crash.
            if (ahead > 1.2 || ahead < -0.6) continue;
            const x = LANES[e.lane], on = ahead <= 0.05;
            rect(x - 9, 0, 18, LH, on ? 'rgba(125,255,122,.45)' : `rgba(125,255,122,${(0.12 + 0.1 * (frac < 0.5)).toFixed(2)})`);
            if (on) rect(x - 2, 0, 4, LH, 'rgba(230,255,230,.6)');
            continue;
          }
          const y = yOf(e.beat, beat, e.type === 'boulder' ? 2 : 1);
          if (y < -6 || y > LH + 24) continue;
          const x = e.lane >= 0 ? LANES[e.lane] : 0;
          const lit = beat >= e.beat && beat < e.beat + 0.35;
          if (e.type === 'cactus') draws.push({ y, f: () => spr(lit ? 'cactusLit' : 'cactus', x, y, 1 - 0.08 * env.note, 1 + 0.18 * env.note) });
          else if (e.type === 'hay') draws.push({ y, f: () => spr(lit ? 'hayLit' : 'hay', x, y, 1 + 0.1 * env.chord, 1 - 0.12 * env.chord) }); // bales thump on the chords
          else if (e.type === 'boulder') {
            const hop = Math.abs(Math.sin(beat * Math.PI * 2)) * 3 + 2 * env.tom;
            draws.push({ y, f: () => { rect(x - 4, y - 2, 9, 2, 'rgba(0,0,0,.25)'); spr(Math.floor(beat * 4) % 2 ? 'boulder1' : 'boulder2', x, y - hop); } });
          } else if (e.type === 'wreck') {
            draws.push({ y, f: () => {
              spr('sedan', x, y, 1, 1, e.lane % 2 ? 0.5 : -0.4);
              const puff = (beat * 2 + e.lane) % 1;
              rect(x - 2 + puff * 4, y - 12 - puff * 8, 3, 3, `rgba(80,80,80,${(0.6 - puff * 0.5).toFixed(2)})`);
            } });
          } else if (e.type === 'crack') {
            // The bridge's planks snap: they split in the beat before, then open onto the river.
            const open = U.clamp(1 - ahead, 0, 1), deck = onBridge(y);
            draws.push({ y: y - 50, f: () => {
              for (let xx = ROAD_L + 1; xx < ROAD_R - 1; xx += 2) {
                const j = deck ? 0 : Math.round((hash(xx * 7 + e.n) - 0.5) * 3);
                const col = deck ? (open > 0.9 ? '#24507a' : '#3a2a20') : open > 0.9 ? '#1e1410' : '#2a1f1a';
                rect(xx, y - 4 + j, 2, 1 + Math.round(open * 5), col);
              }
              if (deck && open > 0.9) for (let xx = ROAD_L + 3; xx < ROAD_R - 3; xx += 9) rect(xx, y - 6 + (xx % 3), 3, 2, '#6b5240');
            } });
          } else if (e.type === 'note' && !e.got) {
            draws.push({ y, f: () => spr('note', x, y - 2 - 3 * env.note, 1 + 0.2 * env.note, 1 + 0.2 * env.note) });
          } else if (e.type === 'spare' && !e.got) draws.push({ y, f: () => spr('spare', x, y - 2 * env.kick) });
          else if (e.type === 'nitro' && !e.got) draws.push({ y, f: () => spr('nitro', x, y - 2 * env.kick) });
          else if (e.type === 'finish') {
            draws.push({ y: y - 60, f: () => { for (let xx = ROAD_L; xx < ROAD_R; xx += 4) for (let r = 0; r < 2; r++) rect(xx, y - 6 + r * 3, 4, 3, ((xx - ROAD_L) / 4 + r) % 2 ? '#111' : '#fff'); } });
          }
        }
        for (const e of S.events) {
          if (e.type !== 'boulder' || e.done) continue;
          const ahead = e.beat - beat;
          if (ahead > 2.1 && ahead < 4.5 && frac < 0.5) spr('warn', LANES[e.lane], 10);
        }
        for (const tw of S.tumbles) {
          const rel = beat - tw.b0;
          if (rel > -2 && rel < 0) { if (frac < 0.5) spr('warn', tw.dir > 0 ? 8 : LW - 8, RV_Y + 6); continue; }
          if (rel < 0 || rel >= NL + 1) continue;
          const xs = [tw.dir > 0 ? ROAD_L - 20 : ROAD_R + 20, ...(tw.dir > 0 ? LANES : [...LANES].reverse()), tw.dir > 0 ? ROAD_R + 20 : ROAD_L - 20];
          const k = Math.floor(rel), f = rel - k;
          const x = U.lerp(xs[k], xs[k + 1], f);
          const hop = Math.sin(f * Math.PI) * 16;
          const y = RV_Y + 12;
          draws.push({ y: y + 1, f: () => { rect(x - 3, y - 1, 7, 2, 'rgba(0,0,0,.25)'); spr(Math.floor(beat * 4) % 2 ? 'tumble1' : 'tumble2', x, y - hop); } });
        }
        const t = songTime();
        const jp = airborne(t) ? (t - S.takeoff) / (S.landT - S.takeoff) : 0;
        const js = 1 + 0.3 * Math.sin(Math.PI * jp);
        const bob = env.bass > 0.5 ? -1 : 0;
        draws.push({ y: RV_Y + 14, f: () => {
          if (jp) rect(rv.x - 6, RV_Y + 8, 13, 4, 'rgba(0,0,0,.25)');
          if (hurtT > 0 && Math.floor(hurtT * 16) % 2) return;
          spr('rv', rv.x, RV_Y + 14 + bob - Math.sin(Math.PI * jp) * 6, js, js);
          if (env.bass > 0.3) { rect(rv.x - 4, RV_Y + 12 + bob, 2, 1, '#ff8080'); rect(rv.x + 3, RV_Y + 12 + bob, 2, 1, '#ff8080'); }
          if (tour.spare) rect(rv.x - 9, RV_Y + 10, 2, 2, '#ffd23a');
        } });
        draws.sort((a, b) => a.y - b.y).forEach((d) => d.f());
        // The saucer: always in front of you at the top, gliding between lanes on the beat.
        if (boss && S.boss && !(S.boss.dead && beat >= S.boss.boomBeat)) {
          const hitFlash = songTime() - S.boss.hitT < 0.12;
          spr(hitFlash ? 'orb' : 'saucer', sx, sy + 9, hitFlash ? 5 : 1, hitFlash ? 2.2 : 1);
          if (env.kick > 0.5) rect(sx - 1, sy + 9, 3, 2, '#ffd23a');
        }
        if (S.boss) for (const l of S.boss.lasers) { // the RV's auto-shots
          const age = songTime() - l.t;
          if (age < 0.15) { rect(l.x - 1, sy + 10, 2, RV_Y - sy - 10, `rgba(255,120,220,${(1 - age / 0.15).toFixed(2)})`); rect(l.x, sy + 10, 1, RV_Y - sy - 10, '#ffffff'); }
        }
        for (const d of dust) rect(d.x, d.y, 1, 1, `rgba(210,170,110,${Math.min(1, d.t * 2)})`);
        for (const p of booms) rect(p.x, p.y, 2, 2, p.c);
      }

      function drawResults(ctx) {
        ctx.fillStyle = 'rgba(10,6,20,.82)';
        ctx.fillRect(0, 0, W, H);
        const bossTxt = S.boss ? (S.boss.dead ? 'SAUCER DOWN!' : 'IT GOT AWAY...') : 'SONG COMPLETE';
        Draw.text(ctx, `STOP ${song.k} · ${song.town.toUpperCase()}`, W / 2, 120, 12, '#ffd23a', 'center');
        Draw.text(ctx, bossTxt, W / 2, 165, 20, '#fff', 'center');
        Draw.text(ctx, `“${song.title}” · ${song.style.name} in ${song.keyName} ${song.mode}`, W / 2, 200, 10, 'rgba(255,255,255,.8)', 'center');
        Draw.text(ctx, S.grade, W / 2, 310, 80, { S: '#ff4fd8', A: '#7dff7a', B: '#4ff3ff', C: '#ffd23a' }[S.grade], 'center');
        Draw.text(ctx, `NOTES ${S.notesGot}/${S.notesTotal}   DENTS ${S.hits}   BEST STREAK ${S.bestStreak}`, W / 2, 360, 11, '#fff', 'center');
        const nk = song.k + 1;
        Draw.text(ctx, nk % BOSS_EVERY === 0 ? `NEXT STOP: AREA 51 · ${songBpm(nk)} BPM · BOSS!` : `NEXT STOP: ${TOWNS[(nk - 1) % TOWNS.length].replace('Area 51', 'Rachel').toUpperCase()} · ${songBpm(nk)} BPM`, W / 2, 430, 11, nk % BOSS_EVERY === 0 ? '#7dff7a' : '#ffd23a', 'center');
        if (S.resultsT > 1.5) Draw.text(ctx, 'PRESS SPACE TO DRIVE ON', W / 2, 470, 10, Math.floor(S.resultsT * 2) % 2 ? '#fff' : 'rgba(255,255,255,.5)', 'center');
      }

      // ============================================================ the instance
      return {
        // A read-only view for tools/sim.js and the tests.
        __debug: () => ({ events: S.events, bp: S.bp, rv, hp: tour.hp, song, S, tour, routeLane, stepEvents, airborne, songTime, beatAt, timeAt, endBar, stepBeat }),
        setPaused(p) { if (ac) { if (p) ac.suspend(); else ac.resume(); } },
        destroy() { if (ac) { try { ac.close(); } catch (e) { /* */ } } },
        update(dt) {
          simT += dt;
          if (ac) {
            if (ac.state === 'running' && ac.currentTime === lastAc) stuck += dt; else stuck = 0;
            lastAc = ac.currentTime;
            if (stuck > 1.5) {
              const keep = songTime();
              try { ac.close(); } catch (e) { /* */ }
              ac = null;
              S.simStart = simT - keep;
            } else {
              master.gain.setTargetAtTime(Cabinet.isMuted() || over ? 0.0001 : 0.85, ac.currentTime, over ? 0.4 : 0.05);
              if (S.bp < INTRO_BARS * 4 && song.k === 1) lat = ac.outputLatency || ac.baseLatency || 0;
            }
          }
          if (over) return;
          if (S.phase === 'results') {
            S.resultsT += dt;
            if (S.resultsT > 7 || (S.resultsT > 1.5 && (api.pressed('Space') || api.pressed('Enter') || api.pressed('ArrowUp')))) nextSong();
            return;
          }
          const t = songTime();
          S.bp = beatAt(t);
          const bar = Math.floor(Math.max(0, S.bp) / 4);
          while (S.genBar < Math.min(bar + 4, endBar())) chartBar(S.genBar++);
          schedule();
          for (let b = S.lastBeat + 1; b <= Math.floor(S.bp); b++) if (b >= 0) onBeat(b);
          S.lastBeat = Math.max(S.lastBeat, Math.floor(S.bp));
          // Touch-down first (always exactly on a beat), so a held jump can't relaunch mid-air.
          if (!S.landed && t >= S.landT) {
            S.landed = true;
            S.nextJump = S.landT + timeAt(0.25);
            SFX.land();
            for (let i = 0; i < 6; i++) dust.push({ x: rv.x + U.rand(-6, 6), y: RV_Y + 13, vx: U.rand(-20, 20), vy: U.rand(-5, 15), t: 0.5 });
          }
          steer(dt);
          rv.x += U.clamp(LANES[rv.lane] - rv.x, -420 * dt, 420 * dt);
          shake = Math.max(0, shake - dt);
          hurtT = Math.max(0, hurtT - dt);
          for (const arr of [dust, booms]) {
            for (const d of arr) { d.x += d.vx * dt; d.y += d.vy * dt; d.t -= dt; }
            for (let i = arr.length - 1; i >= 0; i--) if (arr[i].t <= 0) arr.splice(i, 1);
          }
          for (const p of pops) { p.t -= dt; if (p.rise) p.y -= 40 * dt; }
          for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t <= 0) pops.splice(i, 1);
          while (S.tumbles.length && S.bp - S.tumbles[0].b0 > NL + 2) S.tumbles.shift();
          if (S.boss) S.boss.lasers = S.boss.lasers.filter((l) => t - l.t < 0.3);
          resolve(t);
          while (S.events.length && S.events[0].done && timeAt(S.events[0].beat) < t - 3) S.events.shift();
          if (!over && S.bp >= endBar() * 4 + 1) finishSong();
        },
        draw(ctx) {
          if (typeof document === 'undefined') return;
          if (!buf) {
            buf = document.createElement('canvas');
            buf.width = LW; buf.height = LH;
            bx = buf.getContext('2d');
          }
          const now = songTime();
          const beat = beatAt(now);
          const env = envelopes(now);
          bx.imageSmoothingEnabled = false;
          drawWorld(beat, env);
          ctx.imageSmoothingEnabled = false;
          const ox = shake > 0 ? U.randi(-2, 2) * PX : 0;
          const oy = (shake > 0 ? U.randi(-2, 2) * PX : 0) + (env.kick > 0.6 ? PX : 0); // the road thumps on the kick
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(buf, ox, oy, W, H);
          if (env.crash > 0.02) { ctx.fillStyle = `rgba(255,244,214,${(env.crash * 0.35).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }

          const bar = Math.floor(beat / 4);
          const sec = sectionOf(Math.max(0, bar));
          const frac = beat - Math.floor(beat);
          const secName = sec.type === 'attack' ? 'AREA 51' : sec.type === 'pre' ? 'PRE-CHORUS' : sec.type.toUpperCase();
          Draw.hud(ctx, `SCORE ${tour.score}`, `♪ ${song.title}${sec.type !== 'intro' ? ' · ' + secName : ''}`, `RV ${Draw.hearts(U.clamp(tour.hp, 0, 3))}${tour.spare ? ' +TIRE' : ''}`);
          ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(0, 26, W, 3);
          ctx.fillStyle = '#ffd23a'; ctx.fillRect(0, 26, W * U.clamp(beat / (endBar() * 4), 0, 1), 3);
          Draw.text(ctx, `STOP ${song.k} · ${song.town.toUpperCase()} · ${song.bpm} BPM`, 10, 46, 9, 'rgba(255,255,255,.75)');
          Draw.text(ctx, `NOTES ${S.notesGot}/${S.notesTotal}`, W - 10, 46, 9, 'rgba(255,255,255,.75)', 'right');
          if (S.boss && !S.boss.dead) { // the saucer's health
            Draw.text(ctx, 'SAUCER', W / 2 - 120, 64, 9, '#7dff7a', 'right');
            Draw.meter(ctx, W / 2 - 110, 56, 220, 8, S.boss.hp / S.boss.max, '#7dff7a');
          }
          Draw.text(ctx, encoreOn(bar) ? 'ENCORE!' : 'GROOVE', 10, H - 30, 9, encoreOn(bar) ? (frac < 0.5 ? '#ff4fd8' : '#ffd23a') : '#fff');
          Draw.meter(ctx, 10, H - 24, 150, 8, encoreOn(bar) ? 1 : S.groove / GROOVE_FULL, encoreOn(bar) ? '#ff4fd8' : '#7dff7a');
          if (S.nitroSec >= 0 && sectionOf(Math.max(INTRO_BARS, bar)).s <= S.nitroSec) Draw.text(ctx, nitroOn(bar) ? 'NITRO!' : 'NITRO READY', W - 10, H - 20, 10, '#5ad1ff', 'right');
          if (S.streak >= 8) Draw.text(ctx, `STREAK ${S.streak}  x${mult()}`, W / 2, H - 20, 9, '#fff', 'center');
          if (beat < INTRO_BARS * 4 && S.phase === 'play') {
            const b = Math.floor(beat);
            Draw.text(ctx, song.boss ? `STOP ${song.k}: AREA 51 · BOSS` : `STOP ${song.k}: ${song.town.toUpperCase()}`, W / 2, H / 2 - 130, 11, song.boss ? '#7dff7a' : '#ffd23a', 'center');
            Draw.text(ctx, 'NOW PLAYING', W / 2, H / 2 - 104, 10, 'rgba(255,255,255,.8)', 'center');
            Draw.text(ctx, `“${song.title}”`, W / 2, H / 2 - 78, 16, '#fff', 'center');
            Draw.text(ctx, `${song.style.name} · ${song.keyName} ${song.mode} · ${song.bpm} BPM`, W / 2, H / 2 - 56, 9, 'rgba(255,255,255,.8)', 'center');
            Draw.text(ctx, b < 4 ? 'READY?' : ['4', '3', '2', '1'][b - 4], W / 2, H / 2 + 2, 34 + 10 * Math.exp(-frac * 5), '#ffd23a', 'center');
            Draw.text(ctx, song.boss ? 'STAY ON THE ROUTE UNDER THE SAUCER: YOU FIRE ON THE BEAT' : 'FOLLOW THE NOTES · ← → SLIDE · ↑ JUMP', W / 2, H / 2 + 40, 10, '#fff', 'center');
          } else if (beat < INTRO_BARS * 4 + 2) {
            Draw.text(ctx, 'GO!', W / 2, H / 2 - 20, 40, '#7dff7a', 'center');
          }
          for (const p of pops) {
            ctx.globalAlpha = Math.min(1, p.t * 2.5);
            Draw.text(ctx, p.text, p.x, p.y, p.big ? 16 : 11, p.color, 'center');
          }
          ctx.globalAlpha = 1;
          if (S.phase === 'results') drawResults(ctx);
        },
      };
    },
  });
})();
