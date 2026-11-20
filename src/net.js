// Peer-to-peer link via PeerJS (WebRTC). The public PeerJS broker is used only to connect the two browsers;
// game data then flows directly between them. Needs <script src="peerjs"> loaded first (global `Peer`).
const PREFIX = 'brawl-arena-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = () => Array.from({ length: 5 }, () => ALPHABET[(Math.random() * ALPHABET.length) | 0]).join('');

export class Net {
  constructor() { this.conn = null; this.peer = null; this.onmsg = null; this.onclose = null; }

  host(onCode) {
    return new Promise((resolve, reject) => {
      const code = randCode();
      this.peer = new Peer(PREFIX + code);
      this.peer.on('open', () => onCode(code));
      this.peer.on('error', reject);
      this.peer.on('connection', (c) => {
        if (this.conn) { c.close(); return; }
        c.on('open', () => { this.attach(c); resolve(); });
      });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Could not reach that game. Check the code.')), 15000);
      this.peer = new Peer();
      this.peer.on('error', (e) => { clearTimeout(t); reject(e); });
      this.peer.on('open', () => {
        const c = this.peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
        c.on('open', () => { clearTimeout(t); this.attach(c); resolve(); });
      });
    });
  }

  attach(c) {
    this.conn = c;
    c.on('data', (d) => this.onmsg && this.onmsg(d));
    c.on('close', () => this.onclose && this.onclose());
  }

  send(m) { if (this.conn && this.conn.open) this.conn.send(m); }
  close() { try { this.conn && this.conn.close(); this.peer && this.peer.destroy(); } catch (e) {} this.conn = null; this.peer = null; }
}

const KEYS = ['l', 'r', 'u', 'd', 'lp', 'hp', 'lk', 'hk', 'bl', 'run'];
export const packInput = (i) => KEYS.reduce((n, k, b) => n | (i[k] ? 1 << b : 0), 0);
export const unpackInput = (n) => { const o = { sp: 0 }; KEYS.forEach((k, b) => (o[k] = (n >> b) & 1)); return o; };
