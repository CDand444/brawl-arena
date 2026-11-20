import * as THREE from 'three';
import { buildCharacter, applyPose, applyFace, updateFace, toonMat, OUTLINE } from './model.js?v=27';
import { loadFaces, canDecrypt, normalize } from './faces.js?v=27';
import { Fighter, MOVES } from './fighter.js?v=27';
import { makeAI } from './ai.js?v=27';
import { EMPTY, KEYMAPS, keyboardInput, touchInput, combine, setupTouch, gamepadInput, padStart } from './input.js?v=27';
import { Net, Lobby, Room, packInput, unpackInput } from './net.js?v=27';
import { createSmash } from './smash.js?v=27';
import { buildStage, MAPS } from './stage.js?v=27';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

/* ---------- three.js stage ---------- */
const isCoarse = matchMedia('(pointer:coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: !isCoarse, alpha: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
const stage = buildStage(scene, renderer);
let mapId = 'temple'; try { mapId = localStorage.getItem('brawl-map') || 'temple'; } catch (e) {}
if (mapId !== 'random' && !MAPS.some((m) => m.id === mapId)) mapId = 'temple';
stage.setMap(mapId === 'random' ? 'temple' : mapId);
const resolveMap = () => (mapId === 'random' ? MAPS[(Math.random() * MAPS.length) | 0].id : mapId);
// quality 3 (best) .. 0 (fastest). Drops automatically if the frame rate sags; phones start lower.
let quality = isCoarse ? 2 : 3;
const DPR = [1, 1, 1.5, 2];
function applyQuality() { renderer.setPixelRatio(Math.min(devicePixelRatio, DPR[quality])); renderer.setSize(innerWidth, innerHeight, false); stage.setShadows(quality >= 3 ? 2048 : quality >= 1 ? 1024 : 0); }
function resize() { applyQuality(); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

function frameCamera(cx, spread, k = 1, minHalf = 3.4) {
  const halfW = Math.max(minHalf, spread / 2 + 2.2), t = Math.tan((cam.fov * Math.PI) / 360);
  const z = Math.max(halfW / (t * cam.aspect), (minHalf < 3 ? 1.35 : 1.8) / t);
  const s = 1 - Math.pow(0.9, k); cam.position.x += (cx - cam.position.x) * s; cam.position.y = 1.5; cam.position.z += (z - cam.position.z) * s;
  cam.lookAt(cam.position.x, 1.15, 0);
}
cam.position.set(0, 1.5, 12);

/* ---------- audio (tiny synth, no assets) ---------- */
let muted = false; try { muted = localStorage.getItem('brawl-mute') === '1'; } catch (e) {}
let actx, simMode = false; // simMode: balance testing (no sound, no rig prewarm)
const sfx = (f, d = 0.08, type = 'square', v = 0.05) => {
  if (simMode || muted) return;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.value = f;
    g.gain.value = v; g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + d); } catch (e) {}
};

/* ---------- characters ---------- */
let defs = [];
async function loadCharacters() {
  const ids = await (await fetch('characters/index.json?v=' + V)).json();
  defs = await Promise.all(ids.map(async (id) => ({ id, ...(await (await fetch(`characters/${id}.json?v=${V}`)).json()) })));
}
const faceTex = {};
function makeRig(def) { const rig = buildCharacter(def); if (faceTex[def.id]) applyFace(rig, faceTex[def.id], def.face); return rig; }
const css = (c) => (typeof c === 'string' ? c : '#' + c.toString(16).padStart(6, '0'));

/* ---------- menu & select ---------- */
let mode = 'ai', diff = 1, picks = [], step = 0, preview = [null, null];
const previewRoot = new THREE.Group(); scene.add(previewRoot);
function setPreview(slot, def) {
  if (preview[slot]) previewRoot.remove(preview[slot].root);
  preview[slot] = def ? makeRig(def) : null;
  if (preview[slot]) { preview[slot].root.position.x = slot ? 1.5 : -1.5; previewRoot.add(preview[slot].root); }
}
function buildSelect() {
  const grid = $('roster'); grid.innerHTML = '';
  defs.forEach((d) => {
    const b = document.createElement('button'); b.className = 'card';
    b.innerHTML = `<i style="background:${css(d.top)};border-color:${css(d.skin)}"></i><b>${d.name}</b><small>${d.tagline || ''}</small>`;
    b.onmouseenter = b.onfocus = () => setPreview(step, d);
    b.onclick = () => choose(d);
    grid.append(b);
  });
}
function choose(d) {
  if (mode === 'online') { myPick = d; const mp = resolveMap(); if (localSlot === 0) stage.setMap(mp); net.send({ t: 'pick', id: d.id, map: mp }); setPreview(0, d); $('selTitle').textContent = 'Waiting for opponent to choose…'; tryStartOnline(); return; }
  picks[step] = d;
  if (arcade) { // fight everyone else, in random order, getting harder
    const rest = defs.filter((x) => x.id !== d.id);
    for (let i = rest.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [rest[i], rest[j]] = [rest[j], rest[i]]; }
    arcade = { order: rest, idx: 0 }; arcadeNext(); return;
  }
  if (step === 0) { step = 1; $('selTitle').textContent = mode === 'ai' ? 'Choose your opponent' : 'Player 2: choose your fighter'; setPreview(1, null); }
  else startMatch();
}
function buildMapChips() {
  const box = $('maps'); box.innerHTML = '<span>STAGE</span>';
  [...MAPS, { id: 'random', name: '🎲 Random' }].forEach((m) => {
    const b = document.createElement('button'); b.className = 'chip' + (m.id === mapId ? ' on' : ''); b.textContent = m.name; b.onclick = () => pickMap(m.id); box.append(b);
  });
}
function pickMap(id) {
  mapId = id; try { localStorage.setItem('brawl-map', id); } catch (e) {}
  if (id !== 'random') stage.setMap(id); // live preview behind the select screen
  buildMapChips();
}
function openSelect() {
  show('menu', false); show('select'); show('hud', false); show('touch', false); show('endbar', false);
  step = 0; picks = []; $('selTitle').textContent = mode === '2p' ? 'Player 1: choose your fighter' : arcade ? 'ARCADE: choose your fighter' : 'Choose your fighter';
  $('randBtn').classList.toggle('hidden', false);
  buildMapChips(); $('maps').classList.toggle('hidden', mode === 'online' && localSlot === 1);
  ['banner', 'fsBtn', 'ad', 'pause', 'rotate'].forEach((i) => show(i, false)); paused = false; $('combo').textContent = '';
  setPreview(0, null); setPreview(1, null); previewRoot.visible = true; clearFighters(); phase = 'menu';
}
let arcade = null;
function arcadeNext() { const n = arcade.order.length, i = arcade.idx; picks[1] = arcade.order[i]; diff = i < n / 3 ? 0 : i < (2 * n) / 3 ? 1 : 2; startMatch(); }
function onMatchOver() { // label the end-of-match buttons
  const b = $('rematch'); b.textContent = 'REMATCH';
  if (!arcade) return;
  const n = arcade.order.length;
  if (matchWinner !== 0) b.textContent = 'RETRY';
  else if (arcade.idx + 1 < n) b.textContent = `NEXT FIGHT (${arcade.idx + 2}/${n})`;
  else { banner('ARCADE CLEARED!', `${picks[0].name} beat everyone`); b.textContent = 'PLAY AGAIN'; }
}
$('btnSmash').onclick = () => { arcade = null; smash.openSetup(); };
$('btnArcade').onclick = () => { mode = 'ai'; arcade = { order: [], idx: 0 }; openSelect(); };
$('btn1p').onclick = () => { mode = 'ai'; arcade = null; diff = +$('diff').value; openSelect(); };
$('btn2p').onclick = () => { mode = '2p'; arcade = null; openSelect(); };
$('randBtn').onclick = () => choose(defs[(Math.random() * defs.length) | 0]);
$('diff').onchange = (e) => (diff = +e.target.value);
function goMenu() {
  if (smash.active || smash.inRoom) smash.stop();
  ['smashSetup', 'shud', 'sEnd'].forEach((i) => show(i, false));
  arcade = null; diff = +$('diff').value;
  stopLobby();
  if (mode === 'online') { net.close(); net = new Net(); }
  mode = 'ai'; phase = 'menu'; clearFighters(); previewRoot.visible = true; setPreview(0, null); setPreview(1, null); paused = false;
  ['select', 'hud', 'touch', 'endbar', 'pause', 'online', 'banner', 'fsBtn', 'rotate', 'ad'].forEach((i) => show(i, false)); show('menu');
}
$('btnMenu').onclick = $('menuBtn2').onclick = goMenu;
$('rematch').onclick = () => {
  if (arcade && phase === 'over' && matchWinner === 0) { arcade.idx = (arcade.idx + 1) % arcade.order.length; if (arcade.idx === 0) return changeFighter(); return arcadeNext(); }
  if (mode !== 'online') return startMatch();
  myRematch = true; net.send({ t: 'rematch' }); $('rematch').textContent = 'WAITING…'; tryRematch();
};

