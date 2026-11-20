import { EMPTY } from './input.js';

/** CPU opponent. Produces the same input object a human would. level: 0 easy, 1 normal, 2 hard. */
export function makeAI(self, oppRef, level = 1, R = Math.random) {
  const getOpp = typeof oppRef === 'function' ? oppRef : () => oppRef; // Smash: a function returning the nearest enemy
  const blockP = [0.15, 0.4, 0.7][level], aggr = [0.5, 0.75, 0.95][level], gap = [30, 16, 6][level];
  let plan = null;
  const rnd = (a, b) => a + R() * (b - a);

  const think = (opp) => {
    const dx = Math.abs(opp.x - self.x), r = R();
    if (self.stageHalf) { // Smash: chase up onto platforms, drop down to the target
      if (opp.y > self.y + 1.5 && dx < 3.5 && self.grounded && R() < 0.55) return { n: 30, press: { u: 1 }, f: 1 };
      if (opp.y < self.y - 1.2 && self.grounded && self.y > 0.5 && R() < 0.45) return { n: 12, press: { d: 1 } };
    }
    if (self.propAhead && dx > 1.4) return R() < 0.6 ? { n: 22, press: { hp: 1 } } : { n: 40, press: { u: 1 }, f: 1 }; // crate in the way: smash it or hop over
    if (self.held && dx > 1.6 && R() < 0.7) return { n: 24, press: { th: 1 } };            // throw what it's holding
    if (!self.held && self.nearItem && dx > 1.8 && R() < 0.5) return { n: 24, press: { th: 1 } }; // grab an item at its feet
    if (self.meter >= 100 && dx > 1.2 && R() < 0.4) return { n: 50, press: { ult: 1 } };
    const oppAttacking = opp.state === 'attack' || (opp.state === 'air' && opp.airMove);
    if (oppAttacking && dx < 2 && r < blockP) return { n: rnd(14, 26), hold: { bl: 1 }, crouch: R() < 0.3 };
    if (opp.y > 0.5 && dx < 2.2 && R() < aggr) return { n: 22, press: { d: 1, hp: 1 } };
    if (dx > 4 && r < 0.3) return { n: 24, press: { sp: 1 } };
    if (dx > 1.7) return { n: rnd(10, 28), f: 1, hold: { run: r < 0.3 ? 1 : 0 } };
    if (R() > aggr) return { n: rnd(10, 24), f: -1, hold: { bl: R() < 0.5 ? 1 : 0 } };
    const p = R();
    const atk = (press, n) => ({ n: n + gap * R(), press });
    if (p < 0.24) return atk({ lp: 1 }, 10);
    if (p < 0.44) return atk({ hp: 1 }, 20);
    if (p < 0.58) return atk({ lk: 1 }, 14);
    if (p < 0.70) return atk({ hk: 1 }, 26);
    if (p < 0.80) return atk({ d: 1, lk: 1 }, 30);
    if (p < 0.88) return atk({ d: 1, hp: 1 }, 30);
    if (p < 0.94) return { n: 40, press: { u: 1 }, f: R() < 0.5 ? 1 : -1 };
    return { n: rnd(12, 24), f: -1, hold: { bl: 1 } };
  };

  return () => {
    const opp = getOpp();
    if (self.stageHalf && self.offstage) { // Smash: get back to the stage (double jump, then up + special)
      plan = null; const o = EMPTY(); o[self.x < 0 ? 'r' : 'l'] = 1;
      if (self.state === 'air' && self.vy < 0.03) { if (!self.djUsed) o.u = self.u & 1; else if (!self.recUsed) { o.u = 1; o.sp = self.u & 1; } }
      return o;
    }
    const o = EMPTY();
    if (!plan || plan.n <= 0) plan = { ...think(opp), age: 0 };
    plan.n--; plan.age++;
    const fwd = self.face > 0 ? 'r' : 'l', back = self.face > 0 ? 'l' : 'r';
    if (plan.f === 1) o[fwd] = 1; if (plan.f === -1) o[back] = 1;
    if (plan.hold) Object.assign(o, plan.hold);
    if (plan.crouch) o.d = 1;
    if (plan.press && plan.age <= 3) Object.assign(o, plan.press); // short pulse = a button tap
    if (self.stageHalf && self.grounded && self.y < 0.05) { // never walk off the main stage
      if (o.r && self.x > self.stageHalf - 1.1) { o.r = 0; o.run = 0; }
      if (o.l && self.x < -self.stageHalf + 1.1) { o.l = 0; o.run = 0; }
    }
    return o;
  };
}
