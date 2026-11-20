# Brawl Arena

Browser fighting game, Mortal Kombat 3 style controls. 2.5D (3D models, side view). Desktop + phone.
Modes: 1 Player vs CPU (3 difficulties), 2 Players on one keyboard. Best of 3 rounds.

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

## Special moves
- **Ranged special** (P1 `E` / P2 `P`, or down, down-forward, forward + punch): per character via `special.type` in JSON: `fireball` (mid height: duck it), `low` (ground wave: jump it), `fast` (quick, weaker).
- **Ultimate** (P1 `R` / P2 `;`, or down, down-forward, forward + HK): needs a full blue SUPER bar (fills by hitting and being hit). Fast, unblockable, 30 damage,
  with armor while charging. Name/color from `ultimate` in JSON. On touch screens: SPECIAL and ULT buttons.
- A floating how-to-fight card shows when a match starts (click to close, `?` button reopens it).

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

## Online play
Menu → ONLINE. One player picks HOST and sends the 5-letter code; the other enters it and presses JOIN. Host is Player 1 (left).
Both pick a fighter, the match starts, REMATCH needs both players to press it. Works between phone and desktop.
- Peer-to-peer (WebRTC via PeerJS). The free public PeerJS broker only introduces the two browsers; no game server to run.
- Deterministic lockstep: both browsers run the identical simulation and exchange only button presses (4-tick input delay).
  Any code change to `fighter.js` / the sim in `game.js` must stay deterministic: no `Math.random`, `Date.now` or `Math.pow` in game logic.
- If the connection is slow the game briefly freezes until the opponent's input arrives. Strict corporate/mobile-carrier NATs can block
  direct connections (would need a TURN server).
- The page must be reachable by both players: deploy the folder to a static host (GitHub Pages, Netlify, Cloudflare Pages). `localhost` only works on one machine.

## Not done yet
Rollback netcode (smoother at high ping), real animation/rigged models, throws, run meter, gamepads, 2 players on one phone.