function changeFighter() {
  if (mode === 'online') { net.send({ t: 'reselect' }); myPick = theirPick = null; myRematch = theirRematch = false; $('rematch').textContent = 'REMATCH'; }
  openSelect();
}
$('changeBtn').onclick = changeFighter;
$('pRematch').onclick = () => { paused = false; show('pause', false); if (mode === 'smash') return smash.rematch(); startMatch(); };
$('pChange').onclick = () => { paused = false; show('pause', false); if (mode === 'smash') return smash.toSetup(); changeFighter(); };

/* ---------- online (lockstep: both browsers run the same deterministic sim, only inputs are exchanged) ---------- */
const DELAY = 4; // input delay in ticks (~67ms); higher = smoother on bad connections
let net = new Net(), localSlot = 0, myPick = null, theirPick = null, myRematch = false, theirRematch = false;
let simTick = 0, localBuf = {}, remoteBuf = {}, epoch = 0, future = {};
const sampleLocal = combine(keyboardInput(KEYMAPS.p1, KEYMAPS.p2), touchInput(), gamepadInput(0));
const setStatus = (t) => ($('onStatus').textContent = t);
let lobby = null, lobbyTok = 0, hostingCode = null;
async function groupId() { // lobbies are private to everyone who has the same password; others share a public lobby
  let pw = ''; try { pw = localStorage.getItem('brawl-pw') || ''; } catch (e) {}
  if (!pw || !(globalThis.crypto && crypto.subtle)) return 'public';
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lobby:' + normalize(pw)));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function renderRooms(list) {
  const box = $('rooms'); box.textContent = '';
  const rooms = (list || []).filter((r) => r && r.code && r.code !== hostingCode);
  if (!rooms.length) { box.textContent = 'No open games yet. Host one and your friends will see it here.'; return; }
  rooms.forEach((r) => {
    const b = document.createElement('button'), nm = String(r.name || 'Player').slice(0, 14);
    if (r.kind === 'smash') { b.textContent = `${nm}'s SMASH room (${r.n || 1}/4)   ▶ JOIN`; b.onclick = () => smash.joinRoom(r.code, myName()); }
    else { b.textContent = `${nm}'s game   ▶ JOIN`; b.onclick = () => joinCode(r.code); }
    box.append(b);
  });
}
async function startLobby() {
  stopLobby(); const tok = ++lobbyTok; $('rooms').textContent = 'Looking for games…';
  const gid = await groupId(); if (tok !== lobbyTok) return;
  lobby = new Lobby('brawl-lobby-' + gid, renderRooms); lobby.start();
}
function stopLobby() { lobbyTok++; if (lobby) { lobby.stop(); lobby = null; } hostingCode = null; }
$('btnOnline').onclick = () => {
  arcade = null;
  show('menu', false); show('online'); setStatus(''); show('hostBtn'); show('cancelHost', false);
  try { $('pname').value = localStorage.getItem('brawl-name') || ''; } catch (e) {}
  startLobby();
};
$('onBack').onclick = () => { stopLobby(); net.close(); net = new Net(); show('online', false); show('menu'); };
$('cancelHost').onclick = () => { net.close(); net = new Net(); hostingCode = null; if (lobby) lobby.setRoom(null); show('cancelHost', false); show('hostBtn'); setStatus(''); };
function wireNet() {
  net.onmsg = (m) => {
    if (m.t === 'in') { if (m.e === epoch) remoteBuf[m.k] = unpackInput(m.v); else if (m.e > epoch) (future[m.e] = future[m.e] || {})[m.k] = unpackInput(m.v); }
    else if (m.t === 'pick') { theirPick = defs.find((d) => d.id === m.id) || null; if (m.map && localSlot === 1) stage.setMap(m.map); tryStartOnline(); }
    else if (m.t === 'rematch') { theirRematch = true; tryRematch(); }
    else if (m.t === 'reselect') { myPick = theirPick = null; myRematch = theirRematch = false; $('rematch').textContent = 'REMATCH'; openSelect(); toast('Your opponent is picking a new fighter'); }
  };
  net.onclose = () => {
    if (mode !== 'online') return;
    banner('OPPONENT LEFT'); show('online', false); setTimeout(goMenu, 2500);
  };
}
function beginOnline(slot) {
  stopLobby();
  mode = 'online'; epoch = 0; future = {}; localSlot = slot; myPick = theirPick = null; myRematch = theirRematch = false; wireNet();
  show('online', false); openSelect(); mode = 'online'; // openSelect resets title; keep mode
  $('selTitle').textContent = `Choose your fighter (you are ${slot ? 'Player 2, right' : 'Player 1, left'})`;
}
$('hostBtn').onclick = async () => {
  const name = ($('pname').value.trim() || 'Player').slice(0, 14); try { localStorage.setItem('brawl-name', name); } catch (e) {}
  net.close(); net = new Net(); mode = 'ai'; setStatus('Opening your game…'); show('hostBtn', false); show('cancelHost');
  try {
    await net.host((c) => { hostingCode = c; if (lobby) lobby.setRoom({ code: c, name }); setStatus(`Your game is open as "${name}". Waiting for a challenger… (backup code: ${c})`); });
    if (lobby) lobby.setRoom(null); beginOnline(0);
  } catch (e) { show('hostBtn'); show('cancelHost', false); hostingCode = null; if (lobby) lobby.setRoom(null); setStatus('Could not start: ' + (e.message || e)); }
};
const myName = () => { const n = ($('pname').value.trim() || 'Player').slice(0, 14); try { localStorage.setItem('brawl-name', n); } catch (e) {} return n; };
$('hostSmash').onclick = () => smash.hostRoom(myName());
async function joinCode(code) {
  if (code.trim().length === 6) return smash.joinRoom(code, myName()); // 6-letter codes are Smash rooms
  net.close(); net = new Net(); mode = 'ai'; setStatus('Joining…');
  try { await net.join(code); beginOnline(1); }
  catch (e) { setStatus(e.message || 'Could not join.'); }
}
$('joinBtn').onclick = () => { const code = $('code').value; if (code.trim().length < 5) return setStatus('Enter the code from your friend.'); joinCode(code); };
function tryStartOnline() {
  if (!(myPick && theirPick)) return;
  picks = localSlot === 0 ? [myPick, theirPick] : [theirPick, myPick]; startMatch();
}
function tryRematch() { if (myRematch && theirRematch) { myRematch = theirRematch = false; $('rematch').textContent = 'REMATCH'; startMatch(); } }

