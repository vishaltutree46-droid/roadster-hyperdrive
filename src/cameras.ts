// Cinematic multi-mode camera rig with damped transitions.

import * as THREE from 'three';

export const CAMERA_NAMES = ['Chase', 'Rear', 'Hood', 'Cockpit', 'Orbit', 'Low'];

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;
  private blend = 1; // 0..1 transition progress
  private orbitAngle = 0;
  private shake = 0;
  private userOrbit = { theta: 0.6, phi: 1.05, r: 8 }; // photo mode
  fovKick = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
  }

  setMode(m: number): void {
    m = ((m % CAMERA_NAMES.length) + CAMERA_NAMES.length) % CAMERA_NAMES.length;
    if (m !== this.mode) {
      this.mode = m;
      this.blend = 0;
    }
  }

  /** Snap camera behind the car instantly (used after teleports). */
  snap(carPos: THREE.Vector3, yaw: number): void {
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.pos.set(carPos.x - fwd.x * 8.2, carPos.y + 3.1, carPos.z - fwd.z * 8.2);
    this.look.set(carPos.x + fwd.x * 7, carPos.y + 1.1, carPos.z + fwd.z * 7);
    this.initialized = true;
    this.blend = 1;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  /** Photo-mode orbit control. */
  orbitControl(dTheta: number, dPhi: number, dR: number): void {
    this.userOrbit.theta += dTheta;
    this.userOrbit.phi = THREE.MathUtils.clamp(this.userOrbit.phi + dPhi, 0.35, 1.45);
    this.userOrbit.r = THREE.MathUtils.clamp(this.userOrbit.r + dR, 3.5, 22);
  }

  resetPhotoOrbit(): void {
    this.userOrbit = { theta: 0.6, phi: 1.05, r: 8 };
  }

  update(
    dt: number,
    carPos: THREE.Vector3,
    yaw: number,
    speedKmh: number,
    photoMode: boolean,
  ): void {
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const up = new THREE.Vector3(0, 1, 0);

    let dPos = new THREE.Vector3(), dLook = new THREE.Vector3();
    let dampPos = 6, dampLook = 8;

    if (photoMode) {
      const o = this.userOrbit;
      dPos.set(
        carPos.x + Math.sin(o.theta) * Math.sin(o.phi) * o.r,
        carPos.y + Math.cos(o.phi) * o.r + 0.4,
        carPos.z + Math.cos(o.theta) * Math.sin(o.phi) * o.r,
      );
      dLook.copy(carPos).add(new THREE.Vector3(0, 0.7, 0));
      dampPos = 10; dampLook = 10;
    } else if (this.mode === 0) {          // chase
      dPos.copy(carPos).addScaledVector(fwd, -8.2).addScaledVector(up, 3.1);
      dLook.copy(carPos).addScaledVector(fwd, 7).addScaledVector(up, 1.1);
      dampPos = 4.2; dampLook = 6;
    } else if (this.mode === 1) {          // close rear
      dPos.copy(carPos).addScaledVector(fwd, -4.6).addScaledVector(up, 1.7);
      dLook.copy(carPos).addScaledVector(fwd, 8).addScaledVector(up, 0.9);
      dampPos = 7; dampLook = 9;
    } else if (this.mode === 2) {          // hood
      dPos.copy(carPos).addScaledVector(fwd, 1.35).addScaledVector(up, 0.82);
      dLook.copy(carPos).addScaledVector(fwd, 30).addScaledVector(up, 0.4);
      dampPos = 22; dampLook = 22;
    } else if (this.mode === 3) {          // cockpit
      dPos.copy(carPos).addScaledVector(fwd, 0.42).addScaledVector(right, -0.38).addScaledVector(up, 1.06);
      dLook.copy(carPos).addScaledVector(fwd, 26).addScaledVector(right, -0.38).addScaledVector(up, 0.55);
      dampPos = 26; dampLook = 26;
    } else if (this.mode === 4) {          // cinematic orbit
      this.orbitAngle += dt * 0.35;
      const r = 7.5;
      dPos.set(
        carPos.x + Math.sin(this.orbitAngle) * r,
        carPos.y + 2.4 + Math.sin(this.orbitAngle * 0.7) * 0.8,
        carPos.z + Math.cos(this.orbitAngle) * r,
      );
      dLook.copy(carPos).addScaledVector(up, 0.7);
      dampPos = 3; dampLook = 5;
    } else {                                // low cinematic
      dPos.copy(carPos).addScaledVector(right, 6.4).addScaledVector(fwd, -2.6).addScaledVector(up, 1.0);
      dLook.copy(carPos).addScaledVector(fwd, 3).addScaledVector(up, 0.55);
      dampPos = 3.4; dampLook = 5;
    }

    // keep camera above ground
    if (dPos.y < carPos.y + 0.35) dPos.y = carPos.y + 0.35;

    if (!this.initialized) {
      this.pos.copy(dPos); this.look.copy(dLook);
      this.initialized = true;
    }
    this.blend = Math.min(1, this.blend + dt * 2.2);
    const kp = 1 - Math.exp(-dampPos * dt);
    const kl = 1 - Math.exp(-dampLook * dt);
    this.pos.lerp(dPos, kp);
    this.look.lerp(dLook, kl);

    // shake
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sh = this.shake * this.shake;
    const t = performance.now() / 1000;
    this.camera.position.set(
      this.pos.x + Math.sin(t * 61) * 0.14 * sh,
      this.pos.y + Math.sin(t * 53 + 1.3) * 0.12 * sh,
      this.pos.z + Math.sin(t * 47 + 2.1) * 0.14 * sh,
    );
    this.camera.lookAt(this.look);

    // speed FOV kick
    const targetKick = THREE.MathUtils.clamp(speedKmh / 300, 0, 1) * 13 + (this.mode === 4 ? -4 : 0);
    this.fovKick += (targetKick - this.fovKick) * Math.min(1, 3 * dt);
    const fov = 62 + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }
}
