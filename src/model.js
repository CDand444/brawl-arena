import * as THREE from 'three';

/* ---- cel-shaded look: 3-step toon ramp + black inverted-hull outlines ---- */
const ramp = new THREE.DataTexture(new Uint8Array([95, 165, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const MAT = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, ...o });
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x0a0a12, side: THREE.BackSide });

/** Add a mesh to parent p. `ol` = outline thickness scale (0 = none). */
const add = (p, geo, mat, x = 0, y = 0, z = 0, ol = 1.06) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; p.add(m);
  if (ol && !mat.transparent && mat.side !== THREE.DoubleSide) { const o = new THREE.Mesh(geo, OUTLINE); o.scale.setScalar(ol); o.castShadow = false; m.add(o); }
  return m;
};
const cap = (r, len, seg = 4) => new THREE.CapsuleGeometry(r, len, seg, 10);

/** Build a posable 3D fighter from a character definition (characters/*.json). Faces +z. */
export function buildCharacter(d) {
  const b = d.build ?? 1, skin = MAT(d.skin);
  const extras = d.extras || [], sleeves = d.sleeves || 'long'; // long | short | none
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);

  /* legs: thigh (hip pivot) -> shin (knee pivot) */
  const legs = [], knees = [];
  if (d.gown) {
    add(body, new THREE.ConeGeometry(0.85, 1.55, 28, 1, true), MAT(d.bottom, { side: THREE.DoubleSide }), 0, 0.77, 0, 0);
    const tr = add(body, new THREE.CircleGeometry(0.8, 28), MAT(d.bottom, { side: THREE.DoubleSide }), 0, 0.02, -0.75, 0);
    tr.rotation.x = -Math.PI / 2; tr.scale.set(1, 1.4, 1);
  }
  for (const x of [-0.17, 0.17]) {
    const leg = new THREE.Group(); leg.position.set(x * b, 0.95, 0); body.add(leg);
    add(leg, cap(0.125 * b, 0.34), MAT(d.bottom), 0, -0.25, 0);
    const knee = new THREE.Group(); knee.position.y = -0.5; leg.add(knee);
    add(knee, cap(d.boots ? 0.115 * b : 0.1 * b, 0.3), MAT(d.boots ? d.shoes : d.bottom), 0, -0.23, 0);
    add(knee, new THREE.BoxGeometry(0.2 * b, 0.13, 0.36), MAT(d.shoes), 0, -0.47, 0.06);
    if (!d.boots) add(knee, new THREE.BoxGeometry(0.205 * b, 0.04, 0.37), MAT(0xf4f4f4), 0, -0.52, 0.06, 0); // sole
    legs.push(leg); knees.push(knee);
  }

  /* torso (pivot at waist) */
  const torso = new THREE.Group(); torso.position.y = 1.0; body.add(torso);
  const TS = (m) => { m.scale.z = 0.72; return m; };
  add(torso, cap(0.24 * b, 0.1), MAT(d.bottom), 0, 0.0, 0).scale.z = 0.8; // hips
  TS(add(torso, cap(0.265 * b, 0.4), MAT(d.top), 0, 0.42, 0));
  const zAt = (x) => 0.265 * b * 0.72 * Math.sqrt(Math.max(0.05, 1 - (x / (0.265 * b)) ** 2)) + 0.012; // surface z at x
  if (d.stripe) for (let i = -2; i <= 2; i++) add(torso, new THREE.BoxGeometry(0.035, 0.62, 0.02), MAT(d.stripe), i * 0.1 * b, 0.4, zAt(i * 0.1 * b), 0);
  if (d.pattern) d.pattern.forEach((c, i) => { for (let k = 0; k < 4; k++) {
    const x = (i - 1.5) * 0.12 * b + (k % 2) * 0.05; add(torso, new THREE.SphereGeometry(0.032, 6, 6), MAT(c), x, 0.2 + k * 0.15, zAt(x), 0); } });
  const layer = (col, s = 1.07) => { const m = TS(add(torso, cap(0.265 * b * s, 0.4), MAT(col), 0, 0.42, 0, 0)); return m; };
  const strip = () => add(torso, new THREE.BoxGeometry(0.13 * b, 0.62, 0.02), MAT(d.top), 0, 0.42, zAt(0) + 0.045, 0);
  if (d.jacket) { layer(d.jacket); strip(); }
  if (d.overshirt) { layer(d.overshirt); strip(); }
  if (d.vest) { layer(d.vest, 1.05); strip(); }
  if (d.coat) add(torso, new THREE.CylinderGeometry(0.31 * b, 0.46 * b, 1.15, 20, 1, true), MAT(d.coat, { side: THREE.DoubleSide }), 0, 0.12, 0, 0);
  if (extras.includes('tie')) add(torso, new THREE.BoxGeometry(0.07, 0.42, 0.02), MAT(d.tie || 0xaa2222), 0, 0.5, zAt(0) + 0.09, 0);
  if (extras.includes('pin')) add(torso, new THREE.SphereGeometry(0.03, 8, 8), MAT(0xd4af37), 0.13 * b, 0.62, zAt(0.13 * b) + 0.08, 0);

  /* arms: upper arm (shoulder pivot) -> forearm (elbow pivot) -> hand */
  const arms = [], elbows = [];
  const sleeveCol = d.coat || d.jacket || d.overshirt || d.top;
  for (const x of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(x * 0.34 * b, 0.7, 0); torso.add(arm);
    add(arm, new THREE.SphereGeometry(0.1 * b, 12, 10), sleeves === 'none' ? skin : MAT(sleeveCol), 0, 0, 0, 0);
    add(arm, cap(0.078 * b, 0.22), sleeves === 'none' ? skin : MAT(sleeveCol), 0, -0.2, 0);
    const elbow = new THREE.Group(); elbow.position.y = -0.4; arm.add(elbow);
    add(elbow, cap(0.068 * b, 0.2), sleeves === 'long' ? MAT(sleeveCol) : skin, 0, -0.19, 0);
    add(elbow, new THREE.SphereGeometry(0.075, 12, 10), skin, 0, -0.39, 0);
    if (extras.includes('watch') && x > 0) add(elbow, new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12), MAT(0x222222), 0, -0.3, 0, 0);
    arms.push(arm); elbows.push(elbow);
  }

  /* head */
  const neckPivot = new THREE.Group(); neckPivot.position.y = 0.88; torso.add(neckPivot);
  add(neckPivot, new THREE.CylinderGeometry(0.075, 0.09, 0.16, 12), skin, 0, 0.02, 0);
  const head = new THREE.Group(); const HS = d.headScale ?? 1.45; head.scale.setScalar(HS); head.position.y = 0.06 + 0.17 * HS; neckPivot.add(head); // big head: reads better in a fighting game and shows photo faces
  add(head, new THREE.SphereGeometry(0.24, 22, 16), skin).scale.set(0.9, 1.05, 0.95);
  add(head, new THREE.SphereGeometry(0.17, 20, 16), skin, 0, -0.1, 0.03, 1.05).scale.set(1, 0.95, 1); // jaw
  for (const x of [-1, 1]) add(head, new THREE.SphereGeometry(0.04, 10, 8), skin, x * 0.225, -0.01, 0, 0); // ears

  const feat = new THREE.Group(); head.add(feat); // generated face (hidden when a photo face is applied)
  for (const x of [-0.088, 0.088]) {
    add(feat, new THREE.SphereGeometry(0.038, 12, 10), MAT(0xffffff), x, 0.04, 0.205, 0).scale.set(1, 0.8, 0.5);
    add(feat, new THREE.SphereGeometry(0.024, 12, 10), MAT(d.eyes), x, 0.04, 0.226, 0);
    add(feat, new THREE.SphereGeometry(0.012, 8, 8), MAT(0x050505), x, 0.04, 0.236, 0);
    add(feat, new THREE.BoxGeometry(0.075, 0.014, 0.02), MAT(d.hair?.color ?? 0x111111), x, 0.1, 0.215, 0); // brow
  }
  add(feat, new THREE.SphereGeometry(0.034, 10, 8), skin, 0, -0.03, 0.235, 0);
  const smile = add(feat, new THREE.TorusGeometry(0.05, 0.007, 5, 14, Math.PI), MAT(0x6a2020), 0, -0.07, 0.222, 0); smile.rotation.z = Math.PI; smile.scale.y = 0.6;
  if (extras.includes('nosering')) add(head, new THREE.TorusGeometry(0.018, 0.005, 6, 12), MAT(0xdddddd), 0.04, -0.05, 0.245, 0);
  if (extras.includes('necklace') || extras.includes('choker')) {
    const n = add(neckPivot, new THREE.TorusGeometry(0.115, 0.01, 6, 24), MAT(extras.includes('choker') ? 0xdddddd : 0xd4af37), 0, -0.04, 0, 0); n.rotation.x = Math.PI / 2;
  }
  if (extras.includes('stethoscope')) {
    const n = add(neckPivot, new THREE.TorusGeometry(0.16, 0.014, 6, 20), MAT(0x222222), 0, -0.1, 0.04, 0); n.rotation.x = Math.PI / 2.4;
    add(torso, new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), MAT(0xbbbbbb), 0.04, 0.55, zAt(0.04) + 0.1, 0).rotation.x = Math.PI / 2;
  }
  if (extras.includes('bandana')) {
    add(head, new THREE.CylinderGeometry(0.248, 0.248, 0.07, 22, 1, true), MAT(d.bandana || 0xb01818, { side: THREE.DoubleSide }), 0, 0.13, 0, 0);
    add(head, new THREE.BoxGeometry(0.1, 0.09, 0.04), MAT(d.bandana || 0xb01818), 0, 0.13, -0.25, 0);
  }
  if (extras.includes('glasses')) { for (const x of [-0.088, 0.088]) add(head, new THREE.TorusGeometry(0.052, 0.008, 6, 18), MAT(0x111111), x, 0.04, 0.235, 0);
    add(head, new THREE.BoxGeometry(0.05, 0.008, 0.008), MAT(0x111111), 0, 0.05, 0.24, 0); }
  if (d.beard) add(head, new THREE.SphereGeometry(0.205, 18, 12, 0, 6.28, Math.PI * 0.5, Math.PI * 0.5), MAT(d.beard), 0, -0.04, 0.035).scale.set(0.93, 0.9, 0.95);

  /* hair */
  const h = d.hair || {}, hm = MAT(h.color ?? 0x111111);
  const hcap = (r = 0.255) => add(head, new THREE.SphereGeometry(r, 24, 18, 0, 6.28, 0, Math.PI * 0.55), hm, 0, 0.02, -0.01);
  if (h.style === 'long') { hcap(); add(head, cap(0.2, 0.4), hm, 0, -0.22, -0.1).scale.z = 0.6; for (const x of [-1, 1]) add(head, cap(0.05, 0.45), hm, x * 0.235, -0.2, 0); }
  if (h.style === 'bob') { hcap(); add(head, cap(0.2, 0.12), hm, 0, -0.05, -0.1).scale.z = 0.6; for (const x of [-1, 1]) add(head, cap(0.055, 0.2), hm, x * 0.235, -0.05, 0); }
  if (h.style === 'short') hcap(0.25);
  if (h.style === 'updo') { hcap(); add(head, new THREE.SphereGeometry(0.14, 14, 12), hm, 0, 0.27, -0.08); }
  if (h.style === 'locs' || h.style === 'dreads') {
    const long = h.style === 'dreads'; hcap(long ? 0.255 : 0.25);
    const n = long ? 20 : 14;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; add(head, cap(long ? 0.022 : 0.02, long ? 0.45 : 0.22, 4), hm, Math.sin(a) * 0.225, long ? -0.22 : -0.1, Math.cos(a) * 0.205 - 0.03, 1.15); }
  }

  /* hats */
  if (d.hat) {
    const c = MAT(d.hat.color);
    if (d.hat.type === 'beanie') {
      add(head, new THREE.SphereGeometry(0.27, 22, 14, 0, 6.28, 0, Math.PI * 0.5), c, 0, 0.06, 0).scale.y = 1.15;
      add(head, new THREE.CylinderGeometry(0.268, 0.268, 0.1, 22), c, 0, 0.07, 0);
      if (d.hat.studs) for (let i = 0; i < 18; i++) { const a = i / 18 * 6.28; add(head, new THREE.SphereGeometry(0.016, 6, 6), MAT(0xffffff, { emissive: 0x888888 }), Math.sin(a) * 0.272, 0.08, Math.cos(a) * 0.272, 0); }
    }
    if (d.hat.type === 'fedora') {
      add(head, new THREE.CylinderGeometry(0.4, 0.4, 0.025, 28), c, 0, 0.14, 0);
      add(head, new THREE.CylinderGeometry(0.2, 0.25, 0.2, 22), c, 0, 0.25, 0);
      add(head, new THREE.CylinderGeometry(0.252, 0.252, 0.04, 22), MAT(0x6a2a2a), 0, 0.18, 0, 0);
    }
    if (d.hat.type === 'cap') {
      add(head, new THREE.SphereGeometry(0.26, 22, 14, 0, 6.28, 0, Math.PI * 0.5), c, 0, 0.07, 0);
      add(head, new THREE.BoxGeometry(0.3, 0.02, 0.2), c, 0, 0.08, 0.3);
    }
  }

  return { root, body, torso, head, neck: neckPivot, arms, elbows, legs, knees, feat, cur: {} };
}

