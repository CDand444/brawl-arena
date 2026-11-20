import * as THREE from 'three';

const MAT = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o });
const add = (p, geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; p.add(m); return m;
};

/** Build a posable 3D fighter from a character definition (characters/*.json). Faces +z. */
export function buildCharacter(d) {
  const b = d.build ?? 1, skin = MAT(d.skin);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const extras = d.extras || [];
  const sleeves = d.sleeves || 'long'; // long | short | none

  // legs (pivot at hip)
  const legs = [];
  const legCol = d.gown ? d.bottom : d.bottom;
  if (d.gown) {
    add(body, new THREE.ConeGeometry(0.85, 1.5, 24, 1, true), MAT(d.bottom, { side: THREE.DoubleSide }), 0, 0.75, 0);
    const tr = add(body, new THREE.CircleGeometry(0.8, 24), MAT(d.bottom, { side: THREE.DoubleSide }), 0, 0.02, -0.75);
    tr.rotation.x = -Math.PI / 2; tr.scale.set(1, 1.4, 1);
  }
  for (const x of [-0.17, 0.17]) {
    const leg = new THREE.Group(); leg.position.set(x * b, 0.95, 0); body.add(leg);
    add(leg, new THREE.CylinderGeometry(0.13 * b, 0.11 * b, 0.9, 12), MAT(legCol), 0, -0.45, 0);
    add(leg, new THREE.BoxGeometry(0.2 * b, 0.14, 0.34), MAT(d.shoes), 0, -0.93, 0.05);
    if (d.boots) add(leg, new THREE.CylinderGeometry(0.135 * b, 0.12 * b, 0.45, 12), MAT(d.shoes), 0, -0.7, 0);
    legs.push(leg);
  }

  // torso (pivot at waist)
  const torso = new THREE.Group(); torso.position.y = 1.0; body.add(torso);
  add(torso, new THREE.CylinderGeometry(0.3 * b, 0.26 * b, 0.75, 16), MAT(d.top), 0, 0.38, 0);
  if (d.stripe) for (let i = -2; i <= 2; i++) add(torso, new THREE.BoxGeometry(0.04, 0.74, 0.52 * b), MAT(d.stripe), i * 0.1 * b, 0.38, 0);
  if (d.pattern) d.pattern.forEach((c, i) => { for (let k = 0; k < 4; k++) {
    add(torso, new THREE.SphereGeometry(0.035, 6, 6), MAT(c), (i - 1.5) * 0.13 * b + (k % 2) * 0.05, 0.15 + k * 0.17, 0.27 * b);
    add(torso, new THREE.SphereGeometry(0.035, 6, 6), MAT(c), (i - 1.5) * 0.13 * b + (k % 2) * 0.05, 0.15 + k * 0.17, -0.27 * b); } });
  if (d.jacket) add(torso, new THREE.CylinderGeometry(0.33 * b, 0.29 * b, 0.74, 16, 1, true), MAT(d.jacket, { side: THREE.DoubleSide, roughness: 0.35 }), 0, 0.38, 0);
  if (d.overshirt) add(torso, new THREE.CylinderGeometry(0.32 * b, 0.28 * b, 0.74, 16, 1, true), MAT(d.overshirt, { side: THREE.DoubleSide }), 0, 0.38, 0);
  if (d.vest) add(torso, new THREE.CylinderGeometry(0.325 * b, 0.285 * b, 0.6, 16, 1, true), MAT(d.vest, { side: THREE.DoubleSide }), 0, 0.33, 0);
  if (d.coat) add(torso, new THREE.CylinderGeometry(0.335 * b, 0.45 * b, 1.15, 18, 1, true), MAT(d.coat, { side: THREE.DoubleSide }), 0, 0.12, 0); // long open coat (lab coat)
  if (extras.includes('tie')) add(torso, new THREE.BoxGeometry(0.07, 0.4, 0.03), MAT(d.tie || 0xaa2222), 0, 0.5, 0.3 * b);
  if (extras.includes('pin')) add(torso, new THREE.SphereGeometry(0.03, 8, 8), MAT(0xd4af37, { metalness: 0.9 }), 0.14 * b, 0.62, 0.3 * b);

  // arms (pivot at shoulder)
  const arms = [];
  const sleeveCol = d.coat || d.jacket || d.overshirt || d.top;
  for (const x of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(x * 0.36 * b, 0.7, 0); torso.add(arm);
    const upper = sleeves === 'none' ? skin : MAT(sleeveCol);
    add(arm, new THREE.CylinderGeometry(0.09 * b, 0.08 * b, 0.4, 10), upper, 0, -0.2, 0);
    add(arm, new THREE.CylinderGeometry(0.075 * b, 0.065 * b, 0.38, 10), sleeves === 'long' ? MAT(sleeveCol) : skin, 0, -0.55, 0);
    add(arm, new THREE.SphereGeometry(0.08, 10, 10), skin, 0, -0.78, 0);
    if (extras.includes('watch') && x > 0) add(arm, new THREE.BoxGeometry(0.13, 0.07, 0.13), MAT(0x222222), 0, -0.68, 0);
    arms.push(arm);
  }

  // head
  const head = new THREE.Group(); head.position.y = 0.95; torso.add(head);
  add(head, new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10), skin, 0, -0.22, 0);
  add(head, new THREE.SphereGeometry(0.24, 24, 20), skin).scale.set(0.92, 1.05, 0.95);
  for (const x of [-0.09, 0.09]) {
    add(head, new THREE.SphereGeometry(0.035, 10, 10), MAT(0xffffff), x, 0.03, 0.21);
    add(head, new THREE.SphereGeometry(0.022, 10, 10), MAT(d.eyes), x, 0.03, 0.235);
  }
  add(head, new THREE.BoxGeometry(0.11, 0.02, 0.02), MAT(0x7a2f2f), 0, -0.1, 0.225);
  add(head, new THREE.SphereGeometry(0.035, 8, 8), skin, 0, -0.03, 0.235);
  if (extras.includes('nosering')) add(head, new THREE.TorusGeometry(0.018, 0.005, 6, 12), MAT(0xcccccc, { metalness: 1 }), 0.035, -0.05, 0.24);
  if (extras.includes('necklace') || extras.includes('choker')) {
    const n = add(head, new THREE.TorusGeometry(0.14, 0.01, 6, 24), MAT(extras.includes('choker') ? 0xdddddd : 0xd4af37, { metalness: 0.8 }), 0, -0.19, 0);
    n.rotation.x = Math.PI / 2;
  }
  if (extras.includes('stethoscope')) {
    const n = add(head, new THREE.TorusGeometry(0.17, 0.014, 6, 20), MAT(0x222222), 0, -0.3, 0.05); n.rotation.x = Math.PI / 2.4;
    add(head, new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), MAT(0xbbbbbb, { metalness: 0.8 }), 0, -0.62, 0.3).rotation.x = Math.PI / 2;
  }
  if (extras.includes('bandana')) {
    add(head, new THREE.CylinderGeometry(0.255, 0.255, 0.07, 20, 1, true), MAT(d.bandana || 0xb01818, { side: THREE.DoubleSide }), 0, 0.12, 0);
    add(head, new THREE.BoxGeometry(0.1, 0.08, 0.05), MAT(d.bandana || 0xb01818), 0, 0.12, -0.27);
  }
  if (extras.includes('glasses')) for (const x of [-0.09, 0.09]) add(head, new THREE.TorusGeometry(0.055, 0.008, 6, 16), MAT(0x111111), x, 0.03, 0.24);
  if (d.beard) add(head, new THREE.SphereGeometry(0.2, 16, 12, 0, 6.28, Math.PI * 0.5, Math.PI * 0.5), MAT(d.beard), 0, -0.04, 0.03).scale.set(0.95, 0.9, 0.95);

  // hair
  const h = d.hair || {}, hm = MAT(h.color ?? 0x111111);
  const cap = (r = 0.255) => add(head, new THREE.SphereGeometry(r, 20, 16, 0, 6.28, 0, Math.PI * 0.55), hm, 0, 0.02, -0.01);
  if (h.style === 'long') { cap(); add(head, new THREE.BoxGeometry(0.5, 0.7, 0.14), hm, 0, -0.3, -0.12); for (const x of [-1, 1]) add(head, new THREE.BoxGeometry(0.07, 0.65, 0.2), hm, x * 0.24, -0.28, 0); }
  if (h.style === 'short') cap(0.25);
  if (h.style === 'updo') { cap(); add(head, new THREE.SphereGeometry(0.14, 12, 12), hm, 0, 0.27, -0.08); }
  if (h.style === 'bob') { cap(); add(head, new THREE.BoxGeometry(0.5, 0.3, 0.14), hm, 0, -0.1, -0.13); for (const x of [-1, 1]) add(head, new THREE.BoxGeometry(0.07, 0.3, 0.2), hm, x * 0.24, -0.08, 0); }
  if (h.style === 'dreads') { cap(0.255); for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; add(head, new THREE.CylinderGeometry(0.022, 0.016, 0.6, 6), hm, Math.sin(a) * 0.23, -0.25, Math.cos(a) * 0.21 - 0.03); } }
  if (h.style === 'locs') { cap(0.25); for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; add(head, new THREE.CylinderGeometry(0.018, 0.014, 0.3, 6), hm, Math.sin(a) * 0.22, -0.12, Math.cos(a) * 0.2 - 0.02); } }

  // hats
  if (d.hat) {
    const c = MAT(d.hat.color);
    if (d.hat.type === 'beanie') {
      add(head, new THREE.SphereGeometry(0.27, 20, 14, 0, 6.28, 0, Math.PI * 0.5), c, 0, 0.06, 0).scale.y = 1.15;
      add(head, new THREE.CylinderGeometry(0.265, 0.265, 0.1, 20), c, 0, 0.07, 0);
      if (d.hat.studs) for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28; add(head, new THREE.SphereGeometry(0.015, 5, 5), MAT(0xffffff, { metalness: 1, roughness: 0.1 }), Math.sin(a) * 0.27, 0.08, Math.cos(a) * 0.27); }
    }
    if (d.hat.type === 'fedora') {
      add(head, new THREE.CylinderGeometry(0.4, 0.4, 0.025, 24), c, 0, 0.14, 0);
      add(head, new THREE.CylinderGeometry(0.2, 0.25, 0.2, 20), c, 0, 0.25, 0);
      add(head, new THREE.CylinderGeometry(0.252, 0.252, 0.04, 20), MAT(0x8a6a60), 0, 0.18, 0);
    }
    if (d.hat.type === 'cap') {
      add(head, new THREE.SphereGeometry(0.26, 20, 14, 0, 6.28, 0, Math.PI * 0.5), c, 0, 0.07, 0);
      add(head, new THREE.BoxGeometry(0.3, 0.02, 0.2), c, 0, 0.08, 0.3);
    }
  }

  const rig = { root, body, torso, head, arms, legs, cur: {} };
  return rig;
}

