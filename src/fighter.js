import { EMPTY } from './input.js';

// Frame data at 60 ticks/sec. s=startup a=active r=recovery  y=[low,high] hit height  hs/bs=hit/block stun  kb=knockback
// chain: after this move connects (hit or block) the player may cancel it into a different normal or special.
export const MOVES = {
  lp:    { s: 3, a: 3, r: 7,  dmg: 4,  reach: 1.15, y: [1.1, 1.8], hs: 14, bs: 8,  kb: 0.05, pose: 'lp', chain: true },
  hp:    { s: 6, a: 4, r: 14, dmg: 8,  reach: 1.25, y: [1.1, 1.9], hs: 20, bs: 12, kb: 0.12, pose: 'hp', chain: true },
  lk:    { s: 5, a: 3, r: 9,  dmg: 5,  reach: 1.4,  y: [0.4, 1.4], hs: 15, bs: 9,  kb: 0.06, pose: 'lk', chain: true },
  hk:    { s: 9, a: 4, r: 18, dmg: 10, reach: 1.65, y: [0.6, 1.7], hs: 22, bs: 14, kb: 0.2,  pose: 'hk' },
  up:    { s: 7, a: 4, r: 20, dmg: 12, reach: 1.1,  y: [0.6, 2.4], launch: true, kb: 0.1, bs: 14, pose: 'up', crouching: true },
  sweep: { s: 8, a: 4, r: 22, dmg: 8,  reach: 1.6,  y: [0, 0.5],   low: true, knock: true, kb: 0.14, bs: 14, pose: 'sweep', crouching: true },
  jp:    { air: true, dmg: 7, reach: 1.1, y: [0.7, 1.9], hs: 18, bs: 10, kb: 0.1, pose: 'jp' },
  jk:    { air: true, dmg: 8, reach: 1.4, y: [0.2, 1.3], hs: 18, bs: 10, kb: 0.12, pose: 'jk' },
  fb:    { s: 14, a: 0, r: 16, dmg: 10, pose: 'fireball', projectile: 'fb' },
  ult:   { s: 34, a: 0, r: 26, dmg: 30, pose: 'fireball', projectile: 'ult' }, // Ultimate: needs a full Super meter
};

const BUFFER = 7;        // ticks a button press is remembered, so near-simultaneous inputs still register
const MAX_CHAIN = 3;     // cancels allowed per string
const PRESS = ['lp', 'hp', 'lk', 'hk', 'sp'];

/* NOTE: everything in here runs in lockstep on both machines in online play. Keep it deterministic:
   no Math.random / Date.now / Math.pow, and only add/subtract/multiply/divide on numbers. */
export class Fighter {
  constructor(def, rig, side, getInput) {
    this.def = def; this.rig = rig; this.side = side; this.getInput = getInput;
    const st = def.stats || {};
    this.speed = st.speed ?? 1; this.power = st.power ?? 1; this.maxHp = 100 * (st.health ?? 1);
    this.reset(side === 0 ? -2 : 2);
  }

  reset(x) {
    Object.assign(this, { x, px: x, py: 0, y: 0, vy: 0, vx: 0, wv: 0, face: this.side === 0 ? 1 : -1, hp: this.maxHp, state: 'idle', t: 0, move: null, airMove: null,
      hitDone: false, comboHits: 0, comboDmg: 0, inv: 0, stun: 0, crouchBlock: false, prev: EMPTY(), hist: [], fbCooldown: 0, u: 0, meter: 0,
      buf: null, bufT: 0, chain: 0, djUsed: false, dj0: 0 });
  }

  get crouching() { return this.state === 'crouch' || (this.state === 'block' && this.crouchBlock) || (this.state === 'attack' && this.move.crouching); }
  get grounded() { return this.y <= 0.001 && this.vy <= 0; }

  startAttack(name, chained = false) {
    this.state = 'attack'; this.move = MOVES[name]; this.moveName = name; this.t = 0; this.hitDone = false; this.vx = 0; this.wv = 0;
    this.chain = chained ? this.chain + 1 : 0; this.buf = null; this.bufT = 0;
  }

  hasQCF() { // down, down+forward, forward within the last ~24 ticks
    let st = 0;
    for (const h of this.hist) {
      if (st === 0 && h.d && !h.f) st = 1;
      else if (st === 1 && h.d && h.f) st = 2;
      else if (st === 2 && h.f && !h.d) return true;
    }
    return false;
  }

