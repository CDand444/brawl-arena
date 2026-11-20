import * as THREE from 'three';
import { buildCharacter, applyPose, applyFace, updateFace } from './model.js?v=16';
import { loadFaces, canDecrypt, normalize } from './faces.js?v=16';
import { Fighter, MOVES } from './fighter.js?v=16';
import { makeAI } from './ai.js?v=16';
import { EMPTY, KEYMAPS, keyboardInput, touchInput, combine, setupTouch } from './input.js?v=16';
import { Net, Lobby, packInput, unpackInput } from './net.js?v=16';
import { buildStage, MAPS } from './stage.js?v=16';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

/* ---------- three.js stage ---------- */
const isCoarse = matchMedia('(pointer:coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: !isCoarse, alpha: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
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
let actx; const sfx = (f, d = 0.08, type = 'square', v = 0.05) => {
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
  step = 0; picks = []; $('selTitle').textContent = mode === 'p2' ? 'Player 1: choose your fighter' : 'Choose your fighter';
  $('randBtn').classList.toggle('hidden', false);
  buildMapChips(); $('maps').classList.toggle('hidden', mode === 'online' && localSlot === 1);
  ['banner', 'fsBtn', 'ad', 'pause', 'rotate'].forEach((i) => show(i, false)); paused = false; $('combo').textContent = '';
  setPreview(0, null); setPreview(1, null); previewRoot.visible = true; clearFighters(); phase = 'menu';
}
$('btn1p').onclick = () => { mode = 'ai'; openSelect(); };
$('btn2p').onclick = () => { mode = '2p'; openSelect(); };
$('randBtn').onclick = () => choose(defs[(Math.random() * defs.length) | 0]);
$('diff').onchange = (e) => (diff = +e.target.value);
function goMenu() {
  stopLobby();
  if (mode === 'online') { net.close(); net = new Net(); }
  mode = 'ai'; phase = 'menu'; clearFighters(); previewRoot.visible = true; setPreview(0, null); setPreview(1, null); paused = false;
  ['select', 'hud', 'touch', 'endbar', 'pause', 'online', 'banner', 'fsBtn', 'rotate', 'ad'].forEach((i) => show(i, false)); show('menu');
}
$('btnMenu').onclick = $('menuBtn2').onclick = goMenu;
$('rematch').onclick = () => {
  if (mode !== 'online') return startMatch();
  myRematch = true; net.send({ t: 'rematch' }); $('rematch').textContent = 'WAITING…'; tryRematch();
};

function changeFighter() {
  if (mode === 'online') { net.send({ t: 'reselect' }); myPick = theirPick = null; myRematch = theirRematch = false; $('rematch').textContent = 'REMATCH'; }
  openSelect();
}
$('changeBtn').onclick = changeFighter;
$('pRematch').onclick = () => { paused = false; show('pause', false); startMatch(); };
$('pChange').onclick = () => { paused = false; show('pause', false); changeFighter(); };

/* ---------- online (lockstep: both browsers run the same deterministic sim, only inputs are exchanged) ---------- */
const DELAY = 4; // input delay in ticks (~67ms); higher = smoother on bad connections
let net = new Net(), localSlot = 0, myPick = null, theirPick = null, myRematch = false, theirRematch = false;
let simTick = 0, localBuf = {}, remoteBuf = {};
const sampleLocal = combine(keyboardInput(KEYMAPS.p1, KEYMAPS.p2), touchInput());
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
  rooms.forEach((r) => { const b = document.createElement('button'); b.textContent = `${String(r.name || 'Player').slice(0, 14)}'s game   ▶ JOIN`; b.onclick = () => joinCode(r.code); box.append(b); });
}
async function startLobby() {
  stopLobby(); const tok = ++lobbyTok; $('rooms').textContent = 'Looking for games…';
  const gid = await groupId(); if (tok !== lobbyTok) return;
  lobby = new Lobby('brawl-lobby-' + gid, renderRooms); lobby.start();
}
function stopLobby() { lobbyTok++; if (lobby) { lobby.stop(); lobby = null; } hostingCode = null; }
$('btnOnline').onclick = () => {
  show('menu', false); show('online'); setStatus(''); show('hostBtn'); show('cancelHost', false);
  try { $('pname').value = localStorage.getItem('brawl-name') || ''; } catch (e) {}
  startLobby();
};
$('onBack').onclick = () => { stopLobby(); net.close(); net = new Net(); show('online', false); show('menu'); };
$('cancelHost').onclick = () => { net.close(); net = new Net(); hostingCode = null; if (lobby) lobby.setRoom(null); show('cancelHost', false); show('hostBtn'); setStatus(''); };
function wireNet() {
  net.onmsg = (m) => {
    if (m.t === 'in') remoteBuf[m.k] = unpackInput(m.v);
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
  mode = 'online'; localSlot = slot; myPick = theirPick = null; myRematch = theirRematch = false; wireNet();
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
async function joinCode(code) {
  net.close(); net = new Net(); mode = 'ai'; setStatus('Joining…');
  try { await net.join(code); beginOnline(1); }
  catch (e) { setStatus(e.message || 'Could not join.'); }
}
$('joinBtn').onclick = () => { const code = $('code').value; if (code.trim().length < 4) return setStatus('Enter the code from your friend.'); joinCode(code); };
function tryStartOnline() {
  if (!(myPick && theirPick)) return;
  picks = localSlot === 0 ? [myPick, theirPick] : [theirPick, myPick]; startMatch();
}
function tryRematch() { if (myRematch && theirRematch) { myRematch = theirRematch = false; $('rematch').textContent = 'REMATCH'; startMatch(); } }

/* ---------- match ---------- */
let fighters = [], projectiles = [], wins = [0, 0], round = 1, phase = 'menu', pt = 0, timer = 99 * 60, paused = false, flawless = [true, true];
const BOUNDS = 5.2, game = { bounds: BOUNDS };
const coarse = matchMedia('(pointer:coarse)').matches;
setupTouch();

function clearFighters() { clearHelpers(); fighters.forEach((f) => { scene.remove(f.rig.root); if (f.helperRig) scene.remove(f.helperRig.root); }); fighters = []; projectiles.forEach((p) => scene.remove(p.mesh)); projectiles = []; }

function startMatch() {
  show('select', false); show('menu', false); show('endbar', false); previewRoot.visible = false; clearFighters(); rngSeed = 0x9e3779b9; if (mode !== 'online') stage.setMap(resolveMap());
  const kb1 = mode === 'ai' ? combine(keyboardInput(KEYMAPS.p1, KEYMAPS.p2), touchInput()) : keyboardInput(KEYMAPS.p1);
  fighters = [
    new Fighter(picks[0], makeRig(picks[0]), 0, kb1),
    new Fighter(picks[1], makeRig(picks[1]), 1, mode === 'p2' ? keyboardInput(KEYMAPS.p2) : null),
  ];
  if (mode === 'ai') fighters[1].getInput = makeAI(fighters[1], fighters[0], diff);
  if (mode === 'online') { // each tick's inputs come from the exchanged buffers
    simTick = 0; localBuf = {}; remoteBuf = {}; acc = 0;
    for (let t = 0; t < DELAY; t++) { localBuf[t] = EMPTY(); remoteBuf[t] = EMPTY(); }
    fighters.forEach((f, i) => (f.getInput = () => (i === localSlot ? localBuf : remoteBuf)[simTick] || EMPTY()));
  }
  fighters.forEach((f) => { f.rig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(f.rig.root); });
  $('n0').textContent = picks[0].name; $('n1').textContent = mode === 'ai' ? picks[1].name + ' (CPU)' : picks[1].name;
  wins = [0, 0]; round = 1; flawless = [true, true];
  show('hud'); show('touch', coarse && mode !== 'p2'); show('rematch'); $('rematch').textContent = 'REMATCH'; paused = false; show('pause', false);
  prewarmHelpers(); scheduleAds(); newRound(); show('fsBtn'); maybeRotateHint();
}
function tipsHtml() {
  const k = (a, b) => `<b>${a}</b> ${b}`;
  if (coarse) return `<h4>CONTROLS</h4>Pad (left): move, up = jump (tap up again in the air = double jump), down = crouch<br>${k('LP/HP', 'punch')} · ${k('LK/HK', 'kick')} · ${k('BLOCK', 'guard')} · ${k('RUN', '+ forward')}<br>${k('down + HP', 'uppercut')} · ${k('down + LK', 'sweep')}<br>${k('SPECIAL', 'ranged shot')} · ${k('ULT', 'when the SUPER bar is full')}<br><small>Duck high shots, jump low ones. Ultimates can't be blocked.</small>`;
  const p2 = mode === '2p' ? `<br><b>P2:</b> arrows move · U/I punch · J/K kick · L block · O run · <b>P</b> special · <b>;</b> ultimate` : '';
  return `<h4>CONTROLS</h4><b>${mode === '2p' ? 'P1: ' : ''}</b>A/D walk · W jump (<b>W again = double jump</b>) · S crouch<br>${k('F/G', 'low/high punch')} · ${k('C/V', 'low/high kick')}<br>${k('Shift', 'block')} · ${k('X', 'run (+ forward)')}<br>${k('S + G', 'uppercut')} · ${k('S + C', 'sweep')}<br>${k('E', 'RANGED SPECIAL')} <small>(or down, forward + F/G)</small><br>${k('R', 'ULTIMATE')} <small>(or down, forward + V) when the blue SUPER bar is full</small>${p2}<br><small>Chain light attacks: after one connects, press a different attack to cancel into it. Duck high shots, jump low ones. Ultimates can't be blocked. Esc = this menu.</small>`;
}

function newRound() {
  hitstop = 0; clearHelpers();
  projectiles.forEach((p) => scene.remove(p.mesh)); projectiles = [];
  fighters[0].reset(-2); fighters[1].reset(2);
  timer = 99 * 60; phase = 'intro'; pt = 0; banner(`ROUND ${round}`);
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
  const seq = [['lp'], ['lp'], ['hp'], ['lk'], ['hk'], ['d', 'lk'], ['lp'], ['hp'], ['d', 'hp']];
  let i = 0, cool = 15, hold = 0, press = null;
  return () => {
    const o = EMPTY(), opp = fighters[1 - owner.side], dx = Math.abs(opp.x - h.x), fwd = h.face > 0 ? 'r' : 'l';
    if (hold > 0) { hold--; if (press) for (const k of press) o[k] = 1; return o; }
    if (cool > 0) cool--;
    if (dx > 1.45) { o[fwd] = 1; if (dx > 3) o.run = 1; if (dx > 3.4 && cool === 0 && h.fbCooldown === 0) { press = ['sp']; hold = 2; cool = 40; } }
    else if (cool === 0) { press = seq[i++ % seq.length]; hold = 2; cool = 12 + (press.length > 1 ? 14 : 8); }
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
  hf.getInput = makeHelperInput(hf, f); hf.power = cfg.power ?? 0.7; hf.inv = 999999; hf.x = f.x - f.face * 0.9; hf.face = f.face;
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
game.onUlt = (f) => { // mostly cosmetic; the optional summon is part of the sim (seeded RNG)
  const summoned = trySummon(f);
  ultT = 70; banner((f.def.ultimate?.name || 'ULTIMATE').toUpperCase() + '!', summoned ? summoned + ' SHOWS UP TO HELP!' : ''); stage.shake += 0.7; sfx(80, 0.6, 'sawtooth', 0.12);
  const el = $('flash'); el.style.transition = 'none'; el.style.opacity = 0.85; requestAnimationFrame(() => { el.style.transition = 'opacity .7s'; el.style.opacity = 0; });
};
game.tryHit = (att, def, m) => {
  if (def.inv > 0 || phase !== 'fight') return false;
  if (def.state === 'down' || def.state === 'getup') return false;
  const y0 = att.y + m.y[0], y1 = att.y + m.y[1], h0 = def.y, h1 = def.y + (def.crouching ? 1.25 : 1.95);
  if (y1 < h0 || y0 > h1) return false;
  const a = att.x, b = att.x + att.face * m.reach;
  if (Math.min(a, b) - 0.3 > def.x || Math.max(a, b) + 0.3 < def.x) return false;
  const r = def.receive(att, m, game);
  hitstop = Math.max(hitstop, r === 'block' ? 2 : Math.min(7, 2 + Math.round(m.dmg / 3)));
  if (Math.abs(def.x) >= game.bounds - 0.05) att.vx = -att.face * ((m.kb || 0.05) + 0.04); // cornered: attacker gets pushed back instead
  sfx(r === 'block' ? 120 : 200, 0.09, r === 'block' ? 'triangle' : 'square', r === 'block' ? 0.05 : 0.09);
  const hx = def.x - att.face * 0.25, hy = Math.max(0.4, def.y + (m.y[0] + m.y[1]) / 2 - att.y);
  if (r === 'block') stage.spark(hx, hy, 5, 0x9ab8ff, 0.7);
  else { stage.spark(hx, hy, 8 + Math.round(m.dmg), m.launch || m.knock ? 0xff8a3a : 0xffd070, 0.8 + m.dmg / 14); stage.shake = Math.min(0.9, stage.shake + m.dmg / 14); }
  return true;
};

function step60() {
  if (phase === 'intro') {
    pt++;
    if (pt === 60) banner('FIGHT!'); if (pt === 100) { banner(''); phase = 'fight'; }
    return;
  }
  const none = EMPTY();
  const [a, b] = fighters;
  if (ultT > 0 && --ultT === 0 && phase === 'fight') banner('');
  if (phase === 'fight') { if (hitstop > 0) { hitstop--; a.poll(); b.poll(); } else { timer--; a.update(b, game); b.update(a, game); updateHelpers(); } }
  else { a.update(b, game, none); b.update(a, game, none); }
  // separation
  if (a.grounded && b.grounded && Math.abs(a.x - b.x) < 0.7) {
    const push = (0.7 - Math.abs(a.x - b.x)) / 2, s = a.x <= b.x ? 1 : -1;
    a.x -= push * s; b.x += push * s;
  }
  // projectiles
  for (const p of projectiles) {
    p.x += p.dir * p.speed; p.mesh.position.x = p.x;
    if (Math.random() < (p.ult ? 1 : 0.6)) stage.spark(p.x - p.dir * 0.3, p.py + (Math.random() - 0.5) * (p.ult ? 1.2 : 0), p.ult ? 2 : 1, p.color, p.ult ? 0.9 : 0.5); // cosmetic only
    const t = fighters[1 - p.owner.side], top = t.y + (t.crouching ? 1.25 : 1.95);
    if (phase === 'fight' && Math.abs(p.x - t.x) < 0.45 + (p.ult ? 0.3 : 0) && p.py + p.hh >= t.y && p.py - p.hh <= top && t.inv === 0 && t.state !== 'down' && t.state !== 'getup') {
      p.dead = true; stage.spark(p.x, p.py, p.ult ? 40 : 22, p.ult ? 0xffffff : 0xff9a3a, p.ult ? 2 : 1.4); stage.shake += p.ult ? 1 : 0.5;
      hitstop = Math.max(hitstop, p.ult ? 8 : 4);
      t.receive(p.owner, { dmg: p.dmg, kb: p.ult ? 0.2 : 0.1, hs: 22, bs: 14, knock: true, low: p.low, unblockable: p.unblockable }, game); sfx(160, 0.15, 'sawtooth', 0.09);
    }
    if (Math.abs(p.x) > 12) p.dead = true;
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
    if (matchWinner >= 0) { phase = 'over'; show('endbar'); return; }
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
  if (phase === 'menu') {
    previewRoot.children.forEach((g, i) => { g.rotation.y = Math.sin(now / 900 + i) * 0.8; }); preview.forEach((r) => r && updateFace(r, 1));
    frameCamera(0, 0, 3, 2.3);
  } else {
    if (!paused) {
      acc = Math.min(acc + dt, 0.25);
      while (acc >= 1 / 60 && fighters.length) {
        if (mode === 'online') {
          if (!remoteBuf[simTick]) break; // stall until the opponent's input for this tick arrives
          const inp = sampleLocal(); localBuf[simTick + DELAY] = inp; net.send({ t: 'in', k: simTick + DELAY, v: packInput(inp) });
        }
        acc -= 1 / 60; step60();
        if (mode === 'online') { delete localBuf[simTick]; delete remoteBuf[simTick]; simTick++; }
      }
    }
    if (fighters.length) {
      const [a, b] = fighters;
      const alpha = paused || hitstop > 0 ? 1 : Math.min(1, acc * 60);
      fighters.forEach((f) => poseUpdate(f, alpha, dt)); helpers.forEach((h) => poseUpdate(h.f, alpha, dt));
      frameCamera((a.x + b.x) / 2, Math.abs(a.x - b.x), dt * 60);
      setW('hp0', Math.max(0, (a.hp / a.maxHp) * 100)); setW('hp1', Math.max(0, (b.hp / b.maxHp) * 100));
      [a, b].forEach((f, i) => { setW('m' + i, Math.min(100, f.meter)); const full = f.meter >= 100; if (cache['full' + i] !== full) { cache['full' + i] = full; $('m' + i).parentElement.classList.toggle('full', full); } });
      const bk = helpers.map((h) => `${h.label} · ${Math.ceil(h.life / 60)}s`).join('   '); setT('backup', bk); if (cache.bkv !== !!bk) { cache.bkv = !!bk; $('backup').classList.toggle('hidden', !bk); }
      setT('timer', String(Math.max(0, Math.ceil(timer / 60))));
    }
  }
  if (phase === 'fight' && !paused && !adOpen() && now > nextAdAt) showAd();
  if (phase !== 'fight' && phase !== 'intro' && phase !== 'end' && adOpen()) show('ad', false);
  stage.update(now, dt);
  const sh = stage.shake * 0.14, ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
  cam.position.x += ox; cam.position.y += oy; renderer.render(scene, cam); cam.position.x -= ox; cam.position.y -= oy;
}
const openPause = () => {
  if (!['fight', 'intro', 'end', 'over'].includes(phase)) return;
  const online = mode === 'online'; if (!online) paused = true;
  $('pauseTips').innerHTML = tipsHtml() + (online ? '<br><small>Online: the match keeps running while this menu is open.</small>' : '');
  show('pRematch', !online); show('pChange', !online); $('btnMenu').textContent = 'QUIT TO MENU'; show('pause');
};
const closePause = () => { paused = false; show('pause', false); };
addEventListener('keydown', (e) => {
  if (e.code === 'F3') { e.preventDefault(); showFps = !showFps; show('fps', showFps); }
  if (e.code === 'Escape') { if (!$('pause').classList.contains('hidden')) closePause(); else openPause(); }
});
$('resume').onclick = closePause;
$('pauseBtn').onclick = openPause;

const V = 16;
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
window.__game = { get fighters() { return fighters; }, get phase() { return phase; }, get tick() { return simTick; } };
