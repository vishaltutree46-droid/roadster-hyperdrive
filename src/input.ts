// Unified input: keyboard + gamepad + touch controls.

export interface DriveInput {
  throttle: number;   // 0..1
  brake: number;      // 0..1
  steer: number;      // -1..1
  handbrake: boolean;
  boost: boolean;
}

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export class InputManager {
  keys = new Set<string>();
  steerSmooth = 0;
  onKey: ((code: string) => void) | null = null;
  touch = { left: false, right: false, gas: false, brake: false };
  private touchEl: HTMLElement | null = null;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.enabled && this.onKey) this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Poll gamepad (called each frame). Returns null when none. */
  private pollGamepad(): { steer: number; throttle: number; brake: number; handbrake: boolean; boost: boolean } | null {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p || !p.connected) continue;
        const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
        const steer = dz(p.axes[0] || 0);
        const throttle = Math.max(dz(p.axes[5] !== undefined ? (p.axes[5] + 1) / 2 : 0), p.buttons[7]?.value || 0);
        const brake = Math.max(dz(p.axes[4] !== undefined ? (p.axes[4] + 1) / 2 : 0), p.buttons[6]?.value || 0);
        const handbrake = !!(p.buttons[0]?.pressed || p.buttons[5]?.pressed);
        const boost = !!p.buttons[3]?.pressed;
        return { steer, throttle, brake, handbrake, boost };
      }
    } catch { /* no gamepad */ }
    return null;
  }

  sample(dt: number): DriveInput {
    const k = this.keys;
    let steer = 0;
    if (k.has('KeyA') || k.has('ArrowLeft') || this.touch.left) steer -= 1;
    if (k.has('KeyD') || k.has('ArrowRight') || this.touch.right) steer += 1;
    let throttle = 0;
    if (k.has('KeyW') || k.has('ArrowUp') || this.touch.gas) throttle = 1;
    let brake = 0;
    if (k.has('KeyS') || k.has('ArrowDown') || this.touch.brake) brake = 1;
    let handbrake = k.has('Space');
    let boost = false;

    const gp = this.pollGamepad();
    if (gp) {
      if (Math.abs(gp.steer) > 0.01) steer = gp.steer;
      throttle = Math.max(throttle, gp.throttle);
      brake = Math.max(brake, gp.brake);
      handbrake = handbrake || gp.handbrake;
      boost = gp.boost;
    }

    // smooth steering for analog feel
    const rate = steer !== 0 ? 5.5 : 8;
    this.steerSmooth += (steer - this.steerSmooth) * Math.min(1, rate * dt);
    if (Math.abs(this.steerSmooth) < 0.002 && steer === 0) this.steerSmooth = 0;

    return { throttle, brake, steer: this.steerSmooth, handbrake, boost };
  }

  /** Build on-screen touch controls (shown on touch devices). */
  buildTouchControls(): void {
    if (this.touchEl) return;
    const el = document.createElement('div');
    el.id = 'touch-controls';
    el.innerHTML = `
      <div class="tc-left">
        <button data-k="left" aria-label="Steer left">◀</button>
        <button data-k="right" aria-label="Steer right">▶</button>
      </div>
      <div class="tc-right">
        <button data-k="brake" aria-label="Brake">▼</button>
        <button data-k="gas" aria-label="Accelerate">▲</button>
      </div>`;
    document.body.appendChild(el);
    this.touchEl = el;
    el.querySelectorAll('button').forEach((b) => {
      const key = (b as HTMLElement).dataset.k as keyof typeof this.touch;
      const on = (e: Event) => { e.preventDefault(); this.touch[key] = true; };
      const off = (e: Event) => { e.preventDefault(); this.touch[key] = false; };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    });
    if (!('ontouchstart' in window)) el.style.display = 'none';
  }

  showTouch(v: boolean): void {
    if (this.touchEl && 'ontouchstart' in window) {
      this.touchEl.style.display = v ? 'block' : 'none';
    }
  }
}
