# Brawl Arena: notes for Claude

Browser fighting game (see README.md). When the user gives photos of people to make a character:
- Describe only visible traits (hair, outfit, hat, accessories, build). Do not identify anyone. Output is a stylized avatar, not a likeness.
- Write `characters/<id>.json` following the field list in README.md, add the id to `characters/index.json`, preview in `viewer.html`.
- Keep fight stats near 1.0 so no character is broken. Use the person's name for `name` only if the user gives it.
- If a look needs something the model can't do (new hat or hairstyle), add it in `src/model.js` rather than special-casing the game.
