import * as THREE from 'three';

/* ---- shared helpers ---- */
const gradTex = (stops, w = 8, h = 256) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, h);
  stops.forEach(([p, col]) => gr.addColorStop(p, col)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const canvasTex = (w, h, draw, repeat) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); } return t;
};
const glowSprite = (color, sx, sy, x, y, z) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  s.scale.set(sx, sy, 1); s.position.set(x, y, z); return s;
};
const sky = (G, stops) => { const m = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16), new THREE.MeshBasicMaterial({ map: gradTex(stops), side: THREE.BackSide, fog: false })); G.add(m); return m; };
const floorPlane = (G, tex, rough = 0.6, metal = 0.1) => {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(96, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: metal }));
  f.rotation.x = -Math.PI / 2; f.receiveShadow = true; f.userData.floor = true; G.add(f); return f;
};
let shadowSize = 2048; const shadowLights = [];
const keyLight = (G, color, intensity, x, y, z) => {
  const l = new THREE.DirectionalLight(color, intensity); l.position.set(x, y, z); l.castShadow = shadowSize > 0;
  Object.assign(l.shadow.camera, { left: -19, right: 19, top: 8, bottom: -4 }); l.shadow.mapSize.set(shadowSize || 1024, shadowSize || 1024); l.shadow.bias = -0.0005; G.add(l); shadowLights.push(l); return l;
};
const dirLight = (G, color, intensity, x, y, z) => { const l = new THREE.DirectionalLight(color, intensity); l.position.set(x, y, z); G.add(l); return l; };

/* ---- the stages. Each builder fills group G and returns an optional per-frame tick(t, dt). Purely cosmetic. ---- */
export const MAPS = [
  { id: 'temple', name: 'Moonlit Temple' },
  { id: 'arch', name: 'Gateway Arch, St. Louis' },
  { id: 'city', name: 'Neon Rooftop' },
];

