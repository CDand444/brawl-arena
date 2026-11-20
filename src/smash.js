import * as THREE from 'three';

/* ======================================================================================
   SMASH mode: up to 4 fighters, free-for-all, floating platforms, damage % + launches,
   lives (stocks), ring-outs. Local (keyboards / gamepads / touch), CPU, and online rooms.
   Everything inside step() is part of the lockstep simulation: deterministic only
   (seeded RNGs, no Math.random / Date.now / trig). Rendering and HUD are cosmetic.
   ====================================================================================== */

const COLORS = ['#ff4a4a', '#4aa8ff', '#ffd02a', '#5aff8a'];
const MAIN = 9.1;                                      // main stage half-width
const BZ = { x: 21.5, top: 13.5, bottom: -8 };         // blast zones
const PLATS = [
  { x0: -MAIN, x1: MAIN, y: 0, soft: false },          // main stage (solid)
  { x0: -7, x1: -2.9, y: 2.7, soft: true },            // floating platforms (jump up through, tap down to drop)
  { x0: 2.9, x1: 7, y: 2.7, soft: true },
  { x0: -2.1, x1: 2.1, y: 5.2, soft: true },
];
const SPAWN = [-6.5, 6.5, -2.6, 2.6], RESPAWN = [-3.9, 3.9, -1.3, 1.3];
const SPECIALS = { fireball: { py: 1.35, speed: 0.12, dmg: 10, size: 0.28 }, low: { py: 0.45, speed: 0.14, dmg: 8, size: 0.3, low: true }, fast: { py: 1.35, speed: 0.2, dmg: 7, size: 0.22 } };
const TYPES = [['kb1', 'Keyboard 1 (WASD)'], ['kb2', 'Keyboard 2 (arrows)'], ['gp0', 'Gamepad 1'], ['gp1', 'Gamepad 2'], ['gp2', 'Gamepad 3'], ['gp3', 'Gamepad 4'], ['touch', 'Touch screen'], ['cpu0', 'CPU Easy'], ['cpu1', 'CPU Normal'], ['cpu2', 'CPU Hard'], ['off', 'Off']];
const ROOM_TYPES = ['open', 'cpu0', 'cpu1', 'cpu2'];
const D = 6;                                           // online input delay (ticks); a little higher than 1v1 because inputs relay through the host
const mulberry = (seed) => { let s = seed | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hex = (c) => parseInt(String(c).replace('#', ''), 16);
const css = (c) => (typeof c === 'string' ? c : '#' + (c >>> 0).toString(16).padStart(6, '0'));

export function createSmash(ctx) {
  const { $, show, scene, cam, stage, sfx, banner } = ctx;
  const I = ctx.inp;

  /* ---------------- local setup state ---------------- */
  let slots = [{ type: ctx.coarse ? 'touch' : 'kb1', char: null }, { type: 'cpu1', char: null }, { type: 'cpu1', char: null }, { type: 'off', char: null }];
  let stocks = 3;

  /* ---------------- match state ---------------- */
  let active = false, cfg = null, fighters = [], helpers = [], projectiles = [], phase = 'idle', pt = 0, hitstop = 0, acc = 0, sUlt = 0, places = [], platG = null, wasCut = false;
  let rand = Math.random, aiRand = Math.random;

  /* ---------------- online state ---------------- */
  let stallSince = 0, stallShown = false;
  let room = null, rs = null, mySlot = 0, online = false, tick = 0, epoch = 0, inBuf = {}, future = {}, humans = [], myInput = null, hostEpoch = 0;

  const defs = () => ctx.defs();
  const defaultChar = (i) => { const d = defs(); return d[i % d.length].id; };
  const note = (t) => { $('sNote').textContent = t || ''; };

  /* ==================================== simulation helpers ==================================== */
  const isTarget = (t) => !t.out && t.respawnT === 0 && t.inv === 0 && t.state !== 'getup' && !(t.state === 'down' && t.grounded);
  function nearest(f) {
    const own = f.owner || f; let best = null, bd = Infinity;
    for (const o of fighters) { if (o === own || o.out || o.respawnT > 0) continue; const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y) * 0.6; if (d < bd) { bd = d; best = o; } }
    return best;
  }
  const onPlat = (f, p) => f.x >= p.x0 - 0.15 && f.x <= p.x1 + 0.15;
  const G = {
    smash: true, bounds: 999,
    rand: () => rand(),
    floorBelow(f, prevY) {
      let best = null;
      for (const p of PLATS) { if (!onPlat(f, p) || (p.soft && f.dropT > 0)) continue; if (prevY >= p.y - 1e-6 && f.y <= p.y && (best === null || p.y > best)) best = p.y; }
      return best;
    },
    supportAt(f) { return PLATS.some((p) => onPlat(f, p) && Math.abs(f.y - p.y) < 1e-4 && !(p.soft && f.dropT > 0)); },
    onSoft(f) { return PLATS.some((p) => p.soft && onPlat(f, p) && Math.abs(f.y - p.y) < 1e-4); },
    tryHit(att, _opp, m) {
      if (phase !== 'fight') return false;
      const own = att.owner || att; let any = false;
      for (const t of fighters) {
        if (t === own || !isTarget(t)) continue;
        const y0 = att.y + m.y[0], y1 = att.y + m.y[1], h0 = t.y, h1 = t.y + (t.crouching ? 1.25 : 1.95);
        if (y1 < h0 || y0 > h1) continue;
        const a = att.x, b = att.x + att.face * m.reach;
        if (Math.min(a, b) - 0.3 > t.x || Math.max(a, b) + 0.3 < t.x) continue;
        const r = t.receive(att, m, G); any = true;
        if (!att.helper) hitstop = Math.max(hitstop, r === 'block' ? 2 : Math.min(7, 2 + Math.round(m.dmg / 3)));
        sfx(r === 'block' ? 120 : 200, 0.09, r === 'block' ? 'triangle' : 'square', r === 'block' ? 0.05 : 0.09); // cosmetic
        stage.spark(t.x - att.face * 0.25, t.y + 1.2, r === 'block' ? 5 : 8 + Math.round(m.dmg), r === 'block' ? 0x9ab8ff : 0xffd070, 0.8 + m.dmg / 14);
        if (r !== 'block') stage.shake = Math.min(0.9, stage.shake + m.dmg / 14);
      }
      return any;
    },
    spawnProjectile(f, kind) {
      const ult = kind === 'ult', sp = ult ? { py: 1.1, speed: 0.26, dmg: ctx.MOVES.ult.dmg, size: 0.7 } : (SPECIALS[f.def.special?.type] || SPECIALS.fireball);
      const color = css(ult ? (f.def.ultimate?.color ?? f.def.special?.color ?? '#ffffff') : (f.def.special?.color ?? '#ff7a1a'));
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(sp.size, 16, 12), new THREE.MeshBasicMaterial({ color })); mesh.add(stage.glow(color, ult ? 7 : 2.6));
      if (ult) mesh.scale.set(1.8, 1.2, 1);
      const x = f.x + f.face * 0.8; mesh.position.set(x, f.y + sp.py, 0); scene.add(mesh);
      projectiles.push({ owner: f.owner || f, src: f, x, px: x, y: f.y + sp.py, dir: f.face, dmg: sp.dmg, speed: sp.speed, hh: ult ? 1.0 : 0.22, low: !!sp.low, ult, mesh, color: ult ? 0xffffff : 0xffb060, dead: false });
      if (!ult) f.fbCooldown = 50;
      sfx(ult ? 150 : 300, ult ? 0.5 : 0.2, 'sawtooth', ult ? 0.12 : 0.05);
    },
    onUlt(f) { // no cutscene in Smash: just a quick banner + flash, the match keeps moving
      const label = trySummon(f), u = f.def.ultimate || {};
      banner(`P${f.slot + 1} ${(u.name || 'ULTIMATE').toUpperCase()}!`, label ? label + ' SHOWS UP TO HELP!' : ''); sUlt = 90;
      stage.shake += 0.6; sfx(80, 0.6, 'sawtooth', 0.12);
      const el = $('flash'); el.style.transition = 'none'; el.style.opacity = 0.6; requestAnimationFrame(() => { el.style.transition = 'opacity .5s'; el.style.opacity = 0; });
    },
    onDJ(f) { stage.spark(f.x, f.y + 0.15, 8, 0xffffff, 0.6); sfx(520, 0.08, 'triangle', 0.04); },
    onRecover(f) { stage.spark(f.x, f.y + 0.4, 16, 0x9ad8ff, 0.9); sfx(660, 0.12, 'triangle', 0.05); },
  };

  /* ---- summons (Tha Motivator / Black Son In Law): ghost ally that attacks the nearest enemy ---- */
  function helperInput(h) {
    const seq = [['lp'], ['lk'], ['lp'], ['lp'], ['lk']]; let i = 0, cool = 30, hold = 0, press = null;
    return () => {
      const o = I.EMPTY(), t = nearest(h); if (!t) return o;
      const dx = Math.abs(t.x - h.x), fwd = h.face > 0 ? 'r' : 'l';
      if (hold > 0) { hold--; if (press) for (const k of press) o[k] = 1; return o; }
      if (cool > 0) cool--;
      if (dx > 1.45) { o[fwd] = 1; if (dx > 3) o.run = 1; } else if (cool === 0) { press = seq[i++ % seq.length]; hold = 2; cool = 40; }
      if (h.grounded && h.y < 0.05 && ((o.r && h.x > MAIN - 1.1) || (o.l && h.x < -MAIN + 1.1))) { o.l = o.r = 0; o.run = 0; }
      return o;
    };
  }
  function trySummon(f) {
    const sc = f.def.ultimate?.summon; if (!sc) return null;
    if (rand() >= (sc.chance ?? 0.5)) return null;
    const def = defs().find((d) => d.id === sc.id); if (!def) return null;
    helpers = helpers.filter((h) => { if (h.owner === f) { removeHelper(h); return false; } return true; });
    const rig = ctx.makeRig(def); ctx.ghostify(rig); scene.add(rig.root);
    const hf = new ctx.Fighter(def, rig, f.slot, null);
    Object.assign(hf, { helper: true, owner: f, power: sc.power ?? 0.12, inv: 999999, x: f.x - f.face * 0.9, y: f.y, onGround: f.onGround, face: f.face, stageHalf: MAIN });
    hf.px = hf.x; hf.py = hf.y; hf.getInput = helperInput(hf);
    const label = sc.label || def.name; helpers.push({ f: hf, owner: f, life: Math.round((sc.seconds ?? 10) * 60), label });
    return label.toUpperCase();
  }
  function removeHelper(h) { stage.spark(h.f.x, h.f.y + 1, 14, 0x9ad8ff, 0.9); scene.remove(h.f.rig.root); }

  function spawn(f, x, y) {
    const keep = f.meter || 0; f.reset(x); f.meter = keep;
    Object.assign(f, { y, py: y, px: x, vy: 0, onGround: y === 0, face: x <= 0 ? 1 : -1, pct: 0, state: y === 0 ? 'idle' : 'air' });
  }
  function respawn(f) { spawn(f, RESPAWN[f.slot], 6.5); f.inv = 150; f.blink = true; stage.spark(f.x, 7, 20, hex(COLORS[f.slot]), 1); }
  function checkKO(f) {
    if (f.x > -BZ.x && f.x < BZ.x && f.y < BZ.top && f.y > BZ.bottom) return;
    f.stocks--;
    const ex = Math.max(-BZ.x + 1.5, Math.min(BZ.x - 1.5, f.x)), ey = Math.max(BZ.bottom + 1.5, Math.min(BZ.top - 1.5, f.y));
    stage.spark(ex, ey, 50, hex(COLORS[f.slot]), 2.4); stage.shake += 1; sfx(55, 0.6, 'sawtooth', 0.14); // cosmetic
    if (f.stocks <= 0) { f.out = true; places.unshift(f.slot); } else f.respawnT = 75;
    f.vx = f.vy = 0;
  }

  /* ==================================== the 60 Hz step ==================================== */
  function step() {
    if (ctx.cut.active()) { for (const f of fighters) if (!f.out && f.respawnT === 0) f.poll(); ctx.cut.tick(); wasCut = true; return; }
    if (wasCut) { wasCut = false; sUlt = 70; }
    if (sUlt > 0 && --sUlt === 0) banner('');
    if (phase === 'intro') { pt++; if (pt === 50) banner('GO!'); if (pt === 90) { banner(''); phase = 'fight'; } return; }
    const fight = phase === 'fight';
    if (fight && hitstop > 0) { hitstop--; for (const f of fighters) if (!f.out && f.respawnT === 0) f.poll(); return; }
    const E = fight ? undefined : I.EMPTY();
    for (const f of fighters) {
      if (f.out) continue;
      if (f.respawnT > 0) { if (--f.respawnT === 0) respawn(f); continue; }
      f.update(nearest(f) || f, G, E);
      if (f.blink && f.inv === 0) f.blink = false;
    }
    if (fight) {
      for (const h of helpers) { h.f.update(nearest(h.f) || h.owner, G); h.life--; if (h.f.y < BZ.bottom) h.life = 0; }
      helpers.filter((h) => h.life <= 0).forEach(removeHelper); helpers = helpers.filter((h) => h.life > 0);
    }
    for (const f of [...fighters, ...helpers.map((h) => h.f)]) { // the main stage is a solid block: no passing up through it from below
      if (f.y < -0.02 && Math.abs(f.x) < MAIN + 0.3) { f.x = f.x < 0 ? -(MAIN + 0.3) : MAIN + 0.3; f.vx = 0; f.wv = 0; }
    }
    for (const p of projectiles) {
      p.px = p.x; p.x += p.dir * p.speed;
      for (const t of fighters) {
        if (t === p.owner || !isTarget(t)) continue;
        const top = t.y + (t.crouching ? 1.25 : 1.95);
        if (Math.abs(p.x - t.x) < 0.45 + (p.ult ? 0.3 : 0) && p.y + p.hh >= t.y && p.y - p.hh <= top) {
          hitstop = Math.max(hitstop, p.ult ? 8 : 4);
          t.receive(p.src, { dmg: p.dmg, kb: 0.1, hs: 22, bs: 14, knock: true, low: p.low, unblockable: p.ult, noMeter: true, dir: p.dir, y: [0, 0] }, G);
          stage.spark(p.x, p.y, p.ult ? 40 : 22, p.ult ? 0xffffff : 0xff9a3a, p.ult ? 2 : 1.4); stage.shake += p.ult ? 1 : 0.5; sfx(160, 0.15, 'sawtooth', 0.09);
          p.dead = true; break;
        }
      }
      if (Math.abs(p.x) > BZ.x + 4) p.dead = true;
    }
    projectiles = projectiles.filter((p) => { if (p.dead) scene.remove(p.mesh); return !p.dead; });
    if (fight) for (const f of fighters) if (!f.out && f.respawnT === 0) checkKO(f);
    for (const f of fighters) f.offstage = Math.abs(f.x) > MAIN + 0.2 || f.y < -0.25; // for the CPU
    if (fight) {
      const left = fighters.filter((f) => !f.out);
      if (left.length <= 1) {
        phase = 'over'; pt = 0; const w = left[0];
        if (w) places.unshift(w.slot);
        banner(w ? `P${w.slot + 1} ${w.def.name.toUpperCase()} WINS!` : 'DRAW', 'GAME!'); sfx(90, 0.6, 'sawtooth', 0.12);
        if (w) w.state = 'win';
      }
    } else if (phase === 'over' && ++pt === 150) showResults();
  }

  /* ==================================== start / stop ==================================== */
  function devInput(dev, cs) {
    const kb2Used = cs.some((s) => s && s.kind === 'local' && s.dev === 'kb2');
    if (dev === 'kb1') return kb2Used ? I.keyboardInput(I.KEYMAPS.p1) : I.keyboardInput(I.KEYMAPS.p1, I.KEYMAPS.p2);
    if (dev === 'kb2') return I.keyboardInput(I.KEYMAPS.p2);
    if (dev === 'touch') return I.combine(I.touchInput(), I.keyboardInput(I.KEYMAPS.p1));
    if (dev.startsWith('gp')) return I.gamepadInput(+dev[2]);
    return () => I.EMPTY();
  }
  function labelSprite(i) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 80; const g = c.getContext('2d');
    g.font = 'bold 44px Impact, sans-serif'; g.textAlign = 'center'; g.lineWidth = 7; g.strokeStyle = '#000'; g.fillStyle = COLORS[i];
    g.strokeText('P' + (i + 1), 64, 44); g.fillText('P' + (i + 1), 64, 44);
    g.beginPath(); g.moveTo(50, 54); g.lineTo(78, 54); g.lineTo(64, 74); g.closePath(); g.stroke(); g.fill();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true })); s.scale.set(0.9, 0.56, 1); s.position.y = 3.15; s.renderOrder = 10;
    return s;
  }
  function buildPlatforms() {
    platG = new THREE.Group(); scene.add(platG);
    const top = ctx.toonMat(0x6a5a7c), side = ctx.toonMat(0x2f2638), glowM = new THREE.MeshBasicMaterial({ color: 0x9ad8ff });
    for (const p of PLATS) {
      const w = p.x1 - p.x0, cx = (p.x0 + p.x1) / 2;
      if (!p.soft) {
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, 3.4), side); body.position.set(cx, -0.72, 0); body.receiveShadow = true; platG.add(body);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.14, 3.5), top); deck.position.set(cx, -0.07, 0); deck.receiveShadow = true; platG.add(deck);
        const under = new THREE.Mesh(new THREE.ConeGeometry(w * 0.42, 5, 7), side); under.rotation.x = Math.PI; under.position.set(cx, -3.9, 0); platG.add(under);
        for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 3.5), glowM); e.position.set(cx + (s * w) / 2, -0.02, 0); platG.add(e); }
      } else {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 2.2), top); slab.position.set(cx, p.y - 0.09, 0); slab.castShadow = slab.receiveShadow = true; platG.add(slab);
        const g = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 2.2), glowM); g.position.set(cx, p.y - 0.2, 0); platG.add(g);
      }
    }
  }
  function cleanupMatch() {
    fighters.forEach((f) => scene.remove(f.rig.root)); helpers.forEach((h) => scene.remove(h.f.rig.root)); projectiles.forEach((p) => scene.remove(p.mesh));
    fighters = []; helpers = []; projectiles = [];
    if (platG) { scene.remove(platG); platG = null; }
    ctx.cut.clear(); banner(''); active = false; phase = 'idle';
    ['shud', 'sEnd', 'touch', 'sStall'].forEach((i) => show(i, false));
    stage.setSmash(false); ctx.setPosts(true);
  }

  function start(c) {
    cleanupMatch(); ctx.clearClassic();
    cfg = c; active = true; online = !!room; ctx.setMode('smash'); ctx.setPhase('fight');
    rand = mulberry(c.seed); aiRand = mulberry(c.seed ^ 0x5bd1e995);
    ctx.setMapNow(c.map); stage.setSmash(true); ctx.setPosts(false); buildPlatforms();
    const ds = defs(); fighters = [];
    c.slots.forEach((s, i) => {
      if (!s) return;
      const def = ds.find((d) => d.id === s.char) || ds[0];
      const f = new ctx.Fighter(def, ctx.makeRig(def), i, null);
      Object.assign(f, { slot: i, stageHalf: MAIN, stocks: c.stocks, out: false, respawnT: 0, name: s.name || '' });
      spawn(f, SPAWN[i], 0);
      f.rig.root.add(labelSprite(i)); f.rig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(f.rig.root);
      fighters.push(f);
    });
    humans = [];
    for (const f of fighters) {
      const s = c.slots[f.slot];
      if (s.kind === 'cpu') f.getInput = ctx.makeAI(f, () => nearest(f) || f, s.lvl, () => aiRand());
      else if (s.kind === 'local') f.getInput = devInput(s.dev, c.slots);
      else { const sl = f.slot; humans.push(sl); f.getInput = () => (inBuf[sl] && inBuf[sl][tick]) || I.EMPTY(); }
    }
    if (online) {
      tick = 0; epoch = c.epoch; inBuf = {};
      for (const s of humans) { inBuf[s] = (future[epoch] && future[epoch][s]) || {}; for (let t = 0; t < D; t++) inBuf[s][t] = I.EMPTY(); }
      delete future[epoch];
      myInput = I.combine(I.keyboardInput(I.KEYMAPS.p1, I.KEYMAPS.p2), I.touchInput(), I.gamepadInput(0));
    }
    phase = 'intro'; pt = 0; hitstop = 0; places = []; acc = 0; sUlt = 0; wasCut = false; stallSince = 0; stallShown = false;
    buildHud(); ['smashSetup', 'sEnd', 'hud', 'online'].forEach((i) => show(i, false)); show('shud');
    show('touch', online ? ctx.coarse : c.slots.some((s) => s && s.kind === 'local' && s.dev === 'touch'));
    banner('READY?');
    if (room && room.isHost) ctx.lobbySet(null);
  }

  /* ==================================== render (every frame) ==================================== */
  function frame(now, dt) {
    if (!active) return;
    if (!ctx.paused()) {
      acc = Math.min(acc + dt, 0.25);
      while (acc >= 1 / 60) {
        if (online) {
          if (!humans.every((s) => inBuf[s] && inBuf[s][tick])) { // wait for everyone's input for this tick
            if (!stallSince) stallSince = now;
            const w = now - stallSince;
            if (w > 1500 && !stallShown) { stallShown = true; $('sStall').classList.remove('hidden'); }
            if (room.isHost && w > 7000) { // a player stopped sending: drop them and end the match for everyone
              const gone = humans.filter((s) => !(inBuf[s] && inBuf[s][tick])).map((s) => rs.slots[s]).filter((x) => x && x.peer);
              gone.forEach((x) => room.kick(x.peer)); const who = gone.map((x) => x.name).join(', ') || 'A player';
              gone.forEach((x) => { const i = rs.slots.indexOf(x); rs.slots[i] = { type: 'open', char: x.char }; });
              endOnline(`${who} lost connection`); pushRoom(); return;
            }
            if (!room.isHost && w > 10000) { ctx.toast('Lost connection to the host'); stop(); ctx.goMenu(); return; }
            break;
          }
          if (stallSince) { stallSince = 0; if (stallShown) { stallShown = false; $('sStall').classList.add('hidden'); } }
          const v = I.pack(myInput()); (inBuf[mySlot] = inBuf[mySlot] || {})[tick + D] = I.unpack(v);
          const m = { t: 'in', e: epoch, s: mySlot, k: tick + D, v };
          if (room.isHost) room.broadcast(m); else room.send(m);
        }
        acc -= 1 / 60; step();
        if (online) { for (const s of humans) delete inBuf[s][tick]; tick++; }
      }
    }
    const alpha = ctx.paused() || hitstop > 0 || ctx.cut.active() ? 1 : Math.min(1, acc * 60);
    for (const f of fighters) {
      const hidden = f.out || f.respawnT > 0 || (f.blink && Math.floor(now / 90) % 2 === 0);
      f.rig.root.visible = !hidden;
      if (!f.out && f.respawnT === 0) ctx.poseUpdate(f, alpha, dt);
    }
    for (const h of helpers) ctx.poseUpdate(h.f, alpha, dt);
    for (const p of projectiles) p.mesh.position.set(p.px + (p.x - p.px) * alpha, p.y, 0);
    if (ctx.cut.active()) ctx.cut.camera(dt); else camera(dt);
    updHud();
  }
  function camera(dt) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, n = 0;
    for (const f of fighters) { if (f.out || f.respawnT > 0) continue; const p = f.rig.root.position; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); n++; }
    if (!n) { x0 = -3; x1 = 3; y0 = 0; y1 = 2; }
    x0 = Math.max(-BZ.x + 2, Math.min(x0, -2.5)); x1 = Math.min(BZ.x - 2, Math.max(x1, 2.5));
    y0 = Math.max(BZ.bottom + 2, Math.min(y0, 0)); y1 = Math.min(BZ.top - 1, Math.max(y1 + 2.2, 3));
    const t = Math.tan((cam.fov * Math.PI) / 360), w = (x1 - x0) / 2 + 2.6, h = (y1 - y0) / 2 + 1.8;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + 0.3, z = Math.max(w / (t * cam.aspect), h / t, 9) * 1.3; // 30% farther out
    const s = 1 - Math.pow(0.9, dt * 60);
    cam.position.x += (cx - cam.position.x) * s; cam.position.y += (cy + 1.2 - cam.position.y) * s; cam.position.z += (z - cam.position.z) * s;
    cam.lookAt(cam.position.x, cam.position.y - 1.2, 0);
  }

  /* ==================================== HUD + results ==================================== */
  function faceStyle(id, el) { const d = defs().find((x) => x.id === id), url = ctx.faceUrl(id); el.style.background = url ? `#333 center/cover url(${url})` : css(d?.top ?? '#666'); }
  function buildHud() {
    const h = $('shud'); h.innerHTML = '';
    for (const f of fighters) {
      const c = document.createElement('div'); c.className = 'shc'; c.style.setProperty('--pc', COLORS[f.slot]);
      c.innerHTML = '<div class="f"></div><div style="min-width:0"><div class="pc">0%</div><div class="nm"></div><div class="st"></div><div class="mb"><i></i></div></div>';
      faceStyle(f.def.id, c.querySelector('.f')); c.querySelector('.nm').textContent = `P${f.slot + 1} ${f.name || f.def.name}`;
      h.append(c); f.hud = c; f.hc = {};
    }
  }
  function updHud() {
    for (const f of fighters) {
      const c = f.hud, hc = f.hc, pc = Math.floor(f.pct), st = f.out ? 'OUT' : '●'.repeat(Math.max(0, f.stocks)), mb = Math.round(f.meter);
      if (hc.pc !== pc) { hc.pc = pc; const el = c.querySelector('.pc'); el.textContent = pc + '%'; el.style.color = `hsl(${Math.max(0, 55 - pc * 0.35)},100%,${Math.max(52, 100 - pc * 0.32)}%)`; }
      if (hc.st !== st) { hc.st = st; c.querySelector('.st').textContent = st; c.classList.toggle('out', !!f.out); }
      if (hc.mb !== mb) { hc.mb = mb; c.querySelector('.mb i').style.width = Math.min(100, mb) + '%'; }
    }
  }
  function showResults() {
    const medal = ['1st', '2nd', '3rd', '4th'];
    const name = (s) => { const f = fighters.find((x) => x.slot === s); return f ? `P${s + 1} ${f.name ? f.name + ' · ' : ''}${f.def.name}` : ''; };
    $('sWin').textContent = places.length ? name(places[0]) + ' WINS' : 'DRAW';
    $('sPlaces').innerHTML = ''; places.forEach((s, i) => { const d = document.createElement('div'); d.textContent = `${medal[i]}  ${name(s)}`; d.style.color = COLORS[s]; $('sPlaces').append(d); });
    const guest = room && !room.isHost;
    show('sRematch', !guest); show('sSetup', !guest); $('sEndNote').textContent = guest ? 'Waiting for the host to start the next match…' : '';
    show('sEnd');
  }

  /* ==================================== setup screen (local + room) ==================================== */
  function renderSetup() {
    const ds = defs(), inRoom = !!rs, box = $('sSlots'); box.textContent = '';
    for (let i = 0; i < 4; i++) {
      const s = inRoom ? rs.slots[i] : slots[i];
      const off = inRoom ? s.type === 'open' : s.type === 'off';
      if (!s.char) s.char = defaultChar(i);
      const d = ds.find((x) => x.id === s.char) || ds[0];
      const mine = !inRoom || i === mySlot || (room && room.isHost && s.type.startsWith('cpu'));
      const card = document.createElement('div'); card.className = 'scard' + (off ? ' off' : ''); card.style.setProperty('--pc', COLORS[i]);
      card.innerHTML = '<div class="sp"></div><div class="sface"></div><div class="sname"></div><div class="arr"><button data-d="-1">◀</button><button data-d="1">▶</button></div><button class="stype"></button>';
      card.querySelector('.sp').textContent = 'P' + (i + 1);
      faceStyle(d.id, card.querySelector('.sface'));
      card.querySelector('.sname').textContent = off ? '—' : d.name;
      const label = inRoom ? ({ host: `Host: ${s.name}`, guest: `Online: ${s.name}`, open: 'Open (tap for CPU)', cpu0: 'CPU Easy', cpu1: 'CPU Normal', cpu2: 'CPU Hard' })[s.type] : TYPES.find((t) => t[0] === s.type)[1];
      const tb = card.querySelector('.stype'); tb.textContent = label;
      const canType = !inRoom || (room.isHost && !['host', 'guest'].includes(s.type));
      tb.disabled = !canType;
      tb.onclick = () => {
        if (!inRoom) { const k = TYPES.findIndex((t) => t[0] === s.type); s.type = TYPES[(k + 1) % TYPES.length][0]; return renderSetup(); }
        const k = ROOM_TYPES.indexOf(s.type); s.type = ROOM_TYPES[(k + 1) % ROOM_TYPES.length]; pushRoom();
      };
      card.querySelectorAll('.arr button').forEach((b) => {
        b.disabled = off || !mine;
        b.onclick = () => {
          const k = ds.findIndex((x) => x.id === s.char), id = ds[(k + +b.dataset.d + ds.length) % ds.length].id;
          if (!inRoom) { s.char = id; return renderSetup(); }
          if (room.isHost) { s.char = id; pushRoom(); } else room.send({ t: 'char', id });
        };
      });
      box.append(card);
    }
    const host = !inRoom || room.isHost;
    $('sStocks').textContent = inRoom ? rs.stocks : stocks;
    $('sLess').disabled = $('sMore').disabled = !host;
    const mb = $('sMaps'); mb.textContent = '';
    const cur = inRoom ? rs.map : ctx.getMap();
    [...ctx.MAPS, { id: 'random', name: '🎲 Random' }].forEach((m) => {
      const b = document.createElement('button'); b.className = 'chip' + (m.id === cur ? ' on' : ''); b.textContent = m.name; b.disabled = !host;
      b.onclick = () => { if (!inRoom) ctx.setMap(m.id); else { rs.map = m.id; if (m.id !== 'random') ctx.setMapNow(m.id); pushRoom(); } renderSetup(); };
      mb.append(b);
    });
    show('sStart', host);
    $('sRoomInfo').classList.toggle('hidden', !inRoom);
    if (inRoom) $('sRoomInfo').textContent = room.isHost ? `Your room is open. Friends: Online → tap your room, or enter code ${rs.code}.` : `In ${rs.slots[0].name}'s room as P${mySlot + 1}. Pick your fighter; the host starts the match.`;
    note(!host ? 'Waiting for the host to start…' : '');
  }
  function openSetup() {
    ctx.setMode('smash'); ctx.setPhase('menu'); cleanupMatch();
    ['menu', 'online', 'select', 'hud', 'endbar'].forEach((i) => show(i, false)); show('smashSetup'); renderSetup();
  }
  $('sLess').onclick = () => { if (rs) { rs.stocks = Math.max(1, rs.stocks - 1); pushRoom(); } else stocks = Math.max(1, stocks - 1); renderSetup(); };
  $('sMore').onclick = () => { if (rs) { rs.stocks = Math.min(9, rs.stocks + 1); pushRoom(); } else stocks = Math.min(9, stocks + 1); renderSetup(); };
  $('sBack').onclick = () => { stop(); ctx.goMenu(); };
  $('sStart').onclick = () => {
    if (rs) return hostStart();
    if (slots.filter((s) => s.type !== 'off').length < 2) return note('Turn on at least 2 fighters (players or CPU).');
    start({
      epoch: 0, seed: (Math.random() * 2147483647) | 0, stocks, map: ctx.resolveMap(),
      slots: slots.map((s) => (s.type === 'off' ? null : s.type.startsWith('cpu') ? { kind: 'cpu', lvl: +s.type[3], char: s.char } : { kind: 'local', dev: s.type, char: s.char })),
    });
  };
  $('sRematch').onclick = () => {
    if (rs) return hostStart();
    start({ ...cfg, seed: (Math.random() * 2147483647) | 0, map: ctx.resolveMap() });
  };
  $('sSetup').onclick = () => { if (rs && room.isHost) room.broadcast({ t: 'toRoom' }); toSetup(); };
  $('sMenu').onclick = () => { stop(); ctx.goMenu(); };
  function toSetup() { cleanupMatch(); if (rs) advertise(); openSetup(); }

  /* ==================================== online rooms ==================================== */
  function pushRoom() { if (!room || !room.isHost) return; room.broadcast({ t: 'room', rs }); if (!active) renderSetup(); advertise(); }
  function advertise() {
    if (!room || !room.isHost) return;
    const n = rs.slots.filter((s) => s.type === 'host' || s.type === 'guest').length;
    ctx.lobbySet(active || n >= 4 ? null : { code: rs.code, name: rs.slots[0].name, kind: 'smash', n }); ctx.setHosting(rs.code);
  }
  function storeIn(m) {
    if (m.e === epoch && active) (inBuf[m.s] = inBuf[m.s] || {})[m.k] = I.unpack(m.v);
    else if (m.e > epoch) { const fe = (future[m.e] = future[m.e] || {}); (fe[m.s] = fe[m.s] || {})[m.k] = I.unpack(m.v); }
  }
  function hostStart() {
    if (rs.slots.filter((s) => s.type !== 'open').length < 2) return note('Need at least 2 fighters: wait for a friend or set a slot to CPU.');
    hostEpoch++;
    const map = rs.map === 'random' ? ctx.MAPS[(Math.random() * ctx.MAPS.length) | 0].id : rs.map;
    const c = { epoch: hostEpoch, seed: (Math.random() * 2147483647) | 0, stocks: rs.stocks, map,
      slots: rs.slots.map((s) => (s.type === 'open' ? null : s.type.startsWith('cpu') ? { kind: 'cpu', lvl: +s.type[3], char: s.char } : { kind: 'net', char: s.char, name: s.name })) };
    room.broadcast({ t: 'start', cfg: c }); start(c);
  }
  function endOnline(reason) { if (room && room.isHost) room.broadcast({ t: 'end', reason }); ctx.toast(reason); toSetup(); }
  function wire() {
    room.listen({
      join(peer) {
        if (!room.isHost) return;
        const i = rs.slots.findIndex((s) => s.type === 'open');
        if (i < 0 || active) { room.send({ t: 'full' }, peer); setTimeout(() => room && room.kick(peer), 500); return; }
        rs.slots[i] = { type: 'guest', name: 'Player', char: rs.slots[i].char || defaultChar(i), peer };
        room.send({ t: 'welcome', slot: i }, peer); pushRoom(); sfx(660, 0.1, 'triangle', 0.05);
      },
      leave(peer) {
        if (room && room.isHost) {
          const i = rs.slots.findIndex((s) => s.peer === peer); if (i < 0) return;
          const who = rs.slots[i].name; rs.slots[i] = { type: 'open', char: rs.slots[i].char };
          if (active) endOnline(`${who} left the match`); pushRoom();
        } else { ctx.toast('The host closed the room'); stop(); ctx.goMenu(); }
      },
      msg(m, from) {
        if (room.isHost) {
          const i = rs.slots.findIndex((s) => s.peer === from);
          if (m.t === 'hello' && i >= 0) { rs.slots[i].name = String(m.name || 'Player').slice(0, 14); pushRoom(); }
          else if (m.t === 'char' && i >= 0 && !active && defs().some((d) => d.id === m.id)) { rs.slots[i].char = m.id; pushRoom(); }
          else if (m.t === 'in' && i >= 0 && m.s === i) { storeIn(m); room.broadcast(m, from); }
          return;
        }
        if (m.t === 'welcome') mySlot = m.slot;
        else if (m.t === 'room') { rs = m.rs; if (!active) { if (rs.map !== 'random') ctx.setMapNow(rs.map); openSetup(); } }
        else if (m.t === 'start') start(m.cfg);
        else if (m.t === 'in') storeIn(m);
        else if (m.t === 'toRoom') toSetup();
        else if (m.t === 'end') { ctx.toast(m.reason); toSetup(); }
        else if (m.t === 'full') { ctx.toast('That room is full or already playing'); stop(); ctx.goMenu(); }
      },
    });
  }
  async function hostRoom(name) {
    stopRoom(); room = new ctx.Room(); ctx.setStatus('Opening your Smash room…');
    try {
      const code = await room.host();
      const m = ctx.getMap();
      rs = { code, stocks: 3, map: m, slots: [{ type: 'host', name, char: defaultChar(0) }, { type: 'open', char: defaultChar(1) }, { type: 'open', char: defaultChar(2) }, { type: 'open', char: defaultChar(3) }] };
      mySlot = 0; hostEpoch = 0; epoch = 0; future = {}; wire(); openSetup(); advertise();
    } catch (e) { ctx.setStatus('Could not open a room: ' + (e.message || e)); room = null; rs = null; }
  }
  async function joinRoom(code, name) {
    stopRoom(); room = new ctx.Room(); ctx.setStatus('Joining the Smash room…');
    try { await room.join(code); epoch = 0; future = {}; wire(); room.send({ t: 'hello', name }); ctx.lobbyStop(); ctx.setMode('smash'); }
    catch (e) { ctx.setStatus(e.message || 'Could not join.'); room = null; rs = null; }
  }
  function stopRoom() { if (room) { if (room.isHost) ctx.lobbySet(null); room.close(); } room = null; rs = null; online = false; }
  function stop() { cleanupMatch(); stopRoom(); show('smashSetup', false); }

  return {
    openSetup, frame, stop, hostRoom, joinRoom, toSetup,
    rematch() { if (rs && !room.isHost) return; $('sRematch').onclick(); },
    get active() { return active; }, get inRoom() { return !!room; },
    isOnline: () => !!room,
    debug: () => ({ phase, tick, fighters, helpers, places }),
  };
}
