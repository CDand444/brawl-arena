# Brawl Arena: notes for Claude

Browser fighting game (see README.md). When the user gives photos of people to make a character:
- Describe only visible traits (hair, outfit, hat, accessories, build). Do not identify anyone. Output is a stylized avatar, not a likeness.
- Write `characters/<id>.json` following the field list in README.md, add the id to `characters/index.json`, preview in `viewer.html`.
- Keep fight stats near 1.0 so no character is broken. Use the person's name for `name` only if the user gives it.
- If a look needs something the model can't do (new hat or hairstyle), add it in `src/model.js` rather than special-casing the game.

## Working on the game
- Deploy = commit + `git push` (GitHub Pages, repo CDand444/brawl-arena, public). Bump the `?v=N` numbers in `index.html` and `src/game.js` (and `const V`) on every change so browsers fetch the new files.
- Anything inside the fight simulation (`fighter.js`, `step60`, props, helpers in `game.js`) must be deterministic for online lockstep: use `game.rand()`, never `Math.random()`/`Date.now()`/`Math.pow` there. `Math.random` is fine for cosmetics (sparks, ads, AI).
- Photos: originals and the group password live in `_private/` (git-ignored, never commit). Only AES-encrypted `faces/*.enc` go in the repo. New face: encrypt with the openssl line in README, add a `face` block with a crop.
- Test before pushing: run the page (python -m http.server), play a match, and use `__sim(idA,idB,n,level)` in the console for balance (keep everyone roughly 43-57%).
- The preview pane reports "Unexpected end of input" even on a blank page; that one is not from the game.
- Smash mode lives in `src/smash.js` (its own step/render; it borrows the cutscene, rigs and inputs from game.js through the `ctx` object). Same determinism rules apply there; CPU fighters in Smash use a seeded RNG so online stays in sync.
