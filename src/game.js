import * as THREE from 'three';
import { buildCharacter, applyPose } from './model.js';
import { Fighter, MOVES } from './fighter.js';
import { makeAI } from './ai.js';
import { EMPTY, KEYMAPS, keyboardInput, touchInput, combine, setupTouch } from './input.js';
import { Net, packInput, unpackInput } from './net.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);

/* ---------- three.js stage ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, alpha: true });
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x443355, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 6, 6); sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 6, bottom: -2 }); sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 14), new THREE.MeshStandardMaterial({ color: 0x2b2233, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(60, 60, 0x6a4a7a, 0x3a2f48); grid.position.y = 0.01; scene.add(grid);
const moon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffe9c0 })); moon.position.set(0, 6, -16); scene.add(moon);
for (let i = -6; i <= 6; i++) { // pillars
  const h = 4 + ((i * 37) % 3 + 3) * 0.7;
  const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), new THREE.MeshStandardMaterial({ color: 0x3b2f4a, emissive: 0x1a0f26 }));
  p.position.set(i * 4, h / 2, -9 - (i % 2) * 2); scene.add(p);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h, false);
  cam.aspect = w / h; cam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

function frameCamera(cx, spread, k = 1) {
  const halfW = Math.max(3.4, spread / 2 + 2.2), t = Math.tan((cam.fov * Math.PI) / 360);
  const z = Math.max(halfW / (t * cam.aspect), 1.8 / t);
  cam.position.x += (cx - cam.position.x) * 0.1 * k; cam.position.y = 1.5; cam.position.z += (z - cam.position.z) * 0.1 * k;
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
  const ids = await (await fetch('characters/index.json')).json();
  defs = await Promise.all(ids.map(async (id) => ({ id, ...(await (await fetch(`characters/${id}.json`)).json()) })));
}
const css = (c) => (typeof c === 'string' ? c : '#' + c.toString(16).padStart(6, '0'));

/* ---------- menu & select ---------- */
let mode = 'ai', diff = 1, picks = [], step = 0, preview = [null, null];
const previewRoot = new THREE.Group(); scene.add(previewRoot);
function setPreview(slot, def) {
  if (preview[slot]) previewRoot.remove(preview[slot].root);
  preview[slot] = def ? buildCharacter(def) : null;
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
  if (mode === 'online') { myPick = d; net.send({ t: 'pick', id: d.id }); setPreview(0, d); $('selTitle').textContent = 'Waiting for opponent to choose…'; tryStartOnline(); return; }
  picks[step] = d;
  if (step === 0) { step = 1; $('selTitle').textContent = mode === 'ai' ? 'Choose your opponent' : 'Player 2: choose your fighter'; setPreview(1, null); }
  else startMatch();
}
function openSelect() {
  show('menu', false); show('select'); show('hud', false); show('touch', false); show('endbar', false);
  step = 0; picks = []; $('selTitle').textContent = mode === 'p2' ? 'Player 1: choose your fighter' : 'Choose your fighter';
  $('randBtn').classList.toggle('hidden', false);
  setPreview(0, null); setPreview(1, null); previewRoot.visible = true; fighters.forEach((f) => scene.remove(f.rig.root)); fighters = []; phase = 'menu';
}
$('btn1p').onclick = () => { mode = 'ai'; openSelect(); };
$('btn2p').onclick = () => { mode = '2p'; openSelect(); };
$('randBtn').onclick = () => choose(defs[(Math.random() * defs.length) | 0]);
$('diff').onchange = (e) => (diff = +e.target.value);
function goMenu() {
  if (mode === 'online') { net.close(); net = new Net(); }
  mode = 'ai'; phase = 'menu'; clearFighters(); previewRoot.visible = true; setPreview(0, null); setPreview(1, null); paused = false;
  ['select', 'hud', 'touch', 'endbar', 'pause', 'online', 'banner'].forEach((i) => show(i, false)); show('menu');
}
$('btnMenu').onclick = $('menuBtn2').onclick = goMenu;
$('rematch').onclick = () => {
  if (mode !== 'online') return startMatch();
  myRematch = true; net.send({ t: 'rematch' }); $('rematch').textContent = 'WAITING…'; tryRematch();
};