/* ---------- match ---------- */
let fighters = [], projectiles = [], wins = [0, 0], round = 1, phase = 'menu', pt = 0, timer = 120 * 60, paused = false, flawless = [true, true];
const BOUNDS = 9, game = { bounds: BOUNDS }; // expanded arena (was 5.2)
const edgePosts = [];
for (const s of [-1, 1]) { // glowing posts mark the edge of the ring
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.4, 0.14), new THREE.MeshBasicMaterial({ color: 0xffd54a })); post.position.set(s * (BOUNDS + 0.55), 1.7, 0); scene.add(post); edgePosts.push(post);
  const gl = stage.glow(0xffd54a, 3); gl.position.set(s * (BOUNDS + 0.55), 2.2, 0); scene.add(gl); edgePosts.push(gl);
}
const coarse = matchMedia('(pointer:coarse)').matches;
setupTouch();

function clearFighters() { clearProps(); cutT = 0; cut = null; show('cut', false); clearHelpers(); fighters.forEach((f) => { scene.remove(f.rig.root); if (f.helperRig) scene.remove(f.helperRig.root); }); fighters = []; projectiles.forEach((p) => scene.remove(p.mesh)); projectiles = []; }

function startMatch() {
  show('select', false); show('menu', false); show('endbar', false); previewRoot.visible = false; clearFighters(); rngSeed = 0x9e3779b9; if (mode !== 'online') stage.setMap(resolveMap());
  const kb1 = mode === 'ai' ? combine(keyboardInput(KEYMAPS.p1, KEYMAPS.p2), touchInput(), gamepadInput(0)) : combine(keyboardInput(KEYMAPS.p1), gamepadInput(0));
  fighters = [
    new Fighter(picks[0], makeRig(picks[0]), 0, kb1),
    new Fighter(picks[1], makeRig(picks[1]), 1, mode === '2p' ? combine(keyboardInput(KEYMAPS.p2), gamepadInput(1)) : null),
  ];
  if (mode === 'ai') fighters[1].getInput = makeAI(fighters[1], fighters[0], diff);
  if (mode === 'online') { // each tick's inputs come from the exchanged buffers
    epoch++; simTick = 0; localBuf = {}; remoteBuf = future[epoch] || {}; delete future[epoch]; acc = 0;
    for (let t = 0; t < DELAY; t++) { localBuf[t] = EMPTY(); remoteBuf[t] = EMPTY(); }
    fighters.forEach((f, i) => (f.getInput = () => (i === localSlot ? localBuf : remoteBuf)[simTick] || EMPTY()));
  }
  fighters.forEach((f) => { f.rig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(f.rig.root); });
  $('n0').textContent = picks[0].name; $('n1').textContent = arcade ? `${picks[1].name} (${arcade.idx + 1}/${arcade.order.length})` : mode === 'ai' ? picks[1].name + ' (CPU)' : picks[1].name;
  wins = [0, 0]; round = 1; flawless = [true, true];
  show('hud'); show('touch', coarse && mode !== '2p'); show('rematch'); $('rematch').textContent = 'REMATCH'; paused = false; show('pause', false);
  prewarmHelpers(); scheduleAds(); newRound(); show('fsBtn'); maybeRotateHint();
}
function tipsHtml() {
  const k = (a, b) => `<b>${a}</b> ${b}`;
  if (coarse) return `<h4>CONTROLS</h4>Pad (left): move, up = jump (tap up again in the air = double jump), down = crouch<br>${k('LP/HP', 'punch')} · ${k('LK/HK', 'kick')} · ${k('BLOCK', 'guard')} · ${k('RUN', '+ forward')}<br>${k('down + HP', 'uppercut')} · ${k('down + LK', 'sweep')}<br>${k('GRAB', 'pick up / throw items')} · ${k('SPECIAL', 'ranged shot, costs 1/4 bar')} · ${k('ULT', 'when the SUPER bar is full')}<br><small>Duck high shots, jump low ones. Ultimates can't be blocked.</small>`;
  const p2 = mode === '2p' ? `<br><b>P2:</b> arrows move · U/I punch · J/K kick · L block · O run · <b>P</b> special · <b>;</b> ultimate · <b>/</b> grab/throw` : '';
  const sm = mode === 'smash' ? '<b>SMASH:</b> damage % climbs; knock rivals off the screen to take a life. <b>Up + SPECIAL in the air</b> = recovery boost · <b>tap down</b> on a floating platform to drop through.<br>' : '';
  return `<h4>CONTROLS</h4>${sm}<b>${mode === '2p' ? 'P1: ' : ''}</b>A/D walk · W jump (<b>W again = double jump</b>) · S crouch<br>${k('F/G', 'low/high punch')} · ${k('C/V', 'low/high kick')}<br>${k('Shift', 'block')} · ${k('X', 'run (+ forward)')}<br>${k('S + G', 'uppercut')} · ${k('S + C', 'sweep')}<br>${k('Q', 'grab / throw items')} <small>(smash crates + barrels: barrels explode!)</small><br>${k('E', 'RANGED SPECIAL')} <small>(or down, forward + F/G; costs 1/4 of the SUPER bar)</small><br>${k('R', 'ULTIMATE')} <small>(or down, forward + V) when the blue SUPER bar is full</small>${p2}<br><small>Chain light attacks: after one connects, press a different attack to cancel into it. Duck high shots, jump low ones. Ultimates can't be blocked. Esc = this menu.<br>Gamepad: X/Y punch · A/B kick · RB block · LT run · LB grab · RT special · stick click ultimate · Start pause.</small>`;
}

function newRound() {
  hitstop = 0; clearHelpers();
  projectiles.forEach((p) => scene.remove(p.mesh)); projectiles = [];
  fighters[0].reset(-3.2); fighters[1].reset(3.2); buildProps();
  timer = 120 * 60; phase = 'intro'; pt = 0; banner(`ROUND ${round}`);
  [0, 1].forEach((i) => { $('p' + i).textContent = '●'.repeat(wins[i]) + '○'.repeat(2 - wins[i]); });
}
function banner(t, sub = '') { $('banner').innerHTML = t + (sub ? `<small>${sub}</small>` : ''); show('banner', !!t); }

