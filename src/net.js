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

const KEYS = ['l', 'r', 'u', 'd', 'lp', 'hp', 'lk', 'hk', 'bl', 'run', 'sp', 'ult', 'th'];
export const packInput = (i) => KEYS.reduce((n, k, b) => n | (i[k] ? 1 << b : 0), 0);
export const unpackInput = (n) => { const o = {}; KEYS.forEach((k, b) => (o[k] = (n >> b) & 1)); return o; };

/** Live lobby over PeerJS. Whoever opens the Online screen first becomes the "lobby server" (a well-known peer id for the group);
 *  everyone else connects to it, registers their open room, and receives the live list. If the server tab closes, a client takes over. */
export class Lobby {
  constructor(id, onRooms) { this.id = id; this.onRooms = onRooms; this.peer = null; this.role = null; this.conns = new Set(); this.rooms = new Map(); this.up = null; this.room = null; this.dead = false; }
  start() { this.dead = false; this.tryServer(); }
  tryServer() {
    if (this.dead) return;
    let p; try { p = new Peer(this.id); } catch (e) { return; }
    this.peer = p;
    p.on('open', () => { this.role = 'server'; this.broadcast(); });
    p.on('disconnected', () => { try { p.reconnect(); } catch (e) {} });
    p.on('connection', (c) => {
      c.on('open', () => { this.conns.add(c); c.send({ t: 'rooms', rooms: this.list() }); });
      c.on('data', (m) => { if (m.t === 'room') this.rooms.set(c.peer, m.room); else if (m.t === 'noroom') this.rooms.delete(c.peer); this.broadcast(); });
      c.on('close', () => { this.conns.delete(c); this.rooms.delete(c.peer); this.broadcast(); });
    });
    p.on('error', (e) => { if (e.type === 'unavailable-id') { try { p.destroy(); } catch (x) {} this.tryClient(); } else this.retry(); });
  }
  tryClient() {
    if (this.dead) return;
    let p; try { p = new Peer(); } catch (e) { return; }
    this.peer = p;
    p.on('open', () => {
      const c = p.connect(this.id, { reliable: true }); this.up = c;
      c.on('open', () => { this.role = 'client'; if (this.room) c.send({ t: 'room', room: this.room }); });
      c.on('data', (m) => { if (m.t === 'rooms') this.onRooms(m.rooms); });
      c.on('close', () => { this.up = null; this.retry(); });
    });
    p.on('error', () => this.retry());
  }
  retry() { if (this.dead) return; this.stopPeer(); setTimeout(() => this.tryServer(), 600 + Math.random() * 1500); }
  list() { const r = [...this.rooms.values()]; if (this.room) r.push(this.room); return r; }
  broadcast() { const l = this.list(); this.onRooms(l); for (const c of this.conns) if (c.open) c.send({ t: 'rooms', rooms: l }); }
  setRoom(room) {
    this.room = room;
    if (this.role === 'server') this.broadcast();
    else if (this.up && this.up.open) this.up.send(room ? { t: 'room', room } : { t: 'noroom' });
  }
  stopPeer() { try { this.peer && this.peer.destroy(); } catch (e) {} this.peer = null; this.role = null; this.up = null; this.conns.clear(); this.rooms.clear(); }
  stop() { this.dead = true; this.stopPeer(); this.onRooms([]); }
}

/** Smash room: one host, up to 3 guests (star network). Guests only talk to the host; the host relays. */
export class Room {
  constructor() { this.peer = null; this.peers = new Map(); this.up = null; this.isHost = false; this.code = null; this.queue = []; this.h = null; }
  /** Attach handlers ({ msg(m, from), join(id), leave(id) }); flushes anything that arrived before. */
  listen(h) { this.h = h; const q = this.queue; this.queue = []; for (const [kind, a, b] of q) this.emit(kind, a, b); }
  emit(kind, a, b) { if (!this.h) { this.queue.push([kind, a, b]); return; } if (this.h[kind]) this.h[kind](a, b); }
  host() {
    return new Promise((resolve, reject) => {
      const code = Array.from({ length: 6 }, () => ALPHABET[(Math.random() * ALPHABET.length) | 0]).join('');
      this.code = code; this.isHost = true;
      const p = new Peer(PREFIX + 'room-' + code); this.peer = p;
      p.on('open', () => resolve(code));
      p.on('error', (e) => reject(e));
      p.on('disconnected', () => { try { p.reconnect(); } catch (e) {} });
      p.on('connection', (c) => {
        c.on('open', () => { this.peers.set(c.peer, c); this.emit('join', c.peer); });
        c.on('data', (m) => this.emit('msg', m, c.peer));
        c.on('close', () => { if (this.peers.delete(c.peer)) this.emit('leave', c.peer); });
      });
    });
  }
  join(code) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Could not reach that room. Check the code.')), 15000);
      const p = new Peer(); this.peer = p;
      p.on('error', (e) => { clearTimeout(t); reject(e); });
      p.on('open', () => {
        const c = p.connect(PREFIX + 'room-' + code.trim().toUpperCase(), { reliable: true });
        c.on('open', () => { clearTimeout(t); this.up = c; resolve(); });
        c.on('data', (m) => this.emit('msg', m, 'host'));
        c.on('close', () => this.emit('leave', 'host'));
      });
    });
  }
  send(m, to) { if (this.isHost) { const c = this.peers.get(to); if (c && c.open) c.send(m); } else if (this.up && this.up.open) this.up.send(m); }
  broadcast(m, except) { if (!this.isHost) return this.send(m); for (const [id, c] of this.peers) if (id !== except && c.open) c.send(m); }
  kick(id) { const c = this.peers.get(id); if (c) { this.peers.delete(id); try { c.close(); } catch (e) {} } }
  close() { this.h = null; try { this.peer && this.peer.destroy(); } catch (e) {} this.peers.clear(); this.up = null; this.peer = null; }
}
