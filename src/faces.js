import * as THREE from 'three';

// Photos are stored AES-256 encrypted (openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256) so the public repo
// never contains readable photos. They are decrypted in the browser with the group password.
export const normalize = (s) => { const m = /[#?&]k=([^&\s]+)/i.exec(s); return (m ? m[1] : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }; // accepts the password or a pasted share link
export const canDecrypt = () => !!(globalThis.crypto && crypto.subtle); // needs https or localhost

async function decrypt(buf, pw) {
  const u = new Uint8Array(buf);
  if (new TextDecoder().decode(u.slice(0, 8)) !== 'Salted__') throw new Error('bad file');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: u.slice(8, 16), iterations: 200000, hash: 'SHA-256' }, base, 384));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-CBC', false, ['decrypt']);
  const out = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: bits.slice(32, 48) }, key, u.slice(16)));
  if (out[0] !== 0xff || out[1] !== 0xd8) throw new Error('wrong password'); // must be a JPEG
  return out;
}

async function faceTexture(def, pw) {
  const bytes = await decrypt(await (await fetch(def.face.src)).arrayBuffer(), pw);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const [x, y, w, h] = def.face.crop, c = document.createElement('canvas');
  c.width = 256; c.height = Math.round((256 * h) / w);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, x, y, w, h, 0, 0, c.width, c.height);
  const m = def.face.match || 0; // 0..1: pull the photo's average color toward the character's skin tone (fixes tinted lighting)
  if (m > 0) {
    const im = g.getImageData(0, 0, c.width, c.height), p = im.data, tgt = new THREE.Color(def.skin); // stored linear by three's color management
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = c.height * 0.25; y < c.height * 0.75; y++) for (let x = c.width * 0.25; x < c.width * 0.75; x++) { const i = (y | 0) * c.width * 4 + (x | 0) * 4; r += p[i]; gg += p[i + 1]; b += p[i + 2]; n++; }
    const mean = [r / n, gg / n, b / n], want = [tgt.r, tgt.g, tgt.b].map((v) => 255 * Math.pow(v, 1 / 2.2));
    const k = mean.map((v, i) => 1 + (want[i] / Math.max(v, 1) - 1) * m);
    for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) p[i + j] = Math.min(255, p[i + j] * k[j]);
    g.putImageData(im, 0, 0);
  }
  return new THREE.CanvasTexture(c);
}

/** Returns {id: texture}. Throws if the password is wrong. */
export async function loadFaces(defs, password) {
  const pw = normalize(password), withFace = defs.filter((d) => d.face), out = {};
  if (!withFace.length) return out;
  out[withFace[0].id] = await faceTexture(withFace[0], pw); // throws on a wrong password
  await Promise.all(withFace.slice(1).map(async (d) => { try { out[d.id] = await faceTexture(d, pw); } catch (e) { /* keep stylized */ } }));
  return out;
}