// Ranged special types (set per character in JSON: special.type): fireball = mid height (duck it), low = ground wave (jump it), fast = quick shot
const SPECIALS = { fireball: { py: 1.35, speed: 0.12, dmg: 10, size: 0.28 }, low: { py: 0.45, speed: 0.14, dmg: 8, size: 0.3, low: true }, fast: { py: 1.35, speed: 0.2, dmg: 7, size: 0.22 } };
/* ---- summoned backup (e.g. Tha Motivator's Ultimate): a scripted ghost ally that fights for a while. Part of the sim, so everything here is deterministic. ---- */
let rngSeed = 0x9e3779b9;
game.rand = () => { rngSeed = (rngSeed + 0x6D2B79F5) | 0; let t = Math.imul(rngSeed ^ (rngSeed >>> 15), 1 | rngSeed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; // mulberry32: same sequence on both machines
let helpers = [];
function makeHelperInput(h, owner) {
  const seq = [['lp'], ['lk'], ['lp'], ['lp'], ['lk']]; // light moves only: she nudges and distracts, she does not set up big combos
  let i = 0, cool = 30, hold = 0, press = null;
  return () => {
    const o = EMPTY(), opp = fighters[1 - owner.side], dx = Math.abs(opp.x - h.x), fwd = h.face > 0 ? 'r' : 'l';
    if (hold > 0) { hold--; if (press) for (const k of press) o[k] = 1; return o; }
    if (cool > 0) cool--;
    if (dx > 1.45) { o[fwd] = 1; if (dx > 3) o.run = 1; if (dx > 3.4 && cool === 0 && h.fbCooldown === 0) { press = ['sp']; hold = 2; cool = 40; } }
    else if (cool === 0) { press = seq[i++ % seq.length]; hold = 2; cool = 34 + (press.length > 1 ? 16 : 6); /* slow cadence: she is a helper, not a second fighter */ }
    return o;
  };
}
function ghostify(rig) {
  rig.root.traverse((o) => { if (o.isMesh && o.material && o.material.side !== THREE.BackSide) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.8; } });
  const glow = stage.glow(0x9ad8ff, 2.6); glow.position.y = 0.15; rig.root.add(glow);
}
function removeHelper(h) { stage.spark(h.f.x, 1, 14, 0x9ad8ff, 0.9); if (h.owner.helperRig === h.f.rig) h.f.rig.root.position.set(100, 0, 0); else scene.remove(h.f.rig.root); }
// Build and compile summon rigs before the fight so nothing heavy happens mid-match (a rig build was a visible hitch). They wait off-screen.
function prewarmHelpers() {
  if (simMode) return;
  fighters.forEach((f) => {
    const cfg = f.def.ultimate?.summon, def = cfg && defs.find((d) => d.id === cfg.id); if (!def) return;
    const rig = makeRig(def); ghostify(rig); rig.root.position.set(100, 0, 0); scene.add(rig.root); f.helperRig = rig;
    if (faceTex[def.id]) renderer.initTexture(faceTex[def.id]);
  });
  renderer.compile(scene, cam);
}
function clearHelpers() { helpers.forEach(removeHelper); helpers = []; }
function updateHelpers() {
  for (const h of helpers) { h.f.update(fighters[1 - h.owner.side], game); h.life--; }
  helpers.filter((h) => h.life <= 0).forEach(removeHelper); helpers = helpers.filter((h) => h.life > 0);
}
function trySummon(f) { // returns the helper's label if she showed up
  const cfg = f.def.ultimate?.summon; if (!cfg) return null;
  if (game.rand() >= (cfg.chance ?? 0.5)) return null; // always draw one number so both machines stay in step
  const def = defs.find((d) => d.id === cfg.id); if (!def) return null;
  helpers = helpers.filter((h) => { if (h.owner === f) { removeHelper(h); return false; } return true; });
  let rig = f.helperRig; if (!rig) { rig = makeRig(def); ghostify(rig); scene.add(rig.root); }
  const hf = new Fighter(def, rig, f.side, null);
  hf.getInput = makeHelperInput(hf, f); hf.helper = true; hf.power = cfg.power ?? 0.7; hf.inv = 999999; hf.x = f.x - f.face * 0.9; hf.face = f.face;
  const label = cfg.label || def.name; helpers.push({ f: hf, owner: f, life: Math.round((cfg.seconds ?? 10) * 60), label });
  stage.spark(hf.x, 1, 24, 0x9ad8ff, 1.2);
  return label.toUpperCase();
}
let ultT = 0, hitstop = 0; // hitstop = freeze-frames on impact (part of the sim, so identical on both machines online)
game.onDJ = (f) => { stage.spark(f.x, f.y + 0.15, 8, 0xffffff, 0.6); sfx(520, 0.08, 'triangle', 0.04); }; // cosmetic
game.spawnProjectile = (f, kind = 'fb') => {
  const ult = kind === 'ult', sp = ult ? { py: 1.1, speed: 0.26, dmg: MOVES.ult.dmg, size: 0.7 } : (SPECIALS[f.def.special?.type] || SPECIALS.fireball);
  const color = css(ult ? (f.def.ultimate?.color ?? f.def.special?.color ?? '#ffffff') : (f.def.special?.color ?? '#ff7a1a'));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(sp.size, 16, 12), new THREE.MeshBasicMaterial({ color }));
  mesh.add(stage.glow(color, ult ? 7 : 2.6)); // no PointLight here: adding/removing a light recompiles every shader (stutter)
  if (ult) mesh.scale.set(1.8, 1.2, 1);
  mesh.position.set(f.x + f.face * 0.8, sp.py, 0); scene.add(mesh);
  projectiles.push({ owner: f, mesh, x: f.x + f.face * 0.8, dir: f.face, dmg: sp.dmg, speed: sp.speed, py: sp.py, hh: ult ? 1.0 : 0.22, low: !!sp.low, unblockable: ult, color: ult ? 0xffffff : 0xffb060, ult });
  if (!ult) f.fbCooldown = 50;
  sfx(ult ? 150 : 300, ult ? 0.5 : 0.2, 'sawtooth', ult ? 0.12 : 0.05);
};
/* ---- Ultimate cutscene: a 5 s freeze with a close-up camera and a themed overlay per character.
   The freeze is part of the sim (both players freeze together online); the visuals are cosmetic. Offline you can tap to skip. ---- */