/* ---------- online (lockstep: both browsers run the same deterministic sim, only inputs are exchanged) ---------- */
const DELAY = 4; // input delay in ticks (~67ms); higher = smoother on bad connections
let net = new Net(), localSlot = 0, myPick = null, theirPick = null, myRematch = false, theirRematch = false;
let simTick = 0, localBuf = {}, remoteBuf = {};
const sampleLocal = combine(keyboardInput(KEYMAPS.p1, KEYMAPS.p2), touchInput());
const setStatus = (t) => ($('onStatus').textContent = t);
$('btnOnline').onclick = () => { show('menu', false); show('online'); setStatus(''); };
$('onBack').onclick = () => { net.close(); net = new Net(); show('online', false); show('menu'); };
function wireNet() {
  net.onmsg = (m) => {
    if (m.t === 'in') remoteBuf[m.k] = unpackInput(m.v);
    else if (m.t === 'pick') { theirPick = defs.find((d) => d.id === m.id) || null; tryStartOnline(); }
    else if (m.t === 'rematch') { theirRematch = true; tryRematch(); }
  };
  net.onclose = () => {
    if (mode !== 'online') return;
    banner('OPPONENT LEFT'); show('online', false); setTimeout(goMenu, 2500);
  };
}
function beginOnline(slot) {
  mode = 'online'; localSlot = slot; myPick = theirPick = null; myRematch = theirRematch = false; wireNet();
  show('online', false); openSelect(); mode = 'online'; // openSelect resets title; keep mode
  $('selTitle').textContent = `Choose your fighter (you are ${slot ? 'Player 2, right' : 'Player 1, left'})`;
}
$('hostBtn').onclick = async () => {
  net.close(); net = new Net(); mode = 'ai'; setStatus('Connecting…');
  try { await net.host((c) => setStatus(`Your code: ${c}  — send it to your friend and wait…`)); beginOnline(0); }
  catch (e) { setStatus('Could not start: ' + (e.message || e)); }
};
$('joinBtn').onclick = async () => {
  const code = $('code').value; if (code.trim().length < 4) return setStatus('Enter the code from your friend.');
  net.close(); net = new Net(); mode = 'ai'; setStatus('Joining…');
  try { await net.join(code); beginOnline(1); }
  catch (e) { setStatus(e.message || 'Could not join.'); }
};
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

function clearFighters() { fighters.forEach((f) => scene.remove(f.rig.root)); fighters = []; projectiles.forEach((p) => scene.remove(p.mesh)); projectiles = []; }

function startMatch() {
  show('select', false); show('menu', false); show('endbar', false); previewRoot.visible = false; clearFighters();
  const kb1 = mode === 'ai' ? combine(keyboardInput(KEYMAPS.p1, KEYMAPS.p2), touchInput()) : keyboardInput(KEYMAPS.p1);
  fighters = [
    new Fighter(picks[0], buildCharacter(picks[0]), 0, kb1),
    new Fighter(picks[1], buildCharacter(picks[1]), 1, mode === 'p2' ? keyboardInput(KEYMAPS.p2) : null),
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
  newRound();
}
function newRound() {
  projectiles.forEach((p) => scene.remove(p.mesh)); projectiles = [];
  fighters[0].reset(-2); fighters[1].reset(2);
  timer = 99 * 60; phase = 'intro'; pt = 0; banner(`ROUND ${round}`);
  [0, 1].forEach((i) => { $('p' + i).textContent = '●'.repeat(wins[i]) + '○'.repeat(2 - wins[i]); });
}
function banner(t, sub = '') { $('banner').innerHTML = t + (sub ? `<small>${sub}</small>` : ''); show('banner', !!t); }

game.spawnProjectile = (f) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshBasicMaterial({ color: css(f.def.special?.color ?? '#ff7a1a') }));
  mesh.add(new THREE.PointLight(css(f.def.special?.color ?? '#ff7a1a'), 2, 4));
  mesh.position.set(f.x + f.face * 0.8, 1.35, 0); scene.add(mesh);
  projectiles.push({ owner: f, mesh, x: f.x + f.face * 0.8, dir: f.face, dmg: MOVES.fb.dmg });
  f.fbCooldown = 50; sfx(300, 0.2, 'sawtooth');
};
game.tryHit = (att, def, m) => {
  if (def.inv > 0 || phase !== 'fight') return false;
  if (def.state === 'down' || def.state === 'getup') return false;
  const y0 = att.y + m.y[0], y1 = att.y + m.y[1], h0 = def.y, h1 = def.y + (def.crouching ? 1.25 : 1.95);
  if (y1 < h0 || y0 > h1) return false;
  const a = att.x, b = att.x + att.face * m.reach;
  if (Math.min(a, b) - 0.3 > def.x || Math.max(a, b) + 0.3 < def.x) return false;
  const r = def.receive(att, m, game);
  sfx(r === 'block' ? 120 : 200, 0.09, r === 'block' ? 'triangle' : 'square', r === 'block' ? 0.05 : 0.09);
  return true;
};

