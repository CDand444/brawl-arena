// Input: keyboard (P1 + P2 maps), touch (virtual pad + buttons). Every source yields the same shape.
export const EMPTY = () => ({ l: 0, r: 0, u: 0, d: 0, lp: 0, hp: 0, lk: 0, hk: 0, bl: 0, run: 0, sp: 0, ult: 0, th: 0 });

export const KEYMAPS = {
  p1: { KeyA: 'l', KeyD: 'r', KeyW: 'u', KeyS: 'd', KeyF: 'lp', KeyG: 'hp', KeyC: 'lk', KeyV: 'hk', ShiftLeft: 'bl', KeyX: 'run', KeyE: 'sp', KeyR: 'ult', KeyQ: 'th' },
  p2: { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', KeyU: 'lp', KeyI: 'hp', KeyJ: 'lk', KeyK: 'hk', KeyL: 'bl', KeyO: 'run',
        Numpad4: 'lp', Numpad5: 'hp', Numpad1: 'lk', Numpad2: 'hk', Numpad0: 'bl', Numpad3: 'run', KeyP: 'sp', Semicolon: 'ult', Numpad6: 'sp', Numpad9: 'ult', Slash: 'th', Numpad7: 'th' },
};

const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.code); if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
export const keyPressed = (code) => keys.has(code);

export const keyboardInput = (...maps) => () => {
  const o = EMPTY();
  for (const m of maps) for (const k in m) if (keys.has(k)) o[m[k]] = 1;
  return o;
};

const touchState = EMPTY();
export const touchInput = () => () => ({ ...touchState });
export const combine = (...fns) => () => { const o = EMPTY(); for (const f of fns) { const r = f(); for (const k in o) o[k] |= r[k]; } return o; };

/** Wire up #touch: elements with data-btn are buttons; #dpad is an analog-style direction zone. */
export function setupTouch() {
  document.querySelectorAll('#touch [data-btn]').forEach((el) => {
    const b = el.dataset.btn;
    const on = (e) => { e.preventDefault(); touchState[b] = 1; el.classList.add('down'); };
    const off = (e) => { e.preventDefault(); touchState[b] = 0; el.classList.remove('down'); };
    el.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => el.addEventListener(ev, off));
  });
  const pad = document.getElementById('dpad'), knob = document.getElementById('knob');
  const set = (e) => {
    const r = pad.getBoundingClientRect(), R = r.width / 2;
    const dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R), dead = R * 0.28;
    touchState.l = dx < -dead ? 1 : 0; touchState.r = dx > dead ? 1 : 0;
    touchState.u = dy < -dead * 1.4 ? 1 : 0; touchState.d = dy > dead * 1.4 ? 1 : 0;
    const m = Math.min(1, Math.hypot(dx, dy) / R), a = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(a) * m * R * 0.6}px,${Math.sin(a) * m * R * 0.6}px)`;
  };
  const clear = () => { touchState.l = touchState.r = touchState.u = touchState.d = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerdown', (e) => { e.preventDefault(); pad.setPointerCapture(e.pointerId); set(e); });
  pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') set(e); });
  ['pointerup', 'pointercancel'].forEach((ev) => pad.addEventListener(ev, clear));
}

/** Standard-layout gamepad. X/Y = punches, A/B = kicks, RB = block, LT = run, LB = grab/throw, RT = special, stick click = ultimate. */
export const gamepadInput = (idx) => () => {
  const o = EMPTY(), p = navigator.getGamepads ? navigator.getGamepads()[idx] : null; if (!p) return o;
  const b = (i) => (p.buttons[i] && p.buttons[i].pressed ? 1 : 0), ax = p.axes || [];
  o.l = b(14) || ax[0] < -0.4 ? 1 : 0; o.r = b(15) || ax[0] > 0.4 ? 1 : 0; o.u = b(12) || ax[1] < -0.6 ? 1 : 0; o.d = b(13) || ax[1] > 0.5 ? 1 : 0;
  o.lp = b(2); o.hp = b(3); o.lk = b(0); o.hk = b(1); o.bl = b(5); o.run = b(6); o.th = b(4); o.sp = b(7); o.ult = b(10) || b(11);
  return o;
};
export const padStart = () => { const ps = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of ps) if (p && p.buttons[9] && p.buttons[9].pressed) return true; return false; };