  /** Read this tick's input: edge-detect presses, keep the direction history, remember the latest attack press for a few ticks. */
  poll(inputOverride) {
    const inp = inputOverride || this.getInput(), pr = {};
    for (const k in inp) pr[k] = inp[k] && !this.prev[k];
    this.prev = inp;
    const fwd = this.face > 0 ? inp.r : inp.l;
    this.hist.push({ d: inp.d, f: fwd }); if (this.hist.length > 24) this.hist.shift();
    for (const k of PRESS) if (pr[k]) { this.buf = k; this.bufT = BUFFER; }
    if (pr.ult) { this.buf = 'ult'; this.bufT = BUFFER; }
    // ep = presses including the buffered one
    const ep = { ...pr };
    if (this.bufT > 0 && this.buf) ep[this.buf] = 1; else this.buf = null;
    if (this.bufT > 0) this.bufT--;
    return { inp, pr, ep };
  }

  /** Pick the attack for a set of (buffered) presses, or null. */
  chooseAttack(ep, inp, special = true) {
    if (special) {
      if (this.meter >= 100 && (ep.ult || (ep.hk && this.hasQCF()))) return 'ult';
      if ((ep.lp || ep.hp || ep.sp) && this.fbCooldown === 0 && (ep.sp || this.hasQCF())) return 'fb';
    }
    if (ep.hp && inp.d) return 'up';
    if (ep.lk && inp.d) return 'sweep';
    for (const m of ['hp', 'hk', 'lk', 'lp']) if (ep[m]) return m;
    return null;
  }

  update(opp, game, inputOverride) {
    this.px = this.x; this.py = this.y; // previous tick, for smooth rendering between sim steps
    const { inp, pr, ep } = this.poll(inputOverride);
    this.u++;
    if (this.fbCooldown > 0) this.fbCooldown--;
    if (this.inv > 0) this.inv--;
    this.t++;
    const dirIn = inp.r - inp.l;

    // vertical physics
    if (this.y > 0 || this.vy > 0) { this.y += this.vy; this.vy -= 0.013; if (this.y <= 0) { this.y = 0; this.vy = 0; this.onLand(); } }
    // horizontal
    this.x += this.vx; if (this.state !== 'air' && this.state !== 'down') this.vx *= 0.8;
    this.x = Math.max(-game.bounds, Math.min(game.bounds, this.x));

    const free = ['idle', 'walk', 'run', 'crouch', 'block'].includes(this.state);
    if (free) this.face = opp.x >= this.x ? 1 : -1;

    switch (this.state) {
      case 'idle': case 'walk': case 'run': case 'crouch': case 'block': {
        this.crouchBlock = false;
        const atk = this.chooseAttack(ep, inp);
        if (atk) {
          this.startAttack(atk);
          if (atk === 'ult') { this.meter = 0; this.hist.length = 0; if (game.onUlt) game.onUlt(this); }
          if (atk === 'fb') this.hist.length = 0;
          break;
        }
        if (inp.u && !inp.d) { // jump, keeping run/walk momentum
          this.vy = 0.27; this.vx = dirIn ? dirIn * Math.max(Math.abs(this.wv), 0.045 * this.speed) : 0; this.wv = 0;
          this.state = 'air'; this.airMove = null; this.hitDone = false; this.djUsed = false; break;
        }
        let target = 0;
        if (inp.bl) { this.state = 'block'; this.crouchBlock = !!inp.d; }
        else if (inp.d) this.state = 'crouch';
        else if (dirIn) {
          const running = inp.run && (dirIn > 0) === (this.face > 0);
          target = dirIn * (running ? 0.085 : 0.045) * this.speed; this.state = running ? 'run' : 'walk';
        } else this.state = 'idle';
        this.wv += (target - this.wv) * 0.3; this.x += this.wv; // smooth acceleration / deceleration
        break;
      }
      case 'attack': {
        const m = this.move;
        if (m.projectile) { if (this.t === m.s) game.spawnProjectile(this, m.projectile); }
        else if (this.t > m.s && this.t <= m.s + m.a && !this.hitDone) {
          if (game.tryHit(this, opp, m)) this.hitDone = true;
          if (m.reach > 1.5) this.x += this.face * 0.01;
        }
        // chain cancel: once a light move has connected, cancel into a different normal / special
        if (m.chain && this.hitDone && this.t > m.s && this.chain < MAX_CHAIN) {
          const nxt = this.chooseAttack(ep, inp, true);
          if (nxt && nxt !== this.moveName && nxt !== 'ult') { this.startAttack(nxt, true); if (nxt === 'fb') this.hist.length = 0; break; }
        }
        if (this.t >= m.s + (m.a || 0) + m.r) this.state = 'idle';
        break;
      }
      case 'air': {
        // double jump: tap jump again in the air (once per jump)
        if (pr.u && !this.djUsed) {
          this.djUsed = true; this.dj0 = this.u; this.vy = 0.18; this.vx = dirIn * 0.05 * this.speed; this.airMove = null; this.hitDone = false;
          if (game.onDJ) game.onDJ(this);
        }
        this.vx += dirIn * 0.0035; if (this.vx > 0.07) this.vx = 0.07; if (this.vx < -0.07) this.vx = -0.07; // air steering
        if (inp.d && this.vy < 0) this.vy -= 0.008; // fast fall
        if (!this.airMove && (ep.lp || ep.hp || ep.lk || ep.hk)) { this.airMove = (ep.lp || ep.hp) ? 'jp' : 'jk'; this.hitDone = false; this.buf = null; this.bufT = 0; }
        if (this.airMove && !this.hitDone && game.tryHit(this, opp, MOVES[this.airMove])) this.hitDone = true;
        break;
      }
      case 'blockstun': case 'hit': if (this.t >= this.stun) this.state = this.state === 'hit' ? 'idle' : (inp.bl ? 'block' : 'idle'); break;
      case 'down': if (this.grounded && this.t > this.lieT && this.hp > 0) { this.state = 'getup'; this.t = 0; this.inv = 24; } break;
      case 'getup': if (this.t >= 20) this.state = 'idle'; break;
      default: break;
    }
    if (this.state === 'idle' || this.state === 'walk') { this.comboHits = 0; this.chain = 0; }
  }