const CUT_TICKS = 300; let cutT = 0, cut = null;
function startCutscene(f, summoned) {
  const u = f.def.ultimate || {}, cs = u.cutscene || {}, color = cs.color || u.color || '#ffd02a';
  cut = { f, sparkColor: parseInt(String(color).replace('#', ''), 16) || 0xffffff, after: { title: (u.name || 'ULTIMATE').toUpperCase() + '!', sub: summoned ? summoned + ' SHOWS UP TO HELP!' : '' } };
  cutT = CUT_TICKS;
  if (simMode) return;
  const lines = [...(cs.lines || [(u.name || 'ULTIMATE').toUpperCase()])]; if (summoned) lines.push('+ ' + summoned + ' JOINS THE FIGHT!');
  const per = 4.6 / lines.length, c = $('cut'), glyphs = [...(cs.glyphs || '★')];
  c.style.setProperty('--c', color); c.dataset.theme = cs.theme || 'plain';
  let fx = '';
  for (let i = 0; i < 22; i++) fx += `<span class="p ${cs.motion || 'rise'}" style="left:${Math.round(Math.random() * 96)}%;font-size:${30 + Math.round(Math.random() * 44)}px;animation-delay:${(Math.random() * 3).toFixed(2)}s;animation-duration:${(2 + Math.random() * 2).toFixed(2)}s">${glyphs[i % glyphs.length]}</span>`;
  c.innerHTML = `<div class="dim"></div><div class="rays"></div><div class="strobe"></div><div class="candle"></div><svg class="ecg" viewBox="0 0 400 60" preserveAspectRatio="none"><path d="M0 30 H110 l8 -26 l12 52 l10 -26 H230 l8 -26 l12 52 l10 -26 H400"/></svg><div class="fx">${fx}</div><div class="cb top"></div><div class="cb bot"></div><div class="who">${f.def.name.toUpperCase()}</div><div class="utitle">${u.name || 'ULTIMATE'}</div>`
    + lines.map((l, i) => `<div class="cl${summoned && i === lines.length - 1 ? ' sum' : ''}" style="animation-delay:${(0.5 + i * per).toFixed(2)}s;animation-duration:${per.toFixed(2)}s">${l}</div>`).join('')
    + `<div class="skip">${mode === 'online' || (mode === 'smash' && smash.isOnline()) ? '' : 'tap to skip'}</div>`;
  show('cut'); stage.shake += 0.5; sfx(70, 0.9, 'sawtooth', 0.14);
  const el = $('flash'); el.style.transition = 'none'; el.style.opacity = 0.9; requestAnimationFrame(() => { el.style.transition = 'opacity .8s'; el.style.opacity = 0; });
}
function endCutscene() {
  show('cut', false); if (!cut) return;
  ultT = 70; banner(cut.after.title, cut.after.sub); sfx(120, 0.4, 'square', 0.1); stage.shake += 0.6; cut = null;
}
function cutCamera(dt) { // slow push-in on the caster's upper body
  const c = cut.f, p = 1 - cutT / CUT_TICKS, s = 1 - Math.pow(0.88, dt * 60);
  const tx = c.x + c.face * 0.3, ty = 1.5 + Math.sin(p * 6) * 0.05, tz = 7.2 - 2.0 * p;
  cam.position.x += (tx - cam.position.x) * s; cam.position.y += (ty - cam.position.y) * s; cam.position.z += (tz - cam.position.z) * s;
  cam.lookAt(c.x + c.face * 0.2, 1.4, 0);
  if (Math.random() < 0.35) stage.spark(c.x + (Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 1.6, 2, cut.sparkColor, 0.8); // cosmetic
}
$('cut').onclick = () => { if (mode !== 'online' && !(mode === 'smash' && smash.isOnline()) && cutT > 0 && CUT_TICKS - cutT > 60) cutT = 1; };
game.onUlt = (f) => startCutscene(f, trySummon(f)); // the summon roll is part of the sim (seeded RNG)
game.tryHit = (att, def, m) => {
  if (def.inv > 0 || phase !== 'fight') return false;
  if (def.state === 'down' || def.state === 'getup') return false;
  const y0 = att.y + m.y[0], y1 = att.y + m.y[1], h0 = def.y, h1 = def.y + (def.crouching ? 1.25 : 1.95);
  if (y1 < h0 || y0 > h1) return false;
  const a = att.x, b = att.x + att.face * m.reach;
  if (Math.min(a, b) - 0.3 > def.x || Math.max(a, b) + 0.3 < def.x) return false;
  const r = def.receive(att, m, game);
  if (!att.helper) hitstop = Math.max(hitstop, r === 'block' ? 2 : Math.min(7, 2 + Math.round(m.dmg / 3)));
  if (Math.abs(def.x) >= game.bounds - 0.05) att.vx = -att.face * ((m.kb || 0.05) + 0.04); // cornered: attacker gets pushed back instead
  sfx(r === 'block' ? 120 : 200, 0.09, r === 'block' ? 'triangle' : 'square', r === 'block' ? 0.05 : 0.09);
  const hx = def.x - att.face * 0.25, hy = Math.max(0.4, def.y + (m.y[0] + m.y[1]) / 2 - att.y);
  if (r === 'block') stage.spark(hx, hy, 5, 0x9ab8ff, 0.7);
  else { stage.spark(hx, hy, 8 + Math.round(m.dmg), m.launch || m.knock ? 0xff8a3a : 0xffd070, 0.8 + m.dmg / 14); stage.shake = Math.min(0.9, stage.shake + m.dmg / 14); }
  return true;
};

/* ---------- destructible props + throwable items (part of the sim; deterministic: positions/drops use game.rand) ---------- */
const PROP_DEF = { crate: { w: 0.5, h: 0.95, hp: 26 }, barrel: { w: 0.4, h: 1.0, hp: 18, explosive: true } };
const ITEM_DEF = { brick: { dmg: 16, breaks: false }, bottle: { dmg: 12, breaks: true }, ball: { dmg: 20, breaks: false, knock: true } };
const ITEM_KINDS = Object.keys(ITEM_DEF);
let props = [], items = [], thrown = [];
const ENV = { face: 1, power: 1, meter: 0 }; // stands in for the attacker when the environment hurts someone

function propMesh(type) {
  const g = new THREE.Group();
  const part = (geo, col, x = 0, y = 0, outline = false) => { const m = new THREE.Mesh(geo, toonMat(col)); m.position.set(x, y, 0); m.castShadow = true; g.add(m); if (outline) { const o = new THREE.Mesh(geo, OUTLINE); o.scale.setScalar(1.05); m.add(o); } return m; };
  if (type === 'crate') {
    part(new THREE.BoxGeometry(0.9, 0.9, 0.9), 0xb8884a, 0, 0.45, true);
    for (const s of [-1, 1]) { part(new THREE.BoxGeometry(0.96, 0.1, 0.96), 0x8a5e2c, 0, 0.45 + s * 0.32); part(new THREE.BoxGeometry(0.1, 0.96, 0.96), 0x8a5e2c, s * 0.4, 0.45); }
  } else {
    part(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 16), 0xc2402a, 0, 0.5, true);
    for (const y of [0.2, 0.8]) part(new THREE.CylinderGeometry(0.415, 0.415, 0.08, 16), 0x55555f, 0, y);
    part(new THREE.CylinderGeometry(0.41, 0.41, 0.2, 16), 0xffd02a, 0, 0.5); // hazard band
  }
  return g;
}
function itemMesh(kind) {
  const g = new THREE.Group(); g.userData.kind = kind;
  const part = (geo, col, x = 0, y = 0.12, ol = true) => { const m = new THREE.Mesh(geo, toonMat(col)); m.position.set(x, y, 0); m.castShadow = true; g.add(m); if (ol) { const o = new THREE.Mesh(geo, OUTLINE); o.scale.setScalar(1.12); m.add(o); } return m; };
  if (kind === 'brick') part(new THREE.BoxGeometry(0.34, 0.16, 0.18), 0xb5472a);
  else if (kind === 'bottle') { part(new THREE.CylinderGeometry(0.075, 0.085, 0.26, 10), 0x2f9a4a); part(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 10), 0x2f9a4a, 0, 0.3, false); }
  else part(new THREE.SphereGeometry(0.17, 14, 12), 0x23232e, 0, 0.17);
  g.add(stage.glow(0xffffff, 0.8)).position.set(0, 0.2, 0.2); // faint highlight so items read on the floor
  return g;
}
function clearProps() { [...props, ...items, ...thrown].forEach((o) => o.mesh && scene.remove(o.mesh)); props = []; items = []; thrown = []; }
function addProp(type, x) { const o = { type, x, hp: PROP_DEF[type].hp, dead: false, mesh: propMesh(type) }; o.mesh.position.set(x, 0, 0); scene.add(o.mesh); props.push(o); }
function addItem(kind, x, y = 0, vy = 0) { const o = { kind, x, y, vy, rest: y === 0, mesh: itemMesh(kind) }; o.mesh.position.set(x, y, 0); scene.add(o.mesh); items.push(o); }
const rndKind = () => ITEM_KINDS[(game.rand() * ITEM_KINDS.length) | 0];
function buildProps() { // two containers per side (crates or explosive barrels) + a couple of loose items near the middle
  clearProps();
  for (const side of [-1, 1]) for (const [lo, span] of [[4.6, 1.2], [6.8, 1.2]]) addProp(game.rand() < 0.5 ? 'crate' : 'barrel', side * (lo + game.rand() * span));
  for (let i = 0; i < 2; i++) addItem(rndKind(), (game.rand() - 0.5) * 4);
}
function damageProp(p, d, by, depth = 0) {
  if (p.dead) return;
  p.hp -= d; stage.spark(p.x, 0.7, 4, 0xd8a860, 0.6); sfx(180, 0.06, 'square', 0.06);
  if (p.hp <= 0) breakProp(p, by, depth);
}
function breakProp(p, by, depth) {
  p.dead = true; scene.remove(p.mesh); stage.spark(p.x, 0.6, 18, p.type === 'barrel' ? 0xff8a3a : 0xd8a860, 1.1); stage.shake += 0.3; sfx(100, 0.2, 'sawtooth', 0.1);
  if (PROP_DEF[p.type].explosive) explode(p, by, depth);
  else if (game.rand() < 0.65) addItem(rndKind(), p.x, 0.5, 0.08); // crates often hold something to throw
}
function explode(p, by, depth) {
  stage.spark(p.x, 0.8, 40, 0xffa030, 2); stage.shake += 0.8; sfx(60, 0.5, 'sawtooth', 0.14); hitstop = Math.max(hitstop, 6);
  for (const f of fighters) {
    if (Math.abs(f.x - p.x) < 1.9 && f.y < 1.8 && f.inv === 0 && f.state !== 'down' && f.state !== 'getup') {
      ENV.face = f.x >= p.x ? 1 : -1; f.receive(ENV, { dmg: 24, kb: 0.18, knock: true, unblockable: true, hs: 30, bs: 20 }, game); // the blast hurts everyone nearby, including whoever lit it
    }
  }
  if (depth < 3) for (const q of props) if (!q.dead && Math.abs(q.x - p.x) < 2.2) damageProp(q, 40, by, depth + 1); // chain reaction
}
game.hitProps = (att, m) => { // called by a fighter's active attack frames
  if (phase !== 'fight') return false;
  let hit = false; const a = att.x, b = att.x + att.face * m.reach, y0 = att.y + m.y[0], y1 = att.y + m.y[1];
  for (const p of props) {
    if (p.dead) continue; const d = PROP_DEF[p.type];
    if (Math.min(a, b) - d.w > p.x || Math.max(a, b) + d.w < p.x || y1 < 0 || y0 > d.h + 0.45) continue; // generous: a chest-high punch still hits a crate
    damageProp(p, m.dmg * att.power * 2.2, att); hit = true;
  }
  if (hit) hitstop = Math.max(hitstop, 2);
  return hit;
};
game.grab = (f) => {
  if (f.held || !f.grounded) return false;
  let best = null, bd = 0.9;
  for (const it of items) { if (!it.rest) continue; const d = Math.abs(it.x - f.x); if (d < bd) { bd = d; best = it; } }
  if (!best) return false;
  items.splice(items.indexOf(best), 1); scene.remove(best.mesh); f.held = best.kind; sfx(500, 0.05, 'triangle', 0.05);
  return true;
};
game.throwItem = (f) => {
  if (!f.held) return;
  const t = { kind: f.held, x: f.x + f.face * 0.5, y: f.y + 1.3, vx: f.face * 0.22, vy: 0.045, owner: f, mesh: itemMesh(f.held), dead: false }; t.px = t.x; t.py = t.y;
  f.held = null; scene.add(t.mesh); thrown.push(t); sfx(260, 0.1, 'triangle', 0.06);
};
game.dropHeld = (f) => { if (f.held) { addItem(f.held, f.x, f.y + 0.8, 0.05); f.held = null; } };
function updateProps() {
  fighters.forEach((f) => { f.propAhead = props.some((p) => !p.dead && (p.x - f.x) * f.face > 0 && Math.abs(p.x - f.x) < 1.25); });
  fighters.forEach((f) => { f.nearItem = !f.held && items.some((it) => it.rest && Math.abs(it.x - f.x) < 0.9); }); // used by the CPU
  for (const it of items) if (!it.rest) { it.y += it.vy; it.vy -= 0.01; if (it.y <= 0) { it.y = 0; it.vy = 0; it.rest = true; } }
  for (const t of thrown) {
    t.px = t.x; t.py = t.y; t.x += t.vx; t.y += t.vy; t.vy -= 0.004;
    const def = ITEM_DEF[t.kind], tgt = fighters[1 - t.owner.side], top = tgt.y + (tgt.crouching ? 1.25 : 1.95); let done = false;
    for (const pr of props) if (!pr.dead && Math.abs(t.x - pr.x) < PROP_DEF[pr.type].w + 0.15 && t.y < PROP_DEF[pr.type].h) { damageProp(pr, def.dmg * 2, t.owner); done = true; break; }
    if (!done && phase === 'fight' && Math.abs(t.x - tgt.x) < 0.45 && t.y > tgt.y && t.y < top && tgt.inv === 0 && tgt.state !== 'down' && tgt.state !== 'getup') {
      hitstop = Math.max(hitstop, 4); tgt.receive(t.owner, { dmg: def.dmg, kb: 0.14, hs: 24, bs: 14, knock: !!def.knock }, game); stage.spark(t.x, t.y, 12, 0xffffff, 1); sfx(150, 0.12, 'square', 0.09); done = true;
    }
    if (done || t.y <= 0.1 || Math.abs(t.x) > BOUNDS + 4) {
      t.dead = true; scene.remove(t.mesh);
      if (def.breaks) stage.spark(t.x, Math.max(0.2, t.y), 16, 0x66ff88, 1); // bottles shatter
      else if (done || t.y <= 0.35) addItem(t.kind, Math.max(-BOUNDS, Math.min(BOUNDS, t.x)), Math.max(0, t.y), 0.03);
    }
  }
  thrown = thrown.filter((t) => !t.dead);
  for (const pr of props) { // crates and barrels are solid: walk around them or jump over
    if (pr.dead) continue; const w = PROP_DEF[pr.type].w + 0.3, h = PROP_DEF[pr.type].h;
    for (const f of fighters) if (f.y < h && Math.abs(f.x - pr.x) < w) { f.x = pr.x + (f.x >= pr.x ? w : -w); f.vx = 0; f.wv = 0; }
  }
  props = props.filter((p) => !p.dead);
}
function syncProps(alpha) { // cosmetic: place meshes, attach the held item to the hand
  for (const it of items) it.mesh.position.set(it.x, it.y, 0);
  for (const t of thrown) { t.mesh.position.set(t.px + (t.x - t.px) * alpha, t.py + (t.y - t.py) * alpha, 0); t.mesh.rotation.z += 0.3; }
  for (const f of fighters) {
    if (f.heldMesh && f.heldMesh.userData.kind !== f.held) { f.heldMesh.parent && f.heldMesh.parent.remove(f.heldMesh); f.heldMesh = null; }
    if (f.held && !f.heldMesh) { f.heldMesh = itemMesh(f.held); f.heldMesh.position.set(0, -0.42, 0.1); f.rig.elbows[1].add(f.heldMesh); }
  }
}

