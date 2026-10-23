// Arcade vehicle physics for a high-performance EV.
// Fixed-step friendly. All figures are simulated/game-tuned (not manufacturer specs).

import * as THREE from 'three';
import type { DriveInput } from './input';

export interface SurfaceInfo {
  grip: number;      // 0..1.2 multiplier
  drag: number;      // extra rolling drag
  onRoad: boolean;
  groundY: number;
}

export interface CollisionEvent {
  hard: boolean;
  speedKmh: number;
}

const TOP_SPEED = 98;      // m/s ≈ 353 km/h (simulated, clearly arcade)
const EV_ACCEL = 16.5;     // m/s² launch (simulated)
const BRAKE_DECEL = 26;
const REVERSE_ACCEL = 9;
const REVERSE_MAX = 13;    // m/s
const WHEELBASE = 2.65;

export class VehiclePhysics {
  pos = new THREE.Vector3();
  yaw = 0;
  vel = new THREE.Vector3();
  steerVis = 0;          // smoothed visual steering
  vForward = 0;
  vLateral = 0;
  slip = 0;              // 0..1 lateral slip amount (for smoke/skid/audio)
  drifting = false;
  boostActive = false;
  collision: CollisionEvent | null = null;
  private collisionCooldown = 0;

  reset(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.vForward = 0;
    this.vLateral = 0;
    this.steerVis = 0;
    this.slip = 0;
    this.drifting = false;
    this.boostActive = false;
  }

  get speedKmh(): number {
    return this.vel.length() * 3.6;
  }

  get forwardSpeed(): number {
    return this.vForward;
  }

  step(dt: number, input: DriveInput, surf: SurfaceInfo): void {
    this.collision = null;
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    // right = fwd × up
    const rX = -fwdZ, rZ = fwdX;

    let vF = this.vel.x * fwdX + this.vel.z * fwdZ;
    let vL = this.vel.x * rX + this.vel.z * rZ;

    const grip = surf.grip;
    const handbrake = input.handbrake;
    this.boostActive = input.boost && input.throttle > 0.1 && vF > 1;

    // --- longitudinal ---
    if (input.throttle > 0 && !handbrake) {
      const boostMul = this.boostActive ? 1.55 : 1;
      const curve = Math.max(0, 1 - Math.max(0, vF) / TOP_SPEED);
      vF += EV_ACCEL * boostMul * input.throttle * (0.35 + 0.65 * curve) * dt;
    }
    if (input.brake > 0) {
      if (vF > 0.6) {
        vF -= BRAKE_DECEL * input.brake * dt * (handbrake ? 0.4 : 1);
      } else {
        vF -= REVERSE_ACCEL * input.brake * dt; // reverse
        if (vF < -REVERSE_MAX) vF = -REVERSE_MAX;
      }
    }
    if (handbrake) {
      vF -= vF * Math.min(1, 3.2 * dt); // rear lock drag
    }
    // drag + rolling resistance
    const dragK = 0.00042 * surf.drag;
    vF -= (dragK * vF * Math.abs(vF) + 0.35 * Math.sign(vF) * Math.min(1, Math.abs(vF))) * dt;
    if (Math.abs(vF) < 0.08 && input.throttle === 0 && input.brake === 0) vF = 0;

    // --- steering ---
    const spd = Math.abs(vF);
    const speedFactor = 1 / (1 + Math.pow(spd / 28, 1.6)); // less angle at speed
    const maxSteer = 0.62 * (0.35 + 0.65 * speedFactor);
    const targetSteer = input.steer * maxSteer;
    this.steerVis += (targetSteer - this.steerVis) * Math.min(1, 10 * dt);
    if (spd > 0.4) {
      const dir = vF >= 0 ? 1 : -1;
      const yawRate = (spd / WHEELBASE) * Math.tan(this.steerVis) * (0.55 + 0.45 * grip);
      this.yaw += yawRate * dir * dt;
    }

    // --- lateral grip / drift ---
    const latGripBase = 9.0 * grip;
    const sliding = handbrake || (Math.abs(this.steerVis) > 0.30 && spd > 22);
    const latGrip = sliding ? 1.6 * grip : latGripBase;
    vL *= Math.exp(-latGrip * dt);

    // recompute slip after grip
    const newFwdX = Math.sin(this.yaw), newFwdZ = Math.cos(this.yaw);
    const newRX = -newFwdZ, newRZ = newFwdX;
    // rebuild velocity in the (possibly rotated) frame
    this.vel.set(newFwdX * vF + newRX * vL, 0, newFwdZ * vF + newRZ * vL);

    this.slip = THREE.MathUtils.clamp(Math.abs(vL) / Math.max(6, spd), 0, 1);
    this.drifting = this.slip > 0.28 && spd > 10;

    // --- integrate ---
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // smooth ground height
    const targetY = surf.groundY;
    this.pos.y += (targetY - this.pos.y) * Math.min(1, 12 * dt);

    this.vForward = vF;
    this.vLateral = vL;
  }

  /** Resolve a circular collider. Returns true if a hit occurred. */
  collideCircle(cx: number, cz: number, r: number): boolean {
    const dx = this.pos.x - cx;
    const dz = this.pos.z - cz;
    const d2 = dx * dx + dz * dz;
    const rr = r + 0.9; // car approximated as circle r=0.9 for walls
    if (d2 >= rr * rr || d2 < 1e-8) return false;
    const d = Math.sqrt(d2);
    const nx = dx / d, nz = dz / d;
    this.pos.x = cx + nx * rr;
    this.pos.z = cz + nz * rr;
    const vN = this.vel.x * nx + this.vel.z * nz;
    if (vN < 0) {
      this.vel.x -= nx * vN * 1.55;
      this.vel.z -= nz * vN * 1.55;
      const impact = Math.abs(vN);
      if (impact > 3 && this.collisionCooldown <= 0) {
        this.collisionCooldown = 0.4;
        const hard = impact > 9;
        this.collision = { hard, speedKmh: this.speedKmh };
        // scrub speed on wall hit
        this.vel.multiplyScalar(hard ? 0.55 : 0.8);
      }
    }
    return true;
  }

  /** Battery-style energy 0..100 (simulated). Drains with throttle, regens on brake. */
  energy = 100;
  updateEnergy(dt: number, input: DriveInput): void {
    if (input.throttle > 0.05 && Math.abs(this.vForward) > 0.5) {
      this.energy = Math.max(5, this.energy - dt * (0.25 + input.throttle * 0.9 + (this.boostActive ? 2.2 : 0)));
    } else if (input.brake > 0.05 && this.vForward > 3) {
      this.energy = Math.min(100, this.energy + dt * 0.8); // regen
    }
  }
}
