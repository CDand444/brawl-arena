import * as THREE from 'three';

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

/** Atmosphere + visual effects. Purely cosmetic: nothing here may affect the simulation (online lockstep). */
export function buildStage(scene, renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.fog = new THREE.Fog(0x2a0f2e, 16, 52);

  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({
    map: gradTex([[0, '#0d0518'], [0.45, '#3a1038'], [0.7, '#8a2a3c'], [1, '#e0703a']]), side: THREE.BackSide, fog: false }));
  scene.add(sky);

  // lights: warm key, cool rim, soft fill
  scene.add(new THREE.HemisphereLight(0xb8a8ff, 0x401828, 1.0));
  const key = new THREE.DirectionalLight(0xffe2c4, 2.6); key.position.set(3, 7, 7); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 6, bottom: -3 }); key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6a8aff, 1.8); rim.position.set(-4, 4, -7); scene.add(rim);

  // stone floor
  const fc = document.createElement('canvas'); fc.width = fc.height = 256;
  const fg = fc.getContext('2d'); fg.fillStyle = '#3a2f46'; fg.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { fg.fillStyle = `hsl(280,${14 + ((x + y) % 2) * 4}%,${22 + ((x * 3 + y * 5) % 4) * 2}%)`; fg.fillRect(x * 64 + 2, y * 64 + 2, 60, 60); }
  const ft = new THREE.CanvasTexture(fc); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(24, 5); ft.colorSpace = THREE.SRGBColorSpace; ft.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(96, 20), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // moon + glow
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.6, 28, 20), new THREE.MeshBasicMaterial({ color: 0xffe9c0, fog: false })); moon.position.set(0, 7, -22); scene.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc890, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  halo.scale.set(16, 16, 1); halo.position.copy(moon.position); scene.add(halo);

  // temple pillars + torches
  const flames = [];
  const stone = new THREE.MeshStandardMaterial({ color: 0x4a3a58, roughness: 0.8 }), dark = new THREE.MeshStandardMaterial({ color: 0x2a2036, roughness: 0.9 });
  for (let i = -7; i <= 7; i++) {
    const z = -8.5 - (Math.abs(i) % 2) * 2.5, h = 6 + (Math.abs(i * 7) % 3) * 0.6;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, h, 12), stone); col.position.set(i * 4, h / 2, z); col.castShadow = true; scene.add(col);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), dark); base.position.set(i * 4, 0.2, z); scene.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 1.5), dark); top.position.set(i * 4, h, z); scene.add(top);
    if (Math.abs(i) % 2 === 1 && Math.abs(i) <= 3) { // torch
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a2a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      f.scale.set(1.6, 2.2, 1); f.position.set(i * 4, 2.6, z + 0.9); scene.add(f);
      const l = new THREE.PointLight(0xff7a2a, 14, 11, 1.6); l.position.set(i * 4, 2.8, z + 1.4); scene.add(l);
      flames.push({ f, l, ph: i });
    }
  }
  // far wall silhouette
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(120, 12), new THREE.MeshBasicMaterial({ color: 0x1a0d24 })); wall.position.set(0, 6, -26); scene.add(wall);

  // drifting embers
  const N = 160, pos = new Float32Array(N * 3), vel = [];
  for (let i = 0; i < N; i++) { pos.set([(Math.random() - 0.5) * 40, Math.random() * 8, -Math.random() * 12], i * 3); vel.push(0.2 + Math.random() * 0.5); }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ map: glowTex, color: 0xff9a50, size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(embers);

  // spark pool (hit effects)
  const sparks = [];
  const api = {
    shake: 0,
    spark(x, y, n = 8, color = 0xffd070, power = 1) {
      for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        const sz = (0.15 + Math.random() * 0.3) * power; s.scale.set(sz, sz, 1); s.position.set(x, y, 0.3); scene.add(s);
        const a = Math.random() * Math.PI * 2, sp = (1.5 + Math.random() * 3.5) * power;
        sparks.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, life: 0.3 + Math.random() * 0.3, max: 0.6 });
      }
    },
    glow(color, size = 1.6) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.scale.set(size, size, 1); return s;
    },
    update(now, dt) {
      const t = now / 1000;
      flames.forEach(({ f, l, ph }) => { const fl = 0.85 + Math.sin(t * 11 + ph * 3) * 0.1 + Math.sin(t * 23 + ph) * 0.08; l.intensity = 14 * fl; f.scale.set(1.6 * fl, 2.2 * fl, 1); });
      const p = eg.attributes.position;
      for (let i = 0; i < N; i++) { let y = p.getY(i) + vel[i] * dt; if (y > 9) y = 0; p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(t + i) * dt * 0.3); }
      p.needsUpdate = true;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const k = sparks[i]; k.life -= dt; k.vy -= 9 * dt; k.s.position.x += k.vx * dt; k.s.position.y += k.vy * dt;
        k.s.material.opacity = Math.max(0, k.life / k.max);
        if (k.life <= 0) { scene.remove(k.s); k.s.material.dispose(); sparks.splice(i, 1); }
      }
      api.shake *= 0.86;
    },
  };
  return api;
}
