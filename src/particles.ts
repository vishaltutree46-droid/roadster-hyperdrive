// Particle systems: skid marks, tire smoke / dust, rain.

import * as THREE from 'three';

/** Ring-buffer ribbon skid marks with per-vertex alpha fade. */
export class SkidMarks {
  private mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.Float32BufferAttribute;
  private colAttr: THREE.Float32BufferAttribute;
  private birth: Float32Array;
  private head = 0;
  private count = 0;
  private lastL = new THREE.Vector3(1e9, 0, 0);
  private lastR = new THREE.Vector3(1e9, 0, 0);
  private readonly CAP = 2600;
  private readonly LIFE = 22;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(this.CAP * 4 * 3), 3);
    this.colAttr = new THREE.Float32BufferAttribute(new Float32Array(this.CAP * 4 * 4), 4);
    this.birth = new Float32Array(this.CAP);
    const idx: number[] = [];
    for (let i = 0; i < this.CAP; i++) {
      const o = i * 4;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.geo.setDrawRange(0, 0);
  }

  private pushQuad(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const i = this.head;
    const p = this.posAttr.array as Float32Array;
    const c = this.colAttr.array as Float32Array;
    const o = i * 12;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az;
    p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = ax; p[o + 7] = ay; p[o + 8] = az;
    p[o + 9] = bx; p[o + 10] = by; p[o + 11] = bz;
    // degenerate second triangle corners collapse; real quad built below:
    // use (a,b) as one edge; width comes from caller passing two points per wheel.
    const co = i * 16;
    for (let k = 0; k < 4; k++) {
      c[co + k * 4] = 0.02; c[co + k * 4 + 1] = 0.02; c[co + k * 4 + 2] = 0.02; c[co + k * 4 + 3] = 0.75;
    }
    this.birth[i] = performance.now() / 1000;
    this.head = (this.head + 1) % this.CAP;
    this.count = Math.min(this.count + 1, this.CAP);
  }

  /** Add a mark segment for one wheel. prev/cur are wheel ground positions. */
  addWheel(prev: THREE.Vector3, cur: THREE.Vector3, halfWidth: number, dirX: number, dirZ: number): void {
    if (prev.distanceToSquared(cur) < 0.0004) return;
    if (prev.distanceToSquared(cur) > 4) return; // teleport guard
    const px = -dirZ * halfWidth, pz = dirX * halfWidth;
    const y = cur.y + 0.02;
    // quad corners: prev±perp, cur±perp
    const i = this.head;
    const p = this.posAttr.array as Float32Array;
    const c = this.colAttr.array as Float32Array;
    const o = i * 12;
    p[o] = prev.x + px; p[o + 1] = prev.y + 0.02; p[o + 2] = prev.z + pz;
    p[o + 3] = prev.x - px; p[o + 4] = prev.y + 0.02; p[o + 5] = prev.z - pz;
    p[o + 6] = cur.x + px; p[o + 7] = y; p[o + 8] = cur.z + pz;
    p[o + 9] = cur.x - px; p[o + 10] = y; p[o + 11] = cur.z - pz;
    const co = i * 16;
    for (let k = 0; k < 4; k++) {
      c[co + k * 4] = 0.03; c[co + k * 4 + 1] = 0.03; c[co + k * 4 + 2] = 0.03; c[co + k * 4 + 3] = 0.7;
    }
    this.birth[i] = performance.now() / 1000;
    this.head = (this.head + 1) % this.CAP;
    this.count = Math.min(this.count + 1, this.CAP);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
    this.geo.setDrawRange(0, 0);
    this.lastL.set(1e9, 0, 0);
    this.lastR.set(1e9, 0, 0);
  }

  get lastLeft(): THREE.Vector3 { return this.lastL; }
  get lastRight(): THREE.Vector3 { return this.lastR; }

  update(): void {
    if (this.count === 0) return;
    const now = performance.now() / 1000;
    const c = this.colAttr.array as Float32Array;
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const age = now - this.birth[i];
      const a = age >= this.LIFE ? 0 : 0.7 * (1 - age / this.LIFE);
      const co = i * 16;
      if (Math.abs(c[co + 3] - a) > 0.01) {
        for (let k = 0; k < 4; k++) c[co + k * 4 + 3] = a;
        dirty = true;
      }
    }
    if (dirty) this.colAttr.needsUpdate = true;
  }
}

