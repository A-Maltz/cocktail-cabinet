# Cocktail Cabinet

Seven arcade games on one static page. In every game a human or the computer can take either side.

| # | Game | Classic (you play…) | Flipped (you play…) |
|---|------|--------------------|---------------------|
| 1 | Snake | the snake; the computer places apples | the apple placer; the computer steers |
| 2 | Breakout | the paddle; the computer runs the wall's guard | the guard; the computer plays the paddle |
| 3 | Splat | the bird; the computer builds the columns | the builder; the computer flies |
| 4 | Asteroids | the ship; the computer sends asteroids | the sender; the computer flies the ship |
| 5 | Missile Command | the defender; the computer attacks | the attacker; the computer defends |
| 6 | Space Invaders (our pick) | the cannon; the computer commands the fleet's fire | the fleet commander; the computer is the cannon |
| 7 | Imitation | the judge (human or AI?) | the imitator: convince them *you* are the AI |

Every canvas game also has a **Watch** mode where the computer plays both sides.

**Bonus, game 8: RocknRoller** (original, single-player for now; code in `js/games/rocknroll.js`). A tour of the Nevada desert in an RV. Every stop is a brand-new song of about a minute, generated in the browser by an algorithm (not an AI model).

**The core rule: if it's on screen it's on the beat, and every note is an element.**

- **Variety:** each song picks a style, never the same one twice in a row:

  | Style | Sound |
  |---|---|
  | Spaghetti Gallop | the original desert sound |
  | Surf Rocket | surf beat, tremolo-picked guitar |
  | Desert Boogie | swung shuffle, walking bass, harmonica |
  | Neon Motorik | four-on-the-floor, synth arpeggios |
  | Ghost Town Doom | half-time fuzz |
  | Train Beat | country boom-chick, chicken-pickin' lead |

  Each style has its own scale, progressions, drums, bass and chord instruments. Key, structure and melody rhythms are random on top, and each section picks a lead instrument from the style's palette (often doubled an octave up in the chorus). Swung styles swing the obstacles too.
- **Instruments:** guitar, surf guitar, trumpet, pedal steel, harmonica, electric piano, synth, chiptune, fuzz guitar, banjo, fiddle, marimba, combo organ, whistle and theremin.
- **How it's synthesized:**
  - plucked strings use Karplus-Strong synthesis (a burst of noise in a short feedback loop, like a vibrating string)
  - cymbals are 808-style metallic square-wave clusters
  - synths use detuned layers with filter sweeps
  - the mix has a generated reverb room, an echo, stereo placement and a compressor
- **Longer songs** get a solo before the last chorus (a note-rain section on the route) and a pre-chorus with a snare-roll build.
- **Fast songs stay musical:** above 180 BPM melodies are written in half time, and above about 200 BPM the band plays on an 8th-note grid.
- **Speed:** +16 BPM a stop, 100 → 240. Faster songs get more sections, so each still lasts about a minute. Every human limit is measured in seconds, so the game stays fair as it speeds up: lane-change spacing (≥ 0.36 s), slide window (0.3 s), clear space around the route (0.1 s) and jump lead time (0.33 s).
- **The pressure rises every stop:**
  - each stop has an obstacle target: about 1.3/s at stop 1, +0.3/s per stop, up to 4.5/s (jump obstacles count too)
  - the route must change lanes at least every 2.6 s at stop 1, tightening to every 0.8 s
  - where the melody is too sparse to supply that, the rhythm section does: hay bales land on chord hits, then bass notes, then kick and snare hits
  - measured over full tours: about 1.3 → 2.8 → 3.4 → 4.4 obstacles/s at stops 1 → 4 → 8 → 12+
- **One source of truth:** `stepEvents(n)` says what the band plays on every 16th note. The audio, the visuals and the obstacle charting all read from it.
- **A planned route:** it follows the melody across 4 lanes and isn't drawn. The note pickups sit on it and the cacti push you along it. Nothing harmful is ever placed on it.
- **Every instrument has a job:**

  | Sound | On screen |
  |---|---|
  | Crash cymbal | car wreck |
  | Tom fill | boulders |
  | Shaker | tumbleweeds (choruses only) |
  | Bridge sub-drop and snare | the bridge's planks cracking (jump) |
  | Siren | police from behind |
  | Kick / snare / hats / bass / chords / melody | road thump, rumble strips, sparkles, suspension, swaying props, cacti |

  A double yellow line runs down the middle of the road.
- **The bridge section is a real bridge** over a canyon river. Its jumps are spaced so your last jump has always landed before the next crack: every 2 beats, or every 4 at high tempo.
- **Bosses:** every 5th stop is Area 51.
  - A flying saucer hovers at the top, gliding between lanes on the beat, with a theremin theme.
  - Its plasma orbs are the melody notes; its tractor beams land on the crash.
  - Following the route dodges everything and lines you up under it. On the kick (beats 1 and 3) the RV fires automatically if you're lined up.
  - Shoot it down and it explodes on the next downbeat.
