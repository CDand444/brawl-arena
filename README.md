# Brawl Arena

Browser fighting game for a friend group, Mortal Kombat 3 style controls. 2.5D (3D bodies, real-photo 2D heads, side view). Desktop + phone + gamepad.
Live: https://cdand444.github.io/brawl-arena/

**Modes:** **Smash** (up to 4, free-for-all, see below), Arcade (fight all the other characters in a row, difficulty ramps), 1 Player vs CPU (3 difficulties), 2 Players on one keyboard (or two gamepads),
Online (live lobby list or 5-letter code). Best of 3 rounds, 120 s each.

**Gamepad:** X/Y punches, A/B kicks, RB block, LT run, LB grab/throw, RT special, stick click ultimate, Start pause. Pad 1 = P1, pad 2 = P2.

## Run it
It must be served over http (modules + fetch don't work from `file://`). Double-click `serve.bat`, then open http://localhost:8000.
To play on a phone, use the PC's LAN address, e.g. `http://192.168.x.x:8000` (same Wi-Fi), or deploy the folder to any static host
(GitHub Pages, Netlify, Cloudflare Pages). No build step.

## Controls (MK3 layout: HP, HK, LP, LK, Block, Run)
| | P1 | P2 |
|---|---|---|
| Move / jump / crouch | W A D / S | arrow keys |
| Low punch / High punch | F / G | U / I (numpad 4 / 5) |
| Low kick / High kick | C / V | J / K (numpad 1 / 2) |
| Block / Run | Left Shift / X | L / O (numpad 0 / 3) |

Moves: down+HP uppercut, down+LK sweep, jump + attack, fireball = down, down-forward, forward + punch.
Phone: on-screen pad and buttons (1 Player mode). Esc pauses.

## Adding a character (the pipeline)
1. Give Claude one or more photos and a name. Claude writes `characters/<id>.json`
   (look: skin, hair, outfit colors, hat, accessories, build; fight: speed/power/health, special name+color).
2. Add `"<id>"` to `characters/index.json`.
3. Reload. The new fighter shows up in the select screen. No code changes.

Open `viewer.html` to preview/tweak a character live (edit the JSON, pick a pose).

### Character JSON fields
`name, tagline, skin, hair{style: long|short|updo|locs, color}, beard, eyes, top, stripe, pattern[], overshirt, jacket,
sleeves(long|short|none), bottom, shoes, boots, gown, build (0.9 slim .. 1.35 big), hat{type: beanie|fedora|cap, color, studs},
extras[nosering|necklace|choker|glasses|watch], stats{speed,power,health ~0.85-1.2}, special{name,color}`. Colors are "#rrggbb".

## Code map
`src/model.js` builds the 3D model and poses · `src/fighter.js` moves + combat · `src/ai.js` CPU · `src/input.js` keyboard/touch · `src/game.js` stage, UI, rounds.

## Fighting feel
Double jump (tap jump again in the air), 7-tick input buffer, chain cancels (a connecting light attack can cancel into a different normal or special, max 3),
smooth walk acceleration, air steering + fast-fall (hold down), impact freeze-frames (hitstop), and attacker pushback when the opponent is cornered.

## Smash mode (up to 4 players)
Free-for-all on a floating stage with 3 platforms (`src/smash.js`). No health bars: **damage %** climbs with each hit and the higher it is the farther you fly;
get knocked past the edge of the screen (blast zone) and you lose a **life**. Last one with lives wins. Lives 1-9, stage picker.
- Jump up through floating platforms, **tap down** to drop through. **Up + SPECIAL in the air** = one recovery boost per airtime (plus your double jump).
- Slots: Keyboard 1 (WASD keys), Keyboard 2 (arrow keys), Gamepads 1-4, Touch, CPU (Easy/Normal/Hard) or Off. Each fighter gets a P1-P4 tag over their head.
- **Online:** Online -> HOST SMASH ROOM. Friends tap it in the live list (or type the 6-letter code). Each player picks a fighter; the host fills empty slots with CPUs, picks lives and stage, and starts.
  Star network through the host, deterministic lockstep for all 4 (CPU fighters use a seeded RNG so they act the same everywhere), 6-tick input delay.
- Launch strength: `K = (0.045 + dmg*0.003 + pct*(dmg+6)*0.00011) / weight` (weight = health stat); angles are fixed constants (no runtime trig, for sync).

## Arena, props and health
Arena is wide (bounds +/-9) with glowing edge posts; every fighter has double health (200 x the character's health stat); rounds last 120 s.
**Props** (rebuilt each round, deterministic via the seeded RNG): crates (smash them, often drop an item) and explosive barrels (blast = 24 damage + knockdown to anyone close, chain-reacts).
They are solid: walk around or jump over. **Throwables** (brick 16, bottle 12 and shatters, bowling ball 20 + knockdown): `Q`/`/`/GRAB picks up the item at your feet or throws the one you hold; getting hit makes you drop it.
Low shots hit crates, high ones fly over. The CPU grabs and throws too.

## Special moves
- **Ranged special** (P1 `E` / P2 `P`, or down, down-forward, forward + punch): per character via `special.type` in JSON: `fireball` (mid height: duck it), `low` (ground wave: jump it), `fast` (quick, weaker).
- **SUPER bar:** fills only from normal attacks, thrown items and taking damage. A ranged special costs 25 of it, an Ultimate costs all 100, and hits from specials/Ultimates never refill the attacker's bar.
- **Ultimate** (P1 `R` / P2 `;`, or down, down-forward, forward + HK): needs a full blue SUPER bar (fills by hitting and being hit). Fast, unblockable, 30 damage,
  with armor while charging. Name/color from `ultimate` in JSON. On touch screens: SPECIAL and ULT buttons.
- Controls live in the pause menu (Esc or the pause button). Online it overlays the running match.

### Ultimate cutscene
Every Ultimate plays a 5 s cutscene (sim freeze + close-up camera + themed overlay). Per character in JSON: `ultimate.cutscene = {theme, color, glyphs, motion, lines[]}`
themes: sweet, politics, sunrise, hat, street, ecg, dad, dinner (or `plain`); `motion` = rise | fall | spin for the floating glyphs. Offline you can tap to skip after 1 s; online it is unskippable so both players stay in sync.

### Summons
An `ultimate` can carry `"summon": {"id":"<character id>","chance":0.5,"seconds":10,"power":0.7,"label":"..."}`: when the Ultimate is cast there is that chance a scripted, untouchable
ghost ally (the other character) fights alongside for that long. Tha Motivator summons White Chocolate; Black Son In Law summons The Politician. Rolls use the shared seeded RNG (`game.rand`) so online matches stay in sync.

## Photo faces (private)
A character can wear a real face: `"face": {"src":"faces/<id>.enc","crop":[x,y,w,h],"bright":1,"match":0}` in its JSON.
- Photos are stored **AES-256 encrypted** in `faces/` (public repo never holds a readable photo). The game asks for the group password once
  (remembered in the browser) and decrypts them locally. Without it, everyone still gets the stylized avatar. Needs https or localhost.
- Share link with the password built in: `https://cdand444.github.io/brawl-arena/#k=<password>`. Anything after `#` is never sent to a server, and the game removes it from the address bar after unlocking. Anyone with the link can see the faces, so only send it to friends.
- The password and original photos live in `_private/` (git-ignored, never pushed). Keep `_private/PASSWORD.txt` safe; losing it means re-encrypting.
- Add a face: put the photo in `_private/photos/`, encrypt with
  `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -in photo.jpg -out faces/<id>.enc -pass file:<file containing the normalized password>`,
  then add the `face` block (crop = pixel rectangle around the face, roughly 0.9 wide:tall). Best photos: front-facing, well lit, 400px+ face.
- Photo faces render as a flat 2D head cutout (billboard) with an outline; it always faces the camera and flips (coin-style) when the fighter turns.
- `bright` lightens dark photos; `match` (0..1) pulls a color-cast photo toward the character's skin tone.

### Home-screen app and the password
Android (Chrome) shares saved data with the browser, so the password carries over. iPhone home-screen apps have their own storage and the shortcut is created from the exact
page address: open the **share link with `#k=...`** in Safari first, then Share → Add to Home Screen (the page is served without a manifest on iOS so the address, including `#k=`, is kept).
If the app still asks for the password, paste the password or the whole share link into the box once; it is remembered after that.

## Online play
Menu -> ONLINE shows a **live list of open games** (a lobby inside the browsers, no server to run: whoever opens the screen first hosts the lobby, others take over if they leave).
Lobbies are private to people with the same group password (a hash of it names the lobby); others share a public lobby. Type your name, press HOST A GAME, friends tap JOIN. The 5-letter code still works.
After a match: REMATCH, CHANGE FIGHTER (both players go back to character select, still connected) or MENU. Offline, the pause menu has the same options.

Menu → ONLINE. One player picks HOST and sends the 5-letter code; the other enters it and presses JOIN. Host is Player 1 (left).
Both pick a fighter, the match starts, REMATCH needs both players to press it. Works between phone and desktop.
- Peer-to-peer (WebRTC via PeerJS). The free public PeerJS broker only introduces the two browsers; no game server to run.
- Inputs carry a match number (`epoch`) so leftovers from a previous match can never be applied after a rematch.
- Deterministic lockstep: both browsers run the identical simulation and exchange only button presses (4-tick input delay).
  Any code change to `fighter.js` / the sim in `game.js` must stay deterministic: no `Math.random`, `Date.now` or `Math.pow` in game logic.
- If the connection is slow the game briefly freezes until the opponent's input arrives. Strict corporate/mobile-carrier NATs can block
  direct connections (would need a TURN server).
- The page must be reachable by both players: deploy the folder to a static host (GitHub Pages, Netlify, Cloudflare Pages). `localhost` only works on one machine.

## Not done (ideas)
Rollback netcode (smoother at high ping), TURN relay for strict networks, rigged/animated models, grapple throws, music, 2 players on one phone.

## Performance notes
Rendering is decoupled from the 60 Hz sim (interpolated, time-based smoothing); sparks are pooled; no lights are added/removed at runtime (that recompiles shaders);
quality drops automatically on sustained low fps (phones start lower). Press F3 for an fps/quality readout.

## Balance testing
`__sim(idA, idB, n, level)` in the browser console plays CPU-vs-CPU matches at full speed and returns win counts (level 0-2). Last round-robin (20 matches per pairing, final build): all 8 fighters between 44% and 56% at Normal.
Tuning notes: stats kept within about +/-8% (speed/power/health multiply, so small differences matter); a summoned backup is chip-damage only (no stun, cannot KO) at 12% power, because even weak helpers swung win rates by ~17 points.
