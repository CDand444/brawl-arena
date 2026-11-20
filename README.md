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

## Photo faces (private)
A character can wear a real face: `"face": {"src":"faces/<id>.enc","crop":[x,y,w,h],"bright":1,"match":0}` in its JSON.
- Photos are stored **AES-256 encrypted** in `faces/` (public repo never holds a readable photo). The game asks for the group password once
  (remembered in the browser) and decrypts them locally. Without it, everyone still gets the stylized avatar. Needs https or localhost.
- The password and original photos live in `_private/` (git-ignored, never pushed). Keep `_private/PASSWORD.txt` safe; losing it means re-encrypting.
- Add a face: put the photo in `_private/photos/`, encrypt with
  `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -in photo.jpg -out faces/<id>.enc -pass file:<file containing the normalized password>`,
  then add the `face` block (crop = pixel rectangle around the face, roughly 0.9 wide:tall). Best photos: front-facing, well lit, 400px+ face.
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