function temple(G, scene, env) {
  scene.fog = new THREE.Fog(0x2a0f2e, 34, 110); env.embers(0xff9a50, 1);
  sky(G, [[0, '#0d0518'], [0.45, '#3a1038'], [0.7, '#8a2a3c'], [1, '#e0703a']]);
  G.add(new THREE.HemisphereLight(0xb8a8ff, 0x401828, 1.0));
  keyLight(G, 0xffe2c4, 2.6, 3, 7, 7); dirLight(G, 0x6a8aff, 1.8, -4, 4, -7);
  floorPlane(G, canvasTex(256, 256, (g) => {
    g.fillStyle = '#3a2f46'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(280,${14 + ((x + y) % 2) * 4}%,${22 + ((x * 3 + y * 5) % 4) * 2}%)`; g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60); }
  }, [24, 5]), 0.55, 0.15);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.6, 28, 20), new THREE.MeshBasicMaterial({ color: 0xffe9c0, fog: false })); moon.position.set(0, 7, -22); G.add(moon);
  const halo = glowSprite(0xffc890, 16, 16, 0, 7, -22); halo.material.fog = false; G.add(halo);
  const flames = [], stone = new THREE.MeshStandardMaterial({ color: 0x4a3a58, roughness: 0.8 }), dark = new THREE.MeshStandardMaterial({ color: 0x2a2036, roughness: 0.9 });
  for (let i = -7; i <= 7; i++) {
    const z = -8.5 - (Math.abs(i) % 2) * 2.5, h = 6 + (Math.abs(i * 7) % 3) * 0.6;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, h, 12), stone); col.position.set(i * 4, h / 2, z); col.castShadow = true; G.add(col);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), dark); base.position.set(i * 4, 0.2, z); G.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 1.5), dark); top.position.set(i * 4, h, z); G.add(top);
    if (Math.abs(i) % 2 === 1 && Math.abs(i) <= 3) {
      const f = glowSprite(0xff8a2a, 1.6, 2.2, i * 4, 2.6, z + 0.9); G.add(f);
      let l = null; // only the two nearest torches get a real light (every extra light slows every pixel)
      if (Math.abs(i) === 1) { l = new THREE.PointLight(0xff7a2a, 14, 11, 1.6); l.position.set(i * 4, 2.8, z + 1.4); G.add(l); }
      flames.push({ f, l, ph: i });
    }
  }
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(120, 12), new THREE.MeshBasicMaterial({ color: 0x1a0d24 })); wall.position.set(0, 6, -26); G.add(wall);
  return (t) => flames.forEach(({ f, l, ph }) => { const fl = 0.85 + Math.sin(t * 11 + ph * 3) * 0.1 + Math.sin(t * 23 + ph) * 0.08; if (l) l.intensity = 14 * fl; f.scale.set(1.6 * fl, 2.2 * fl, 1); });
}

function arch(G, scene, env) {
  scene.fog = new THREE.Fog(0xd29a78, 40, 130); env.embers(0xffe0a0, 0.5);
  sky(G, [[0, '#18286a'], [0.35, '#5a5a9a'], [0.62, '#e88a6a'], [0.82, '#ffb878'], [1, '#ffd89a']]);
  const sun = glowSprite(0xffcf80, 30, 30, 16, 3.5, -48); sun.material.fog = false; G.add(sun);
  const core = glowSprite(0xfff2d0, 7, 7, 16, 3.5, -47.5); core.material.fog = false; G.add(core);
  G.add(new THREE.HemisphereLight(0xffe0c0, 0x4a5a7a, 1.15));
  keyLight(G, 0xfff0dd, 2.4, 3, 7, 8); dirLight(G, 0xffb070, 2.4, 9, 3, -9);

  // plaza paving, grass band, riverbank
  floorPlane(G, canvasTex(256, 256, (g) => {
    g.fillStyle = '#a89580'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = `hsl(32,${10 + ((x * 5 + y * 3) % 4)}%,${58 + ((x * 3 + y * 7) % 5) * 2}%)`; g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30); }
  }, [32, 8]), 0.85, 0);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, 12), new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 })); grass.rotation.x = -Math.PI / 2; grass.position.set(0, 0.002, -16); grass.receiveShadow = true; G.add(grass);
  const river = new THREE.Mesh(new THREE.PlaneGeometry(160, 40), new THREE.MeshStandardMaterial({
    map: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#2c4e78'; g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,${190 + Math.random() * 60 | 0},${120 + Math.random() * 80 | 0},${Math.random() * 0.35})`; g.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 26, 1.5); } }, [14, 5]),
    roughness: 0.25, metalness: 0.4 }));
  river.rotation.x = -Math.PI / 2; river.position.set(0, -0.6, -42); G.add(river);

  // the Gateway Arch (weighted-catenary look, stainless steel, tapering)
  const steel = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, metalness: 0.45, roughness: 0.22, emissive: 0x3a4658 });
  const AH = 12, AW = 6.4, N = 46, pt = (t) => new THREE.Vector3(t * AW, AH * (1 - Math.pow(Math.abs(t), 1.75)), -26);
  for (let i = 0; i < N; i++) {
    const t0 = -1 + (2 * i) / N, t1 = -1 + (2 * (i + 1)) / N, a = pt(t0), b = pt(t1), mid = a.clone().add(b).multiplyScalar(0.5);
    const th = 0.38 + 0.62 * Math.pow(1 - Math.abs((t0 + t1) / 2), 0.8) * 0.9, len = a.distanceTo(b) * 1.06;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, th, th * 1.25), steel); seg.position.copy(mid); seg.rotation.z = Math.atan2(b.y - a.y, b.x - a.x); G.add(seg);
  }
  G.add(glowSprite(0xffd8a0, 4, 14, 3.2, 6, -25.4)); // sun glint on the arch

  // St. Louis skyline across the river: towers with lit windows + Old Courthouse dome
  const win = canvasTex(64, 128, (g, w, h) => { g.fillStyle = '#2a2a3c'; g.fillRect(0, 0, w, h); for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) { if (Math.random() < 0.45) { g.fillStyle = Math.random() < 0.7 ? '#ffd890' : '#bcd8ff'; g.fillRect(x, y, 4, 5); } } });
  const bm = new THREE.MeshStandardMaterial({ map: win, emissiveMap: win, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.9 });
  for (let i = -16; i <= 16; i++) {
    const h = 3 + Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) * 6, w = 1.6 + Math.abs(Math.sin(i * 7.31) * 9.1 % 1) * 1.6;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bm); b.position.set(i * 3.2 + 8 - 8, h / 2 - 0.6, -58 - (Math.abs(i) % 3) * 3); G.add(b);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12, 0, 6.28, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfd6dc, emissive: 0x3a4048 })); dome.position.set(-9, 4.2, -52); G.add(dome);
  const dbase = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), bm); dbase.position.set(-9, 2, -52); G.add(dbase);

  // plaza lamps, rail and sign
  const lamps = [];
  for (const x of [-9, -3, 3, 9]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0x2a2a30 })); post.position.set(x, 1.6, -5); post.castShadow = true; G.add(post);
    const bulb = glowSprite(0xffe0a0, 1.2, 1.2, x, 3.3, -5); G.add(bulb); lamps.push(bulb);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(60, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2a30 })); rail.position.set(0, 1.0, -5.6); G.add(rail);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.9), new THREE.MeshBasicMaterial({ map: canvasTex(512, 52, (g, w, h) => { g.fillStyle = '#1c2a44'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd890'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ST. LOUIS  ·  GATEWAY TO THE WEST', w / 2, h / 2 + 2); }) }));
  sign.position.set(0, 0.55, -5.5); G.add(sign);
  return (t) => lamps.forEach((l, i) => { const f = 1 + Math.sin(t * 3 + i) * 0.05; l.scale.set(1.2 * f, 1.2 * f, 1); });
}