function step60() {
  if (phase === 'intro') {
    pt++; fighters.forEach((f) => poseUpdate(f));
    if (pt === 60) banner('FIGHT!'); if (pt === 100) { banner(''); phase = 'fight'; }
    return;
  }
  const none = EMPTY();
  const [a, b] = fighters;
  if (phase === 'fight') { timer--; a.update(b, game); b.update(a, game); }
  else { a.update(b, game, none); b.update(a, game, none); }
  // separation
  if (a.grounded && b.grounded && Math.abs(a.x - b.x) < 0.7) {
    const push = (0.7 - Math.abs(a.x - b.x)) / 2, s = a.x <= b.x ? 1 : -1;
    a.x -= push * s; b.x += push * s;
  }
  // projectiles
  for (const p of projectiles) {
    p.x += p.dir * 0.12; p.mesh.position.x = p.x;
    const t = p.owner === a ? b : a;
    if (phase === 'fight' && Math.abs(p.x - t.x) < 0.45 && t.y < 1.9 && t.inv === 0 && t.state !== 'down' && t.state !== 'getup') {
      p.dead = true; t.receive(p.owner, { dmg: p.dmg, kb: 0.1, hs: 22, bs: 14, knock: true }, game); sfx(160, 0.15, 'sawtooth', 0.09);
    }
    if (Math.abs(p.x) > 12) p.dead = true;
  }
  projectiles = projectiles.filter((p) => { if (p.dead) scene.remove(p.mesh); return !p.dead; });
  fighters.forEach(poseUpdate);

  // combo + HUD
  const hits = Math.max(a.comboHits, b.comboHits);
  $('combo').textContent = hits >= 2 ? `${hits} HIT COMBO` : '';

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
function poseUpdate(f) {
  const st = f.state;
  applyPose(f.rig, st === 'win' ? 'win' : f.poseName(), f.u, st === 'attack' ? 0.5 : 0.35);
  f.rig.root.position.set(f.x, f.y, 0);
  f.rig.root.rotation.y = f.face * Math.PI / 2;
}

/* ---------- main loop ---------- */
let last = performance.now(), acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (phase === 'menu') {
    previewRoot.children.forEach((g, i) => { g.rotation.y = now / 1000; });
    frameCamera(0, 3, 3);
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
      frameCamera((a.x + b.x) / 2, Math.abs(a.x - b.x));
      $('hp0').style.width = Math.max(0, (a.hp / a.maxHp) * 100) + '%';
      $('hp1').style.width = Math.max(0, (b.hp / b.maxHp) * 100) + '%';
      $('timer').textContent = Math.max(0, Math.ceil(timer / 60));
    }
  }
  renderer.render(scene, cam);
}
addEventListener('keydown', (e) => { if (e.code === 'Escape' && mode !== 'online' && ['fight', 'intro', 'end'].includes(phase)) { paused = !paused; show('pause', paused); } });
$('resume').onclick = () => { paused = false; show('pause', false); };
$('pauseBtn').onclick = () => { if (mode === 'online') return goMenu(); paused = true; show('pause', true); }; // online: no pause, button quits

loadCharacters().then(() => { buildSelect(); show('loading', false); show('menu'); requestAnimationFrame(loop); })
  .catch((e) => { $('loading').textContent = 'Failed to load characters. Run the game through a web server (see README). ' + e; });
window.__game = { get fighters() { return fighters; }, get phase() { return phase; }, get tick() { return simTick; } };