function step60() {
  if (phase === 'intro') {
    pt++;
    if (pt === 60) banner('FIGHT!'); if (pt === 100) { banner(''); phase = 'fight'; }
    return;
  }
  const none = EMPTY();
  const [a, b] = fighters;
  if (cutT > 0) { a.poll(); b.poll(); if (--cutT === 0) endCutscene(); return; } // Ultimate cutscene: everything is frozen
  if (ultT > 0 && --ultT === 0 && phase === 'fight') banner('');
  if (phase === 'fight') { if (hitstop > 0) { hitstop--; a.poll(); b.poll(); } else { timer--; a.update(b, game); b.update(a, game); updateHelpers(); } }
  else { a.update(b, game, none); b.update(a, game, none); }
  // separation
  if (a.grounded && b.grounded && Math.abs(a.x - b.x) < 0.7) {
    const push = (0.7 - Math.abs(a.x - b.x)) / 2, s = a.x <= b.x ? 1 : -1;
    a.x -= push * s; b.x += push * s;
  }
  if (phase === 'fight') updateProps();
  // projectiles
  for (const p of projectiles) {
    p.x += p.dir * p.speed; p.mesh.position.x = p.x;
    if (Math.random() < (p.ult ? 1 : 0.6)) stage.spark(p.x - p.dir * 0.3, p.py + (Math.random() - 0.5) * (p.ult ? 1.2 : 0), p.ult ? 2 : 1, p.color, p.ult ? 0.9 : 0.5); // cosmetic only
    for (const pr of props) if (!p.dead && !pr.dead && Math.abs(p.x - pr.x) < PROP_DEF[pr.type].w + 0.3 && p.py < PROP_DEF[pr.type].h + 0.3) { damageProp(pr, p.dmg * 3, p.owner); if (!p.ult) { p.dead = true; stage.spark(p.x, p.py, 10, p.color, 1); } } // low shots hit crates; high ones fly over
    const t = fighters[1 - p.owner.side], top = t.y + (t.crouching ? 1.25 : 1.95);
    if (phase === 'fight' && Math.abs(p.x - t.x) < 0.45 + (p.ult ? 0.3 : 0) && p.py + p.hh >= t.y && p.py - p.hh <= top && t.inv === 0 && t.state !== 'down' && t.state !== 'getup') {
      p.dead = true; stage.spark(p.x, p.py, p.ult ? 40 : 22, p.ult ? 0xffffff : 0xff9a3a, p.ult ? 2 : 1.4); stage.shake += p.ult ? 1 : 0.5;
      hitstop = Math.max(hitstop, p.ult ? 8 : 4);
      t.receive(p.owner, { dmg: p.dmg, kb: p.ult ? 0.2 : 0.1, hs: 22, bs: 14, knock: true, low: p.low, unblockable: p.unblockable, noMeter: true }, game); sfx(160, 0.15, 'sawtooth', 0.09);
    }
    if (Math.abs(p.x) > BOUNDS + 6) p.dead = true;
  }
  projectiles = projectiles.filter((p) => { if (p.dead) scene.remove(p.mesh); return !p.dead; });

  // combo + HUD
  const hits = Math.max(a.comboHits, b.comboHits);
  setT('combo', hits >= 2 ? `${hits} HIT COMBO` : '');

  if (phase === 'fight') {
    if (a.hp < a.maxHp) flawless[0] = false; if (b.hp < b.maxHp) flawless[1] = false;
    let w = -1;
    if (a.hp <= 0 || b.hp <= 0) w = a.hp <= 0 && b.hp <= 0 ? -2 : a.hp <= 0 ? 1 : 0;
    else if (timer <= 0) w = a.hp / a.maxHp === b.hp / b.maxHp ? -2 : a.hp / a.maxHp > b.hp / b.maxHp ? 0 : 1;
    if (w !== -1) endRound(w, timer <= 0 && a.hp > 0 && b.hp > 0);
  } else if (phase === 'end' && ++pt > 150) {
    if (matchWinner >= 0) { phase = 'over'; show('endbar'); onMatchOver(); return; }
    round++; newRound();
  }
}
let matchWinner = -1;
function endRound(w, timeUp) {
  clearHelpers();
  phase = 'end'; pt = 0;
  if (w >= 0) wins[w]++;
  matchWinner = wins[0] >= 2 ? 0 : wins[1] >= 2 ? 1 : -1;
  [0, 1].forEach((i) => { $('p' + i).textContent = '●'.repeat(wins[i]) + '○'.repeat(2 - wins[i]); });
  if (w >= 0) fighters[w].state = fighters[w].state === 'down' ? 'down' : 'win';
  const name = w >= 0 ? fighters[w].def.name : '';
  if (matchWinner >= 0) banner(`${name.toUpperCase()} WINS`, flawless[matchWinner] ? 'FLAWLESS VICTORY' : 'MATCH');
  else banner(w < 0 ? 'DRAW' : timeUp ? 'TIME UP' : 'K.O.', w >= 0 ? name + ' takes the round' : '');
  sfx(90, 0.5, 'sawtooth', 0.1);
}
// Rendering is decoupled from the 60 Hz sim: positions are interpolated between sim ticks and pose smoothing is time-based,
// so 90/120/144 Hz screens look smooth instead of stepping.
function poseUpdate(f, alpha, dt) {
  const st = f.state, k = st === 'attack' ? 0.5 : 0.35, kk = 1 - Math.pow(1 - k, Math.min(dt, 0.05) * 60);
  applyPose(f.rig, st === 'win' ? 'win' : f.poseName(), f.u + alpha, kk, -f.face * 0.4);
  f.rig.root.position.set(f.px + (f.x - f.px) * alpha, f.py + (f.y - f.py) * alpha, 0);
  f.rig.root.rotation.y = f.face * (Math.PI / 2 - 0.45); // 3/4 view so faces show to the camera
  updateFace(f.rig, f.face, dt);
}
const cache = {};
const setT = (id, v) => { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } };
const setW = (id, v) => { v = Math.round(v * 10) / 10 + '%'; if (cache[id] !== v) { cache[id] = v; $(id).style.width = v; } };