function city(G, scene, env) {
  scene.fog = new THREE.Fog(0x140a26, 30, 105); env.embers(0x66e8ff, 0); env.rain(true);
  sky(G, [[0, '#06020e'], [0.45, '#220c44'], [0.8, '#6a2478'], [1, '#d04a8a']]);
  G.add(new THREE.HemisphereLight(0x8a7aff, 0x201030, 0.95));
  keyLight(G, 0xff9ad0, 2.3, 4, 6, 7); dirLight(G, 0x30d8ff, 2.4, -5, 4, -6);
  floorPlane(G, canvasTex(256, 256, (g) => {
    g.fillStyle = '#26232e'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(260,8%,${15 + ((x * 3 + y * 5) % 4) * 2}%)`; g.fillRect(x * 64 + 3, y * 64 + 3, 58, 58); }
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 126, 256, 4); // painted line
  }, [24, 5]), 0.35, 0.35);
  const win = canvasTex(64, 128, (g, w, h) => { g.fillStyle = '#14121e'; g.fillRect(0, 0, w, h); for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) { if (Math.random() < 0.4) { g.fillStyle = ['#ffd890', '#ff7ac8', '#7affff', '#ffffff'][Math.random() * 4 | 0]; g.fillRect(x, y, 4, 5); } } });
  const bm = new THREE.MeshStandardMaterial({ map: win, emissiveMap: win, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.9 });
  for (let i = -12; i <= 12; i++) {
    const h = 7 + Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) * 14, w = 3 + Math.abs(Math.sin(i * 7.31) * 9.1 % 1) * 3;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bm); b.position.set(i * 4.2, h / 2 - 1, -16 - (Math.abs(i) % 4) * 5); G.add(b);
  }
  const neon = (txt, color, x, y, z, w = 5) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.28), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex(256, 72, (g, ww, hh) => { g.clearRect(0, 0, ww, hh); g.font = 'bold 46px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = '#fff'; g.fillText(txt, ww / 2, hh / 2); g.strokeStyle = color; g.lineWidth = 3; g.strokeText(txt, ww / 2, hh / 2); }), depthWrite: false }));
    m.position.set(x, y, z); G.add(m); G.add(glowSprite(color, w * 1.3, w * 0.5, x, y, z - 0.05)); return m;
  };
  const signs = [neon('BRAWL', '#ff3aa8', -7, 7, -13), neon('OPEN 24H', '#30e8ff', 6, 5.2, -13, 4), neon('ARENA', '#ffd02a', 0, 10, -17, 6)];
  const wallm = new THREE.Mesh(new THREE.BoxGeometry(60, 1.0, 0.6), new THREE.MeshStandardMaterial({ color: 0x1c1a26, roughness: 0.9 })); wallm.position.set(0, 0.5, -5); wallm.castShadow = true; G.add(wallm);
  for (const x of [-10, -3, 8]) { const ac = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0x3a3848, roughness: 0.7 })); ac.position.set(x, 1.55, -5); ac.castShadow = true; G.add(ac); }
  const beacon = glowSprite(0xff2a2a, 1.4, 1.4, 12, 6, -6); G.add(beacon);
  return (t) => { beacon.material.opacity = 0.35 + 0.65 * (Math.sin(t * 4) > 0 ? 1 : 0); signs.forEach((s, i) => { s.material.opacity = Math.sin(t * 7 + i * 2) > -0.9 ? 1 : 0.55; }); };
}
const BUILDERS = { temple, arch, city };

/** Atmosphere + visual effects. Purely cosmetic: nothing here may affect the simulation (online lockstep). */
export function buildStage(scene, renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // persistent particles
  const N = 160, pos = new Float32Array(N * 3), vel = [];
  for (let i = 0; i < N; i++) { pos.set([(Math.random() - 0.5) * 40, Math.random() * 8, -Math.random() * 12], i * 3); vel.push(0.2 + Math.random() * 0.5); }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: glowTex, color: 0xff9a50, size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(embers);
  const RN = 400, rp = new Float32Array(RN * 3);
  for (let i = 0; i < RN; i++) rp.set([(Math.random() - 0.5) * 40, Math.random() * 14, -Math.random() * 14 + 3], i * 3);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0x9ad8ff, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false })); rain.visible = false; scene.add(rain);
  const env = { embers: (color, amount) => { embers.visible = amount > 0; embers.material.color.setHex(color); embers.material.opacity = amount; }, rain: (on) => { rain.visible = on; } };

  let group = null, tick = null, current = null, smashMode = false;
  const applySmash = () => { if (!group) return; group.position.y = smashMode ? -9 : 0; group.traverse((o) => { if (o.userData.floor) o.visible = !smashMode; }); }; // Smash: the arena floats above the backdrop
  // spark pool: sprites and materials are created once and reused (creating/disposing per hit caused garbage-collection hitches)
  const POOL = 220, pool = [];
  for (let i = 0; i < POOL; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); sp.visible = false; scene.add(sp);
    pool.push({ s: sp, vx: 0, vy: 0, life: 0, max: 0.6 });
  }
  const api = {
    shake: 0,
    get map() { return current; },
    setSmash(on) { smashMode = on; applySmash(); },
    setShadows(n) {
      shadowSize = n;
      shadowLights.forEach((l) => { l.castShadow = n > 0; if (n > 0) { l.shadow.mapSize.set(n, n); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } } });
    },
    setMap(id) {
      if (!BUILDERS[id] || id === current) return;
      if (group) { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map !== glowTex) { o.material.map?.dispose?.(); o.material.dispose?.(); } }); }
      current = id; group = new THREE.Group(); scene.add(group); env.rain(false); shadowLights.length = 0; tick = BUILDERS[id](group, scene, env) || null; applySmash();
    },
    spark(x, y, n = 8, color = 0xffd070, power = 1) {
      let made = 0;
      for (let i = 0; i < pool.length && made < n; i++) {
        const k = pool[i]; if (k.life > 0) continue; made++;
        const sz = (0.15 + Math.random() * 0.3) * power; k.s.scale.set(sz, sz, 1); k.s.position.set(x, y, 0.3); k.s.material.color.setHex(color); k.s.material.opacity = 1; k.s.visible = true;
        const a = Math.random() * Math.PI * 2, sp = (1.5 + Math.random() * 3.5) * power;
        k.vx = Math.cos(a) * sp; k.vy = Math.sin(a) * sp + 1; k.life = 0.3 + Math.random() * 0.3; k.max = 0.6;
      }
    },
    glow(color, size = 1.6) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.scale.set(size, size, 1); return s;
    },
    update(now, dt) {
      const t = now / 1000;
      if (tick) tick(t, dt);
      if (embers.visible) { const p = eg.attributes.position; for (let i = 0; i < N; i++) { let y = p.getY(i) + vel[i] * dt; if (y > 9) y = 0; p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(t + i) * dt * 0.3); } p.needsUpdate = true; }
      if (rain.visible) { const p = rg.attributes.position; for (let i = 0; i < RN; i++) { let y = p.getY(i) - 14 * dt; if (y < 0) y = 14; p.setY(i, y); } p.needsUpdate = true; }
      for (let i = 0; i < pool.length; i++) {
        const k = pool[i]; if (k.life <= 0) continue;
        k.life -= dt; k.vy -= 9 * dt; k.s.position.x += k.vx * dt; k.s.position.y += k.vy * dt;
        if (k.life <= 0) k.s.visible = false; else k.s.material.opacity = Math.min(1, k.life / k.max);
      }
      api.shake *= 0.86;
    },
  };
  return api;
}
