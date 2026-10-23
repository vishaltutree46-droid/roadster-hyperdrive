// Game modes: free roam, time trial, speed challenge, drift challenge,
// checkpoint race. Photo mode is handled by the game orchestrator.

import type { GameModeId } from './config';
import { formatTime, getBest, setBest } from './config';
import type { WorldRefs, CheckpointGate } from './world';
import type { VehiclePhysics } from './physics';

export interface ModeContext {
  world: WorldRefs;
  physics: VehiclePhysics;
  onBanner: (title: string, sub: string | null, ms?: number) => void;
  onToast: (msg: string) => void;
  onFinish: (title: string, lines: string[], mode: GameModeId) => void;
  onCheckpointSound: () => void;
  resetCarToStart: () => void;
  teleportTo: (x: number, z: number, yaw: number) => void;
}

interface ActiveMode {
  id: GameModeId;
  t: number;
  lapStart: number | null;
  gateIdx: number;
  score: number;
  combo: number;
  comboT: number;
  speedDone: boolean;
  passed: boolean[];
}

const DRIFT_TIME = 120;

export class ModeManager {
  active: ActiveMode | null = null;
  timerText: string | null = null;
  scoreText: string | null = null;
  private ctx: ModeContext | null = null;

  constructor(private getCtx: () => ModeContext) {}

  private get c(): ModeContext {
    if (!this.ctx) this.ctx = this.getCtx();
    return this.ctx;
  }

  start(id: GameModeId): void {
    const c = this.c;
    this.clearGates();
    this.active = {
      id, t: 0, lapStart: null, gateIdx: 0,
      score: 0, combo: 1, comboT: 0, speedDone: false,
      passed: c.world.checkpoints.map(() => false),
    };
    this.timerText = null;
    this.scoreText = null;
    if (id === 'freeroam') {
      c.onBanner('Free Roam', 'Explore the coast, mountains and city', 2200);
    } else if (id === 'timetrial') {
      const g0 = c.world.checkpoints[0];
      const fx = Math.sin(g0.yaw), fz = Math.cos(g0.yaw);
      c.teleportTo(g0.pos.x - fx * 26, g0.pos.z - fz * 26, g0.yaw);
      c.onBanner('Time Trial', 'Complete one full lap — best: ' + (getBest('lap') ? formatTime(getBest('lap')) : '—'), 3000);
    } else if (id === 'speed') {
      const z = c.world.speedZone;
      c.teleportTo((z.x0 + z.x1) / 2 - 250, z.z, Math.PI / 2);
      c.onBanner('Speed Challenge', 'Reach 260 km/h on the coastal straight', 3000);
    } else if (id === 'drift') {
      const p = c.world.testPad;
      c.teleportTo(p.x, p.z, 0);
      c.onBanner('Drift Challenge', `${DRIFT_TIME}s — chain drifts, avoid walls!`, 3000);
      this.scoreText = '0 pts';
    } else if (id === 'race') {
      const g0 = c.world.checkpoints[0];
      const fx = Math.sin(g0.yaw), fz = Math.cos(g0.yaw);
      c.teleportTo(g0.pos.x - fx * 26, g0.pos.z - fz * 26, g0.yaw);
      this.setNextGate(0);
      c.onBanner('Checkpoint Race', 'Hit all 8 gates in order', 3000);
    }
  }

  stop(): void {
    this.clearGates();
    this.active = null;
    this.timerText = null;
    this.scoreText = null;
  }

  get id(): GameModeId | null {
    return this.active?.id ?? null;
  }

  private clearGates(): void {
    const c = this.ctx;
    if (!c) return;
    c.world.checkpoints.forEach(g => { g.setNext(false); g.setPassed(false); });
  }

  private setNextGate(i: number): void {
    const c = this.c;
    c.world.checkpoints.forEach((g, k) => g.setNext(k === i));
  }

  /** called on physics collision */
  onCollision(): void {
    const a = this.active;
    if (!a) return;
    if (a.id === 'drift' && a.combo > 1) {
      a.combo = 1;
      this.c.onToast('Combo lost!');
    }
  }

  private gateReached(g: CheckpointGate, gi: number): boolean {
    const p = this.c.physics.pos;
    const dx = p.x - g.pos.x, dz = p.z - g.pos.z;
    return dx * dx + dz * dz < 9.5 * 9.5;
  }