/* ---- procedural poses. Angles are rotation.x; negative = swing forward/up. ---- */
const P = (o) => ({ aL: -0.7, aR: -1.0, aLz: 0.15, aRz: -0.15, lL: 0.1, lR: -0.1, lLz: 0.1, lRz: -0.1, lean: 0.05, headX: 0, drop: 0, fall: 0, ...o });
export const POSES = {
  idle: (u) => { const s = Math.sin(u * 0.08) * 0.05; return P({ aL: -0.7 + s, aR: -1.0 + s, drop: -Math.abs(s) * 0.4 }); },
  walk: (u) => { const s = Math.sin(u * 0.28); return P({ lL: 0.7 * s, lR: -0.7 * s, aL: -0.6 - 0.5 * s, aR: -0.6 + 0.5 * s, lean: 0.1 }); },
  run: (u) => { const s = Math.sin(u * 0.42); return P({ lL: 1.0 * s, lR: -1.0 * s, aL: -1.0 - 0.9 * s, aR: -1.0 + 0.9 * s, lean: 0.4 }); },
  jump: () => P({ lL: -0.7, lR: 0.35, aL: -2.4, aR: -2.4, lean: 0 }),
  crouch: () => P({ drop: -0.42, lL: -1.0, lR: -1.0, lean: 0.3, aL: -1.0, aR: -1.0 }),
  block: () => P({ aL: -2.3, aR: -2.5, aLz: 0.05, aRz: -0.05, lean: 0.15 }),
  crouchblock: () => P({ drop: -0.42, lL: -1.0, lR: -1.0, lean: 0.35, aL: -2.3, aR: -2.5 }),
  lp: () => P({ aR: -1.57, aL: -0.5, lean: 0.15 }),
  hp: () => P({ aR: -1.6, aL: -0.4, lean: 0.4, lL: -0.3 }),
  lk: () => P({ lR: -1.4, lean: -0.2, aL: -1.0, aR: -1.2 }),
  hk: () => P({ lR: -1.7, lean: -0.45, aL: -1.4, aR: 0.4 }),
  up: () => P({ aR: -3.0, aL: -0.6, drop: -0.25, lean: 0.2, lL: -0.5 }),
  sweep: () => P({ drop: -0.45, lR: -1.55, lL: -1.0, lean: 0.5, aL: -1.2, aR: -1.2 }),
  jp: () => P({ aR: -1.57, aL: -2.0, lL: -0.7, lR: 0.3, lean: 0.2 }),
  jk: () => P({ lR: -1.4, lL: 0.2, aL: -2.0, aR: -2.2, lean: -0.1 }),
  fireball: () => P({ aL: -1.57, aR: -1.57, lean: 0.25 }),
  hit: () => P({ lean: -0.35, headX: -0.35, aL: 0.3, aR: 0.2, drop: -0.05 }),
  down: () => P({ fall: 1, aL: -0.2, aR: -0.2 }),
  fly: () => P({ fall: 0.55, aL: -0.4, aR: -0.4, lL: 0.2, lR: 0.2 }),
  getup: () => P({ drop: -0.45, lL: -1.0, lR: -1.0, lean: 0.4 }),
  win: (u) => P({ aL: -3.0 + Math.sin(u * 0.2) * 0.2, aR: -3.0 - Math.sin(u * 0.2) * 0.2, lean: -0.1 }),
};

/** Smoothly move a rig toward a pose. */
export function applyPose(rig, name, u = 0, k = 0.4) {
  const t = (POSES[name] || POSES.idle)(u), c = rig.cur;
  for (const key in t) c[key] = c[key] === undefined ? t[key] : c[key] + (t[key] - c[key]) * k;
  rig.arms[0].rotation.set(c.aL, 0, c.aLz); rig.arms[1].rotation.set(c.aR, 0, c.aRz);
  rig.legs[0].rotation.set(c.lL, 0, c.lLz); rig.legs[1].rotation.set(c.lR, 0, c.lRz);
  rig.torso.rotation.x = c.lean; rig.head.rotation.x = c.headX - c.lean * 0.5;
  rig.body.position.y = c.drop + 0.22 * c.fall; rig.body.rotation.x = -1.5 * c.fall;
}