/* ---- photo faces: a flat 2D head cutout (billboard) that always faces the camera and flips when the fighter turns ---- */
let ovalTex;
function oval() {
  if (ovalTex) return ovalTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 30, 64, 64, 62);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.78, '#fff'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (ovalTex = new THREE.CanvasTexture(c));
}
/** tex: cropped face photo. Hides the generated 3D head and puts the photo in its place as a 2D cutout with a cartoon outline. */
export function applyFace(rig, tex, opts = {}) {
  rig.head.children.forEach((ch) => (ch.visible = false));
  tex.colorSpace = THREE.SRGBColorSpace;
  const H = opts.size ?? 0.66, W = H * (tex.image.width / tex.image.height);
  const g = new THREE.Group(); g.position.y = opts.y ?? -0.03; rig.head.add(g);
  const mk = (mat, s, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(W * s, H * s), mat); m.position.z = z; m.renderOrder = 5; g.add(m); return m; };
  mk(new THREE.MeshBasicMaterial({ color: 0x0a0a12, alphaMap: oval(), transparent: true, side: THREE.DoubleSide, depthWrite: false }), 1.07, 0);
  mk(new THREE.MeshBasicMaterial({ map: tex, alphaMap: oval(), transparent: true, side: THREE.DoubleSide, depthWrite: false, color: new THREE.Color().setScalar(opts.bright ?? 1) }), 1, 0.002);
  rig.facePlane = g; rig.flip = 1;
}
/** Keep the 2D head facing the camera; `dir` = +1/-1. The flip animates through zero width, like a coin turning. */
export function updateFace(rig, dir, dt = 1 / 60) {
  if (!rig.facePlane) return;
  rig.flip += (dir - rig.flip) * (1 - Math.pow(0.78, Math.min(dt, 0.05) * 60));
  rig.facePlane.rotation.y = -(rig.root.rotation.y + rig.head.rotation.y);
  rig.facePlane.scale.x = rig.flip;
}