  update(dt: number): void {
    const a = this.active;
    if (!a) return;
    const c = this.c;
    const phys = c.physics;
    a.t += dt;

    if (a.id === 'timetrial') {
      const g0 = c.world.checkpoints[0];
      if (a.lapStart === null) {
        if (a.t > 1 && this.gateReached(g0, 0) && phys.speedKmh > 30) {
          a.lapStart = a.t;
          c.onCheckpointSound();
          c.onToast('Lap started!');
        }
        this.timerText = 'GET READY';
      } else {
        const lt = a.t - a.lapStart;
        this.timerText = formatTime(lt);
        if (lt > 5 && this.gateReached(g0, 0)) {
          const prev = getBest('lap');
          setBest('lap', lt);
          c.onCheckpointSound();
          c.onFinish('Lap Complete', [
            `Lap time: ${formatTime(lt)}`,
            prev ? `Previous best: ${formatTime(prev)}` : 'First recorded lap!',
          ], 'timetrial');
          this.stop();
        }
      }
    } else if (a.id === 'speed') {
      const z = c.world.speedZone;
      const inZone = phys.pos.x > z.x0 && phys.pos.x < z.x1 && Math.abs(phys.pos.z - z.z) < 30;
      const kmh = phys.speedKmh;
      this.timerText = inZone ? `${Math.round(kmh)} / 260 km/h` : 'RETURN TO STRAIGHT';
      if (!a.speedDone && kmh >= 260) {
        a.speedDone = true;
        c.onCheckpointSound();
        c.onFinish('Speed Challenge Complete', [
          `You hit ${Math.round(kmh)} km/h!`,
          `Time: ${formatTime(a.t)}`,
        ], 'speed');
        this.stop();
      }
    } else if (a.id === 'drift') {
      const remain = DRIFT_TIME - a.t;
      if (phys.drifting) {
        const gain = phys.slip * phys.speedKmh * dt * 2 * a.combo;
        a.score += gain;
        a.comboT += dt;
        if (a.comboT > 4) { a.combo = Math.min(8, a.combo + 1); a.comboT = 0; c.onToast(`Combo x${a.combo}`); }
      } else {
        a.comboT = Math.max(0, a.comboT - dt * 2);
        if (a.comboT === 0 && a.combo > 1) a.combo = 1;
      }
      this.scoreText = `${Math.round(a.score)} pts  x${a.combo}`;
      this.timerText = formatTime(Math.max(0, remain));
      if (remain <= 0) {
        const prev = getBest('drift');
        if (a.score > prev) {
          try { localStorage.setItem('roadster-hyperdrive-best-drift', String(Math.round(a.score))); } catch { /* ignore */ }
        }
        c.onCheckpointSound();
        c.onFinish('Drift Challenge Complete', [
          `Score: ${Math.round(a.score)} pts`,
          prev ? `Previous best: ${Math.round(prev)} pts` : 'First recorded run!',
        ], 'drift');
        this.stop();
      }
    } else if (a.id === 'race') {
      const gates = c.world.checkpoints;
      const g = gates[a.gateIdx];
      this.timerText = formatTime(a.t);
      this.scoreText = `Gate ${a.gateIdx + 1} / ${gates.length}`;
      if (this.gateReached(g, a.gateIdx)) {
        g.setPassed(true);
        c.onCheckpointSound();
        a.gateIdx++;
        if (a.gateIdx >= gates.length) {
          const prev = getBest('race');
          setBest('race', a.t);
          c.onFinish('Race Complete!', [
            `Total time: ${formatTime(a.t)}`,
            prev ? `Previous best: ${formatTime(prev)}` : 'First recorded race!',
          ], 'race');
          this.stop();
        } else {
          this.setNextGate(a.gateIdx);
          c.onToast(`Gate ${a.gateIdx} / ${gates.length}`);
        }
      }
    }
  }

  /** teleport helper for photo mode etc. */
  get isRacing(): boolean {
    return !!this.active && (this.active.id === 'race' || this.active.id === 'timetrial');
  }
}

export function driftBest(): number {
  try {
    const v = localStorage.getItem('roadster-hyperdrive-best-drift');
    return v ? parseFloat(v) : 0;
  } catch { return 0; }
}