- **Jumps** always land exactly on a beat.
- **Every sound effect is in key.**
- **Rewards:**
  - Groove meter → ENCORE: a guitar solo and double points
  - spare tire: a one-hit shield
  - nitro: an untouchable chorus with double points (no key change)

## Addresses

Each game has its own page: `/snake`, `/breakout`, `/splat`, `/asteroids`, `/missile-command`, `/invaders`, `/imitation`, `/rocknroller`. (The engine also supports `hidden: true` on a game: no menu card, but its address still works.) Netlify serves `index.html` for every path that isn't a real file (`netlify.toml`), and `route()` in `js/cabinet.js` opens the right game. To serve locally with the same behaviour you need a server that falls back to `index.html`; with `python -m http.server`, only `/` works.

## Running it

It's plain HTML/CSS/JS with no build step. Open `index.html`, or serve the folder:

```
python -m http.server 8000
```

Netlify publishes the repository root (`netlify.toml`) on every push to `master`.

## How it fits together

- `js/cabinet.js` is the shared engine: game registry, menus, a fixed 60 Hz update loop, mouse/touch → 800×600 game coordinates, pause and game-over overlays, sound, best scores (localStorage), and `Rounds`.
- `Rounds` handles scoring whenever you play the *other* side. Each round the computer has a goal (eat 12 apples, clear 12 columns, survive 45 s…). Stop it and you win the round, and the next round's computer is one level smarter. If it succeeds you lose a heart and replay the same level. That gives a ramp that starts easy and corrects itself.
- `js/games/*.js` holds one file per game. Each calls `Cabinet.register({...create(api)})` and returns `update(dt)`, `draw(ctx)` and input handlers.

## How the computer plays (and why it's fair)

The computer only uses the same controls and physics as a human on that side, and only sees what's on screen. Difficulty comes from reaction delay, aiming error and how far ahead it plans. Those numbers live in a `…Skill(level)` table near the top of each game.

- **Snake**: BFS to the apple. Before committing, it simulates eating and checks it can still reach its tail. Low levels skip that safety check. You win by building traps with its own body; flipped uses a smaller board and 3 segments per apple. The computer apple placer prefers hard spots but never a guaranteed death trap.
- **Breakout**: the paddle predicts the landing point including wall bounces, but misreads each wall bounce a little. The guard's top speed is always below the ball's sideways speed, and it tires with each block in a row, so rallies can't stall.
- **Splat**: the bird's only action is "flap". It bobs around the gap centre and, from level 2, simulates "flap now" against "wait" over the next 0.8 s. Gaps can only move 200 px (computer builder) or 265 px (human builder) per column.
- **Asteroids**: the ship computes each rock's closest approach. It dodges threats it notices and otherwise leads its shots at the nearest rock. Rock launches must start 170 px from the ship.
- **Missile Command**: the defender reacts after a delay, solves the intercept point (lead from level 2), and adds aim error. It has 8 shots per battery against your 10.
- **Space Invaders**: the cannon works out where every bomb it has noticed will land and when. It stands in the reachable spot nearest its aim that no bomb will hit.
- **Imitation**: chat is turn-based like humanornot.io: players alternate one message at a time, each with a 20-second limit, 4 messages each. The computer partner is **not a language model**. It's a rule-based chatbot (regex intents plus canned replies) with a random persona. It "reads" and "types" at a human pace and always answers inside the limit, so reply speed doesn't give it away. As levels rise it drops capitals and full stops and adds slang and typos. As judge, it scores your messages for machine-like features (formality, no slang, long answers, assistant phrases, instant maths, typing speed), and its threshold rises with each level. Pasting is blocked.

## Two browsers (Imitation)

Imitation uses [PeerJS](https://peerjs.com/) (WebRTC). PeerJS's free public broker only introduces the two browsers; after that, messages go browser to browser. There's no server of ours and no API key. Matchmaking uses six well-known "lobby slot" peer IDs: join someone already waiting, otherwise wait in a free slot. A search always lasts several seconds. If nobody turns up before a random 7–15 s deadline, you're matched with the computer, so the wait gives nothing away.

## Testing

`tools/sim.js` runs any game headless in Node with the real game code and a stub canvas:

```
node tools/sim.js splat flipped 900 swing     # stand-in human: big up/down gap swings
node tools/sim.js missile demo 600            # computer vs computer
```

Scripted stand-in humans live in `tools/policies.js`. These runs were used to tune each `…Skill(level)` table so that doing nothing loses, simple strategies win a few rounds, and good strategies go further.