/* ---- procedural poses. Rotation.x angles: negative = swing forward/up. e = elbow bend (neg = forearm forward), k = knee bend (pos = shin back). ---- */
const P = (o) => ({ aL: -0.5, aR: -0.8, aLe: -1.5, aRe: -1.6, aLz: 0.12, aRz: -0.12, lL: 0.12, lR: -0.1, lLk: 0.25, lRk: 0.3, lLz: 0.08, lRz: -0.08, lean: 0.05, headX: 0, drop: 0, fall: 0, ...o });
export const POSES = {
  idle: (u) => { const s = Math.sin(u * 0.08) * 0.05; return P({ aL: -0.5 + s, aR: -0.8 + s, drop: -Math.abs(s) * 0.5 }); },
  walk: (u) => { const s = Math.sin(u * 0.28), c = Math.cos(u * 0.28);
    return P({ lL: 0.7 * s, lR: -0.7 * s, lLk: 0.2 + 0.7 * Math.max(0, -c), lRk: 0.2 + 0.7 * Math.max(0, c), aL: -0.4 - 0.4 * s, aR: -0.4 + 0.4 * s, aLe: -1.2, aRe: -1.2, lean: 0.1 }); },
  run: (u) => { const s = Math.sin(u * 0.42), c = Math.cos(u * 0.42);
    return P({ lL: 1.0 * s, lR: -1.0 * s, lLk: 0.4 + 1.2 * Math.max(0, -c), lRk: 0.4 + 1.2 * Math.max(0, c), aL: -0.9 - 0.9 * s, aR: -0.9 + 0.9 * s, aLe: -1.6, aRe: -1.6, lean: 0.45 }); },
  jump: () => P({ lL: -0.9, lR: -0.4, lLk: 1.2, lRk: 0.9, aL: -2.4, aR: -2.4, aLe: -0.4, aRe: -0.4, lean: 0 }),
  djump: () => P({ lL: -1.5, lR: -1.3, lLk: 2.0, lRk: 1.9, aL: -1.2, aR: -1.2, aLe: -2.2, aRe: -2.2, lean: 0.6 }),
  crouch: () => P({ drop: -0.38, lL: -1.2, lR: -1.2, lLk: 1.8, lRk: 1.8, lean: 0.3, aL: -0.9, aR: -0.9 }),
  block: () => P({ aL: -1.2, aR: -1.3, aLe: -2.3, aRe: -2.4, aLz: 0.05, aRz: -0.05, lean: 0.15 }),
  crouchblock: () => P({ drop: -0.38, lL: -1.2, lR: -1.2, lLk: 1.8, lRk: 1.8, lean: 0.35, aL: -1.2, aR: -1.3, aLe: -2.3, aRe: -2.4 }),
  lp: () => P({ aR: -1.57, aRe: -0.05, aL: -0.5, lean: 0.2 }),
  hp: () => P({ aR: -1.6, aRe: -0.05, aL: -0.4, lean: 0.45, lL: -0.35, lLk: 0.5 }),
  lk: () => P({ lR: -1.4, lRk: 0.1, lL: 0.2, lLk: 0.3, lean: -0.2, aL: -1.0, aR: -1.2 }),
  hk: () => P({ lR: -1.75, lRk: 0.05, lL: 0.25, lLk: 0.3, lean: -0.45, aL: -1.4, aR: 0.4, aRe: -0.3 }),
  up: () => P({ aR: -3.0, aRe: -0.1, aL: -0.6, drop: -0.2, lean: 0.2, lL: -0.6, lLk: 1.0, lR: 0.2, lRk: 0.5 }),
  sweep: () => P({ drop: -0.38, lL: -1.2, lLk: 1.8, lR: -1.55, lRk: 0.1, lean: 0.5, aL: -1.2, aR: -1.2 }),
  jp: () => P({ aR: -1.57, aRe: -0.05, aL: -2.0, lL: -0.9, lLk: 1.2, lR: -0.3, lRk: 0.8, lean: 0.2 }),
  jk: () => P({ lR: -1.4, lRk: 0.1, lL: -0.2, lLk: 1.0, aL: -2.0, aR: -2.2, lean: -0.1 }),
  fireball: () => P({ aL: -1.57, aR: -1.57, aLe: -0.1, aRe: -0.1, lean: 0.25, lL: -0.4, lLk: 0.6 }),
  hit: () => P({ lean: -0.35, headX: -0.35, aL: 0.3, aR: 0.2, aLe: -0.4, aRe: -0.4, drop: -0.05 }),
  down: () => P({ fall: 1, aL: -0.2, aR: -0.2, aLe: -0.3, aRe: -0.3, lLk: 0.1, lRk: 0.1 }),
  fly: () => P({ fall: 0.55, aL: -0.4, aR: -0.4, aLe: -0.3, aRe: -0.3, lL: 0.2, lR: 0.2 }),
  getup: () => P({ drop: -0.38, lL: -1.2, lR: -1.2, lLk: 1.8, lRk: 1.8, lean: 0.4 }),
  win: (u) => P({ aL: -3.0 + Math.sin(u * 0.2) * 0.2, aR: -3.0 - Math.sin(u * 0.2) * 0.2, aLe: -0.2, aRe: -0.2, lean: -0.1 }),
};

/** Smoothly move a rig toward a pose. look = extra head yaw toward the camera (radians). */
export function applyPose(rig, name, u = 0, k = 0.4, look = 0) {
  const t = (POSES[name] || POSES.idle)(u), c = rig.cur;
  for (const key in t) c[key] = c[key] === undefined ? t[key] : c[key] + (t[key] - c[key]) * k;
  rig.arms[0].rotation.set(c.aL, 0, c.aLz); rig.arms[1].rotation.set(c.aR, 0, c.aRz);
  rig.elbows[0].rotation.x = c.aLe; rig.elbows[1].rotation.x = c.aRe;
  rig.legs[0].rotation.set(c.lL, 0, c.lLz); rig.legs[1].rotation.set(c.lR, 0, c.lRz);
  rig.knees[0].rotation.x = c.lLk; rig.knees[1].rotation.x = c.lRk;
  rig.torso.rotation.x = c.lean; rig.head.rotation.x = c.headX - c.lean * 0.5; rig.head.rotation.y = look;
  rig.body.position.y = c.drop + 0.22 * c.fall; rig.body.rotation.x = -1.5 * c.fall;
}