/* ---------- main loop ---------- */
let last = performance.now(), acc = 0, ema = 1 / 60, lastQ = performance.now(), showFps = false, lastFps = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  ema += (dt - ema) * 0.04;
  if ((phase === 'fight' || phase === 'intro') && now - lastQ > 3000 && ema > 1 / 40 && quality > 0) { quality--; lastQ = now; applyQuality(); } // sustained <40 fps: lower the load
  if (showFps && now - lastFps > 400) { lastFps = now; $('fps').textContent = `${Math.round(1 / ema)} fps · quality ${quality}`; }
  if (mode === 'smash' && smash.active) smash.frame(now, dt);
  else if (phase === 'menu') {
    previewRoot.children.forEach((g, i) => { g.rotation.y = Math.sin(now / 900 + i) * 0.8; }); preview.forEach((r) => r && updateFace(r, 1));
    frameCamera(0, 0, 3, 2.3);
  } else {
    if (!paused) {
      acc = Math.min(acc + dt, 0.25);
      while (acc >= 1 / 60 && fighters.length) {
        if (mode === 'online') {
          if (!remoteBuf[simTick]) break; // stall until the opponent's input for this tick arrives
          const inp = sampleLocal(); localBuf[simTick + DELAY] = inp; net.send({ t: 'in', e: epoch, k: simTick + DELAY, v: packInput(inp) });
        }
        acc -= 1 / 60; step60();
        if (mode === 'online') { delete localBuf[simTick]; delete remoteBuf[simTick]; simTick++; }
      }
    }
    if (fighters.length) {
      const [a, b] = fighters;
      const alpha = paused || hitstop > 0 || cutT > 0 ? 1 : Math.min(1, acc * 60);
      syncProps(alpha); fighters.forEach((f) => poseUpdate(f, alpha, dt)); helpers.forEach((h) => poseUpdate(h.f, alpha, dt));
      if (cutT > 0 && cut) cutCamera(dt); else frameCamera((a.x + b.x) / 2, Math.abs(a.x - b.x), dt * 60);
      setW('hp0', Math.max(0, (a.hp / a.maxHp) * 100)); setW('hp1', Math.max(0, (b.hp / b.maxHp) * 100));
      [a, b].forEach((f, i) => { setW('m' + i, Math.min(100, f.meter)); const full = f.meter >= 100; if (cache['full' + i] !== full) { cache['full' + i] = full; $('m' + i).parentElement.classList.toggle('full', full); } });
      const bk = helpers.map((h) => `${h.label} · ${Math.ceil(h.life / 60)}s`).join('   '); setT('backup', bk); if (cache.bkv !== !!bk) { cache.bkv = !!bk; $('backup').classList.toggle('hidden', !bk); }
      setT('h0', a.held ? `Holding ${a.held.toUpperCase()} (Q to throw)` : ''); setT('h1', b.held ? `Holding ${b.held.toUpperCase()}` : '');
      setT('timer', String(Math.max(0, Math.ceil(timer / 60))));
    }
  }
  if (phase === 'fight' && !paused && cutT === 0 && !adOpen() && now > nextAdAt) showAd();
  if (phase !== 'fight' && phase !== 'intro' && phase !== 'end' && adOpen()) show('ad', false);
  stage.update(now, dt);
  const sh = stage.shake * 0.14, ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
  cam.position.x += ox; cam.position.y += oy; renderer.render(scene, cam); cam.position.x -= ox; cam.position.y -= oy;
}
const openPause = () => {
  if (!['fight', 'intro', 'end', 'over'].includes(phase)) return;
  const online = mode === 'online' || (mode === 'smash' && smash.isOnline()); if (!online) paused = true;
  $('pauseTips').innerHTML = tipsHtml() + (online ? '<br><small>Online: the match keeps running while this menu is open.</small>' : '');
  show('pRematch', !online); show('pChange', !online); $('btnMenu').textContent = 'QUIT TO MENU'; show('pause');
};
const closePause = () => { paused = false; show('pause', false); };
addEventListener('keydown', (e) => {
  if (e.code === 'F3') { e.preventDefault(); showFps = !showFps; show('fps', showFps); }
  if (e.code === 'Escape') { if (!$('pause').classList.contains('hidden')) closePause(); else openPause(); }
});
$('resume').onclick = closePause;
const paintMute = () => ['btnMute', 'pMute'].forEach((id) => ($(id).textContent = muted ? '🔇 SOUND: OFF' : '🔊 SOUND: ON'));
['btnMute', 'pMute'].forEach((id) => ($(id).onclick = () => { muted = !muted; try { localStorage.setItem('brawl-mute', muted ? '1' : '0'); } catch (e) {} paintMute(); }));
paintMute();
let padWas = false;
setInterval(() => { const s = padStart(); if (s && !padWas) { if (!$('pause').classList.contains('hidden')) closePause(); else openPause(); } padWas = s; }, 100);
$('pauseBtn').onclick = openPause;

