# Delegation log

*Draft written by Claude from the build session. Add your own verification notes (manual play-testing, deploy checks) before submitting.*

| # | What I asked Claude | What it produced | How it was verified |
|---|---------------------|------------------|---------------------|
| 1 | Build the whole cabinet from the assignment brief. Before starting, Claude asked me four design questions: what Imitation is (Turing-test chat), the 7th game (Space Invaders), how two browsers connect (PeerJS/WebRTC), and the Missile Command flip (I attack, the computer defends). | `index.html`, `css/style.css`, a shared engine (`js/cabinet.js`) and seven game files, each with classic, flipped and watch modes | `node --check` on every file. Each game opened in every mode in headless Chrome (puppeteer), with screenshots and zero console errors. |
| 2 | Make every computer player actually play: no scripted wins | AIs that use only the human controls (BFS snake, predictive paddle, flap-only bird with look-ahead, threat-dodging ship, intercept-solving defender, bomb-dodging cannon, rule-based chatbot and judge) | Read the code: each AI calls the same physics and collision functions as the human side. |
| 3 | Make each side start easy and get gradually harder, never impossible | Per-level skill tables plus the `Rounds` system (win a round, the computer levels up; lose, you lose a heart) | `tools/sim.js` ran every game for 5–25 simulated minutes against scripted stand-in humans (idle, random, smart). This found and fixed real problems: the Splat bird crashed on flat courses (flap rule off-centre), the Breakout paddle lost to an idle guard, rallies could stall (added guard fatigue), the Snake placer couldn't win even level 1 (smaller board, faster growth), Missile Command waves were unwinnable (more missiles, cheaper MIRVs), and the Imitation judge plateaued (rising threshold, no paste). |
| 4 | Two browsers can play Imitation; matchmaking must not be instant or reveal the AI | PeerJS lobby-slot matchmaking, a random 7–15 s search with the computer as fallback, chat, verdict exchange, reveal | Three headless Chrome profiles: two matched each other over the real PeerJS broker in ~8 s and exchanged messages and verdicts. The third, searching alone, got the computer. Both reveals were correct. |
| 5 | A bug found in browser testing: the overlay never hid | Added `[hidden] { display: none !important; }` | Re-ran the screenshots: overlays gone, games visible. |
| 6 | Asked what Imitation uses for its AI. Then asked for humanornot.io-style turns with a time limit per message, because an AI that replies instantly is obvious | Claude explained it's a rule-based chatbot, not an LLM. It rewrote the chat as a turn engine: alternate messages, 20 s each, 4 each, random first player. In two-browser matches the host decides who starts once the guest is ready, and early messages are buffered. The computer reads and types at a human pace within the limit and occasionally lets the clock run out. If time runs out, your draft is sent or the turn is skipped. | Three headless Chrome profiles played full rounds. A vs B turns alternated and mirrored on both screens. B deliberately timed out once; A saw "Stranger ran out of time". C vs the computer: all replies arrived inside the limit. Both reveals were correct. |
| 7 | Check the build against every requirement in the brief | A requirement-by-requirement audit (below) | Each item checked against the code and the test runs above. |
| 8 | Static site on Netlify | `netlify.toml` (no build, publish the repo root), README | *(Add: custom domain connected, HTTPS on, push → auto-deploy confirmed, site loads in a private window.)* |

## Requirements audit

| Requirement | Status | Evidence |
|---|---|---|
| Seven games: Snake, Breakout, Splat, Asteroids, Missile Command, Imitation, one of your choice | Done | `js/games/*.js`; the 7th is Space Invaders |
| Every game plays in both directions | Done | Every game has a `flipped` mode; canvas games also have a CPU-vs-CPU watch mode |
| Snake flip: human places apples, computer steers | Done | Click to drop apples; BFS snake AI |
| Breakout flip: computer plays against the human | Done | Human runs the wall's guard, computer plays the paddle (and the reverse) |
| Splat flip: human lays out columns, computer gets through without cheating | Done | The bird only flaps, with the same physics and collision code |
| Asteroids flip: computer flies, human sends asteroids | Done | Drag to fling rocks; ship AI dodges and shoots |
| Missile Command and your game: design the flip | Done | MC: human attacks, CPU defends. Invaders: human commands fleet fire, CPU is the cannon |
| Imitation: play the AI, or another human in a second browser | Done | Judge mode and "play the AI" mode; PeerJS match tested with two real browsers |
| Matchmaking not instant; AI opponent not obvious | Done | Search always takes 4–15 s; the computer fills in after a random deadline; turn-based chat with human-paced replies |
| Fun and fair on both sides; starts easy, gets harder; computer really plays | Done; needs your own play-testing | Per-level skill tables plus the `Rounds` ramp; tuned with `tools/sim.js` against scripted players |
| Static site only, nothing on a server | Done | Plain HTML/CSS/JS, no build. External: Google Fonts, PeerJS script (unpkg), and PeerJS's free public broker for the browser handshake (a third-party service, not ours) |
| No API keys | Done | No keys, no `fetch`, no Anthropic calls in the site |
| "The AI runs through Claude in your own browser" | Check with instructor | Read as: you build with Claude in your browser/editor, not via an API. The in-game AIs are hand-written algorithms. If it means Imitation's opponent must be Claude itself, that's impossible without an API key, so ask. |
| Own domain on Netlify, continuous deployment | Not done (your step) | `netlify.toml` ready; connect the GitHub repo, add the custom domain, check it loads signed out |
| Talk on Slack | Not done (your step) | |
| Delegation log | Draft | This file; add your own verification notes |

## My own verification

*(Add notes from playing each game on both sides yourself.)*