/** Simple CPU sprite pool for smoke/dust/sparks. */
export class SpritePool {
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.Float32BufferAttribute;
  private alphaAttr: THREE.Float32BufferAttribute;
  private sizeAttr: THREE.Float32BufferAttribute;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private head = 0;
  private gravity: number;
  private tex: THREE.Texture;

  constructor(scene: THREE.Scene, cap: number, color: number, gravity = 1.2, size = 30) {
    this.gravity = gravity;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(cap * 3), 3);
    this.alphaAttr = new THREE.Float32BufferAttribute(new Float32Array(cap), 1);
    this.sizeAttr = new THREE.Float32BufferAttribute(new Float32Array(cap), 1);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    for (let i = 0; i < cap; i++) { this.life[i] = -1; this.sizeAttr.array[i] = size; }
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aAlpha', this.alphaAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.tex = makeSoftTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.tex },
        color: { value: new THREE.Color(color) },
      },
      vertexShader: `
        attribute float aAlpha; attribute float aSize;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (140.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 color; varying float vA;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(color, t.a * vA);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    const i = this.head;
    this.head = (this.head + 1) % (this.life.length);
    const p = this.posAttr.array as Float32Array;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    (this.sizeAttr.array as Float32Array)[i] = size;
  }

  update(dt: number): void {
    const p = this.posAttr.array as Float32Array;
    const a = this.alphaAttr.array as Float32Array;
    let dirty = false;
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i] < 0) { if (a[i] !== 0) { a[i] = 0; dirty = true; } continue; }
      this.life[i] -= dt;
      if (this.life[i] < 0) { a[i] = 0; dirty = true; continue; }
      p[i * 3] += this.vel[i * 3] * dt;
      p[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      p[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] += this.gravity * dt;
      this.vel[i * 3] *= (1 - 1.6 * dt);
      this.vel[i * 3 + 2] *= (1 - 1.6 * dt);
      a[i] = 0.55 * (this.life[i] / this.maxLife[i]);
      dirty = true;
    }
    if (dirty) {
      this.posAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
  }
}

function makeSoftTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** Rain streaks around the camera. */
export class RainSystem {
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.Float32BufferAttribute;
  private vel: Float32Array;
  private readonly CAP = 1400;
  private area = 60;
  active = false;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(this.CAP * 3), 3);
    this.vel = new Float32Array(this.CAP);
    for (let i = 0; i < this.CAP; i++) {
      this.posAttr.array[i * 3] = (Math.random() - 0.5) * this.area;
      this.posAttr.array[i * 3 + 1] = Math.random() * 30;
      this.posAttr.array[i * 3 + 2] = (Math.random() - 0.5) * this.area;
      this.vel[i] = 28 + Math.random() * 14;
    }
    this.geo.setAttribute('position', this.posAttr);
    const mat = new THREE.PointsMaterial({
      color: 0x9fb6cc, size: 0.14, transparent: true, opacity: 0.55, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  setActive(v: boolean): void {
    this.active = v;
    this.points.visible = v;
  }

  update(dt: number, cx: number, cz: number): void {
    if (!this.active) return;
    const p = this.posAttr.array as Float32Array;
    for (let i = 0; i < this.CAP; i++) {
      p[i * 3 + 1] -= this.vel[i] * dt;
      if (p[i * 3 + 1] < 0) {
        p[i * 3] = cx + (Math.random() - 0.5) * this.area;
        p[i * 3 + 1] = 24 + Math.random() * 8;
        p[i * 3 + 2] = cz + (Math.random() - 0.5) * this.area;
      }
    }
    this.posAttr.needsUpdate = true;
  }
}