const V = 27;
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/* ---------- joke pop-up ads (fake, cosmetic only; one tap anywhere closes) ---------- */
const ADS = [
  `<div class="adh">GAMER ALERT!!</div><div class="ps3"><div class="slab"><i></i>PS3</div></div><div class="adt">PS3: "barely used, only played on weekends"</div><div class="adp">$49 OBO · controller sold separately · yes, it still plays Blu-ray</div><button>BUY NOW (not real)</button>`,
  `<div class="adh">DAD ALERT!!</div><div class="grill"><div class="smoke"></div><div class="lid"></div><div class="body"></div><div class="legs"></div></div><div class="adt">Traeger Grills</div><div class="adp">Set it. Forget it. Brag about it. Pellets sold separately. Ask your dad.</div><button>BUY NOW (not real)</button>`,
];
let adIdx = 0, nextAdAt = Infinity;
const adOpen = () => !$('ad').classList.contains('hidden');
function closeAd() { show('ad', false); nextAdAt = performance.now() + 45000 + Math.random() * 30000; }
function showAd() {
  $('ad').innerHTML = `<span class="tag">AD · fake, just for laughs</span><span class="x">✕</span>${ADS[adIdx++ % ADS.length]}<div class="tap">tap anywhere on this ad to close</div>`;
  show('ad'); sfx(660, 0.12, 'triangle', 0.05);
}
$('ad').onclick = closeAd;
const scheduleAds = () => { nextAdAt = performance.now() + 20000; show('ad', false); };

/* ---------- full screen + rotate ---------- */
function toast(t) { const el = $('toast'); el.textContent = t; show('toast'); clearTimeout(toast.h); toast.h = setTimeout(() => show('toast', false), 5000); }
async function toggleFullscreen() {
  const d = document, el = d.documentElement;
  if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); try { screen.orientation.unlock(); } catch (e) {} return; }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return toast('Full screen is not available in this browser. On iPhone: tap Share, then Add to Home Screen, and open it from there.');
  try { await req.call(el, { navigationUI: 'hide' }); } catch (e) { return toast('Full screen was blocked by the browser.'); }
  try { await screen.orientation.lock('landscape'); } catch (e) { /* not supported (e.g. desktop/iOS): fine */ }
}
['btnFull', 'fsBtn', 'rotFs'].forEach((id) => ($(id).onclick = toggleFullscreen));
$('rotOk').onclick = () => show('rotate', false);
const maybeRotateHint = () => show('rotate', coarse && innerHeight > innerWidth);
addEventListener('resize', () => { if (innerWidth >= innerHeight) show('rotate', false); });
if (navigator.standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) show('btnFull', false); // bump to bust browser caches after updates
const faceUrls = {};
const faceUrl = (id) => { const t = faceTex[id]; if (!t) return null; return (faceUrls[id] = faceUrls[id] || t.image.toDataURL('image/jpeg', 0.85)); };
const smash = createSmash({
  $, show, scene, cam, stage, sfx, banner, toast, coarse,
  defs: () => defs, makeRig, ghostify, poseUpdate, faceUrl, toonMat,
  Fighter, MOVES, makeAI, Room,
  inp: { EMPTY, KEYMAPS, keyboardInput, touchInput, gamepadInput, combine, pack: packInput, unpack: unpackInput },
  MAPS, getMap: () => mapId, setMap: (id) => pickMap(id), resolveMap, setMapNow: (id) => stage.setMap(id),
  cut: { active: () => cutT > 0 && !!cut, tick: () => { if (cutT > 0 && --cutT === 0) endCutscene(); }, start: (f, label) => startCutscene(f, label), camera: (dt) => cutCamera(dt), clear: () => { cutT = 0; cut = null; show('cut', false); } },
  paused: () => paused, setPhase: (p) => { if (p === 'fight' && phase !== 'fight') scheduleAds(); phase = p; }, setMode: (m) => { mode = m; },
  clearClassic: () => clearFighters(), setPosts: (v) => edgePosts.forEach((o) => (o.visible = v)),
  lobbySet: (r) => { if (lobby) lobby.setRoom(r); }, lobbyStop: () => stopLobby(), setHosting: (c) => { hostingCode = c; }, setStatus, goMenu: () => goMenu(),
});
async function boot() {
  await loadCharacters(); buildSelect(); show('loading', false); requestAnimationFrame(loop);
  const withFace = defs.filter((d) => d.face).length;
  const setFaceStatus = (t, btn) => { $('faceStatus').textContent = t; show('btnFaces', !!btn); };
  if (!withFace) return show('menu');
  if (!canDecrypt()) { setFaceStatus('Real faces need a secure (https) page. Using stylized fighters.', false); return show('menu'); }
  const tryPw = async (pw) => {
    const t = await loadFaces(defs, pw); Object.assign(faceTex, t);
    try { localStorage.setItem('brawl-pw', pw); } catch (e) {}
    setFaceStatus(`Real faces unlocked (${Object.keys(t).length}/${withFace}).`, false); buildSelect();
  };
  const openGate = () => { show('menu', false); show('gate'); $('gateMsg').textContent = ''; $('pw').focus(); };
  let saved = null; try { saved = localStorage.getItem('brawl-pw'); } catch (e) {}
  setFaceStatus('Faces locked. Using stylized fighters.', true);
  $('btnFaces').onclick = openGate;
  $('pwSkip').onclick = () => { show('gate', false); show('menu'); };
  const unlock = async () => {
    $('gateMsg').textContent = 'Checking…';
    try { await tryPw($('pw').value); show('gate', false); show('menu'); }
    catch (e) { console.warn('face unlock failed', e); $('gateMsg').textContent = /password/i.test(String(e.message)) || e.name === 'OperationError' ? 'Wrong password.' : 'Could not load photos: ' + (e.message || e); }
  };
  $('pwOk').onclick = unlock; $('pw').onkeydown = (e) => { if (e.key === 'Enter') unlock(); };
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('k'); // share link: .../#k=<password> (the # part never reaches a server)
  if (fromLink) { try { await tryPw(fromLink); if (!IOS) history.replaceState(null, '', location.pathname + location.search); /* iOS keeps #k so Add to Home Screen saves it */ return show('menu'); } catch (e) { console.warn('link password failed', e); } }
  if (saved) { try { await tryPw(saved); return show('menu'); } catch (e) { console.warn('saved password failed', e); } }
  openGate();
}
boot().catch((e) => { $('loading').classList.remove('hidden'); $('loading').textContent = 'Failed to load. Run the game through a web server (see README). ' + e; });
window.__game = { get smash() { return smash.debug(); }, get props() { return props; }, get items() { return items; }, get thrown() { return thrown; }, get defs() { return defs; }, get fighters() { return fighters; }, get phase() { return phase; }, get tick() { return simTick; } };

// Balance testing hook: plays CPU-vs-CPU matches synchronously and returns win counts. Usage (browser console): __sim('auburn','bruiser',10,1)
window.__sim = (idA, idB, n = 1, level = 1) => {
  simMode = true; const out = { a: 0, b: 0, ticks: 0 };
  try {
    for (let i = 0; i < n; i++) {
      picks = [defs.find((d) => d.id === idA), defs.find((d) => d.id === idB)]; mode = 'ai'; diff = level; startMatch();
      fighters[0].getInput = makeAI(fighters[0], fighters[1], level);
      let guard = 0; while (phase !== 'over' && guard++ < 400000) { step60(); out.ticks++; }
      if (matchWinner === 0) out.a++; else if (matchWinner === 1) out.b++;
    }
  } finally { simMode = false; goMenu(); }
  return out;
};