  onLand() {
    this.djUsed = false;
    if (this.state === 'air') { this.state = 'idle'; this.airMove = null; this.vx = 0; this.wv = 0; }
    else if (this.state === 'down') { this.vx = 0; this.lieT = this.t + 34; }
  }

  /** Called by the game when an enemy attack connects. Returns the outcome string. */
  receive(att, m, game) {
    const blocking = (this.state === 'block' || this.state === 'blockstun') && !m.unblockable && (!m.low || this.crouchBlock);
    const kbDir = att.face;
    if (blocking) {
      this.hp -= m.dmg * 0.08 * att.power;
      this.meter = Math.min(100, this.meter + m.dmg * 0.3); att.meter = Math.min(100, att.meter + m.dmg * 0.2);
      this.state = 'blockstun'; this.t = 0; this.stun = m.bs; this.vx = kbDir * (m.kb + 0.05);
      return 'block';
    }
    let scale = 1; for (let i = 0; i < this.comboHits; i++) scale *= 0.88; // no Math.pow: must be bit-identical across browsers (online lockstep)
    const dmg = m.dmg * att.power * scale;
    this.meter = Math.min(100, this.meter + dmg * 0.8); att.meter = Math.min(100, att.meter + dmg * 1.2);
    if (this.state === 'attack' && this.move.projectile === 'ult' && this.t <= this.move.s && this.hp - dmg * 0.5 > 0) { // super armor while charging an Ultimate
      this.hp -= dmg * 0.5; this.comboHits++; return 'hit';
    }
    this.hp = Math.max(0, this.hp - dmg); this.comboHits++; att.comboDmg = (att.comboHits = this.comboHits, dmg);
    this.t = 0; this.wv = 0; this.buf = null; this.bufT = 0;
    if (m.launch || m.knock || this.hp <= 0 || !this.grounded) {
      this.state = 'down'; this.vy = m.launch ? 0.3 : 0.17; this.vx = kbDir * (m.launch ? 0.04 : 0.1); this.lieT = 9999;
      if (this.y <= 0) this.y = 0.001;
    } else { this.state = 'hit'; this.stun = m.hs; this.vx = kbDir * m.kb; }
    return 'hit';
  }

  poseName() {
    switch (this.state) {
      case 'attack': return this.move.pose;
      case 'air': return this.airMove || (this.djUsed ? 'djump' : 'jump');
      case 'block': case 'blockstun': return this.crouchBlock ? 'crouchblock' : 'block';
      case 'down': return this.grounded && this.y === 0 ? 'down' : 'fly';
      default: return this.state;
    }
  }
}
