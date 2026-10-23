// Procedural Tesla-Roadster-inspired supercar model.
// Built from lofted cross-sections + detailed parts. No external assets.
// NOTE: this is an original, Roadster-inspired procedural model —
// a stylized tribute, not a licensed replica.

import * as THREE from 'three';
import type { Finish } from './config';

interface Station {
  z: number;
  /** [y, signedHalfWidth] loop, ordered clockwise viewed from the front (+z) */
  pts: [number, number][];
}

/** Loft a tube through cross-section stations. Stations ordered rear→front (+z). */
function loftGeometry(stations: Station[]): THREE.BufferGeometry {
  const n = stations[0].pts.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const s of stations) {
    for (const [y, w] of s.pts) positions.push(w, y, s.z);
  }
  for (let si = 0; si < stations.length - 1; si++) {
    for (let pi = 0; pi < n; pi++) {
      const a = si * n + pi;
      const b = si * n + ((pi + 1) % n);
      const c = (si + 1) * n + pi;
      const d = (si + 1) * n + ((pi + 1) % n);
      indices.push(a, c, b, b, c, d);
    }
  }
  const base = positions.length / 3;
  // rear cap (faces -z)
  {
    const s = stations[0];
    let cy = 0, cx = 0;
    for (const [y, w] of s.pts) { cy += y; cx += w; }
    cy /= n; cx /= n;
    positions.push(cx, cy, s.z);
    const ci = base;
    for (let pi = 0; pi < n; pi++) {
      indices.push(ci, base + 1 + pi, base + 1 + ((pi + 1) % n));
    }
    for (const [y, w] of s.pts) positions.push(w, y, s.z);
  }
  // front cap (faces +z)
  const base2 = positions.length / 3;
  {
    const s = stations[stations.length - 1];
    let cy = 0, cx = 0;
    for (const [y, w] of s.pts) { cy += y; cx += w; }
    cy /= n; cx /= n;
    positions.push(cx, cy, s.z);
    const ci = base2;
    for (let pi = 0; pi < n; pi++) {
      indices.push(ci, base2 + 1 + ((pi + 1) % n), base2 + 1 + pi);
    }
    for (const [y, w] of s.pts) positions.push(w, y, s.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Body cross-section template. W = half width, belt = beltline height. */
function bodySection(W: number, belt: number): [number, number][] {
  const b = belt;
  return [
    [0.10, -0.78 * W],
    [0.16, -0.94 * W],
    [0.30, -1.00 * W],
    [0.45, -0.99 * W],
    [b - 0.06, -0.94 * W],
    [b, -0.86 * W],
    [b + 0.015, -0.45 * W],
    [b + 0.015, 0.45 * W],
    [b, 0.86 * W],
    [b - 0.06, 0.94 * W],
    [0.45, 0.99 * W],
    [0.30, 1.00 * W],
    [0.16, 0.94 * W],
    [0.10, 0.78 * W],
  ];
}

/** Glass canopy cross-section. */
function canopySection(W: number, base: number, top: number): [number, number][] {
  const mid = base + (top - base) * 0.55;
  return [
    [base, -0.95 * W],
    [mid, -1.00 * W],
    [top - 0.02, -0.72 * W],
    [top, 0],
    [top - 0.02, 0.72 * W],
    [mid, 1.00 * W],
    [base, 0.95 * W],
  ];
}

export interface WheelRef {
  pivot: THREE.Group; // steers (front)
  spinner: THREE.Group; // spins
  front: boolean;
}

export interface RoadsterRefs {
  group: THREE.Group;      // positioned/rotated by physics
  chassis: THREE.Group;    // body roll/pitch applied here
  paintMats: THREE.MeshPhysicalMaterial[];
  wheelMats: THREE.MeshStandardMaterial[];
  drlMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  lensMat: THREE.MeshPhysicalMaterial;
  wheels: WheelRef[];
  steeringWheel: THREE.Group;
  headlightL: THREE.Object3D;
  headlightR: THREE.Object3D;
  setFinish(f: Finish): void;
  setPaint(hex: string): void;
  setWheelColor(hex: string): void;
}

const BODY_STATIONS: [number, number, number][] = [
  // z, halfWidth, beltline
  [-2.20, 0.80, 0.60],
  [-2.12, 0.88, 0.64],
  [-1.90, 0.94, 0.68],
  [-1.55, 0.965, 0.72],
  [-1.10, 0.95, 0.705],
  [-0.55, 0.935, 0.695],
  [0.00, 0.93, 0.70],
  [0.55, 0.94, 0.71],
  [1.05, 0.945, 0.705],
  [1.45, 0.92, 0.66],
  [1.80, 0.86, 0.585],
  [2.05, 0.76, 0.53],
  [2.20, 0.58, 0.50],
  [2.26, 0.30, 0.485],
];

const CANOPY_STATIONS: [number, number, number, number][] = [
  // z, halfWidth, base, top
  [-1.02, 0.60, 0.64, 0.94],
  [-0.72, 0.68, 0.665, 1.02],
  [-0.30, 0.715, 0.68, 1.065],
  [0.10, 0.71, 0.685, 1.06],
  [0.45, 0.66, 0.68, 1.00],
  [0.78, 0.56, 0.67, 0.86],
  [0.95, 0.42, 0.66, 0.74],
];

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildRoadster(paintHex = '#a4121e', wheelHex = '#2a2d31'): RoadsterRefs {
  const group = new THREE.Group();
  const chassis = new THREE.Group();
  group.add(chassis);

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(paintHex),
    metalness: 0.7,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.25,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x10161c),
    metalness: 0.2,
    roughness: 0.06,
    transparent: true,
    opacity: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.5,
  });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.35, metalness: 0.6 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.93, metalness: 0 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(wheelHex), roughness: 0.32, metalness: 0.9 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 1 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: 0xc01818, roughness: 0.45, metalness: 0.3 });
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8f2, roughness: 0.05, metalness: 0.1,
    transparent: true, opacity: 0.9, clearcoat: 1, envMapIntensity: 1.4,
  });
  const drlMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xcfe8ff, emissiveIntensity: 2.2, roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 1.4, roughness: 0.3,
  });
  const interiorMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.85 });
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x06121c, emissive: 0x2f9fd8, emissiveIntensity: 0.9, roughness: 0.4,
  });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });

  // --- body + canopy ---
  const bodyGeo = loftGeometry(BODY_STATIONS.map(([z, W, belt]) => ({ z, pts: bodySection(W, belt) })));
  const bodyMesh = new THREE.Mesh(bodyGeo, paintMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  chassis.add(bodyMesh);

  const canopyGeo = loftGeometry(CANOPY_STATIONS.map(([z, W, base, top]) => ({ z, pts: canopySection(W, base, top) })));
  const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
  chassis.add(canopyMesh);

  // undertray
  const tray = box(1.7, 0.02, 4.3, trimMat, 0, 0.055, 0);
  tray.castShadow = false;
  chassis.add(tray);

  // --- aero ---
  chassis.add(box(1.66, 0.05, 0.32, trimMat, 0, 0.075, 2.02)); // splitter
  chassis.add(box(0.08, 0.07, 1.9, trimMat, -0.90, 0.09, 0));  // skirts
  chassis.add(box(0.08, 0.07, 1.9, trimMat, 0.90, 0.09, 0));
  chassis.add(box(1.5, 0.10, 0.35, trimMat, 0, 0.10, -2.02));  // diffuser
  for (let i = -2; i <= 2; i++) {
    chassis.add(box(0.025, 0.09, 0.30, trimMat, i * 0.28, 0.10, -2.04)); // diffuser fins
  }
  const intakeF = box(1.2, 0.12, 0.08, trimMat, 0, 0.22, 2.16);
  intakeF.rotation.x = 0.25;
  chassis.add(intakeF);
  chassis.add(box(0.07, 0.16, 0.5, trimMat, -0.945, 0.45, -0.85)); // side intakes
  chassis.add(box(0.07, 0.16, 0.5, trimMat, 0.945, 0.45, -0.85));

  // --- lights ---
  for (const sx of [-1, 1]) {
    const housing = box(0.34, 0.075, 0.11, paintMat, sx * 0.52, 0.545, 1.94);
    housing.rotation.y = -sx * 0.18;
    housing.rotation.x = 0.1;
    chassis.add(housing);
    const lens = box(0.32, 0.065, 0.03, lensMat, sx * 0.52, 0.56, 2.02);
    lens.rotation.y = -sx * 0.18;
    chassis.add(lens);
    const drl = box(0.28, 0.014, 0.012, drlMat, sx * 0.52, 0.545, 2.035);
    drl.rotation.y = -sx * 0.18;
    chassis.add(drl);
  }
  chassis.add(box(1.5, 0.055, 0.05, tailMat, 0, 0.63, -2.185)); // full-width tail bar
  chassis.add(box(0.18, 0.04, 0.02, lensMat, 0.45, 0.52, -2.19)); // reverse light

  // mirrors + handles + plate + arch trims
  for (const sx of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.09, 8), trimMat);
    stalk.position.set(sx * 0.98, 0.74, 0.62);
    stalk.rotation.z = sx * 0.5;
    chassis.add(stalk);
    chassis.add(box(0.15, 0.085, 0.10, paintMat, sx * 1.03, 0.79, 0.62));
    chassis.add(box(0.02, 0.025, 0.16, trimMat, sx * 0.945, 0.64, -0.15)); // handle
    const archGeo = new THREE.TorusGeometry(0.42, 0.035, 10, 24, Math.PI);
    archGeo.rotateY(Math.PI / 2);
    for (const az of [1.325, -1.325]) {
      const arch = new THREE.Mesh(archGeo, trimMat);
      arch.position.set(sx * 0.90, 0.34, az);
      chassis.add(arch);
    }
  }
  chassis.add(box(0.44, 0.11, 0.02, plateMat, 0, 0.42, -2.20));

  // --- wheels ---
  const wheels: WheelRef[] = [];
  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.27, 30);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.275, 24);
  rimGeo.rotateZ(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.28, 20);
  discGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.285, 0.055, 0.075);
  for (const [sx, az, front] of [[-1, 1.325, true], [1, 1.325, true], [-1, -1.325, false], [1, -1.325, false]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.80, 0.34, az);
    const spinner = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, rubberMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, wheelMat);
    const disc = new THREE.Mesh(discGeo, discMat);
    spinner.add(tire, rim, disc);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(spokeGeo, wheelMat);
      spoke.rotation.x = (i / 5) * Math.PI * 2;
      spoke.position.set(0, Math.sin(spoke.rotation.x) * 0.0, 0);
      // place spoke radially: offset along its local Y before rotation
      const holder = new THREE.Group();
      spoke.position.set(0, 0.115, 0);
      holder.rotation.x = (i / 5) * Math.PI * 2;
      holder.add(spoke);
      spinner.add(holder);
    }
    const caliper = box(0.10, 0.09, 0.07, caliperMat, sx * 0.02, 0.05, -0.10);
    spinner.add(caliper);
    pivot.add(spinner);
    group.add(pivot); // wheels don't roll with chassis
    wheels.push({ pivot, spinner, front });
  }

  // --- interior (visible through glass / cockpit cam) ---
  const interior = new THREE.Group();
  interior.add(box(1.4, 0.06, 2.5, interiorMat, 0, 0.32, -0.1)); // floor
  interior.add(box(1.45, 0.20, 0.34, interiorMat, 0, 0.80, 0.72)); // dash
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), screenMat);
  screen.position.set(0, 0.86, 0.60);
  screen.rotation.x = -0.35;
  interior.add(screen);
  const swGroup = new THREE.Group();
  swGroup.position.set(-0.38, 0.80, 0.52);
  const swRim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.022, 10, 28), interiorMat);
  swRim.rotation.x = -0.5;
  swGroup.add(swRim);
  const swCol = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), interiorMat);
  swCol.rotation.x = 1.1;
  swCol.position.set(0, -0.06, 0.10);
  swGroup.add(swCol);
  interior.add(swGroup);
  for (const sx of [-1, 1]) {
    interior.add(box(0.5, 0.12, 0.52, interiorMat, sx * 0.38, 0.44, -0.30)); // seat base
    const back = box(0.5, 0.58, 0.13, interiorMat, sx * 0.38, 0.70, -0.60);
    back.rotation.x = -0.14;
    interior.add(back);
  }
  interior.add(box(0.24, 0.16, 0.85, interiorMat, 0, 0.50, 0.05)); // console
  chassis.add(interior);

  // headlight beam anchors (game adds real spotlights here)
  const headlightL = new THREE.Object3D();
  headlightL.position.set(-0.52, 0.56, 2.0);
  const headlightR = new THREE.Object3D();
  headlightR.position.set(0.52, 0.56, 2.0);
  chassis.add(headlightL, headlightR);

  const refs: RoadsterRefs = {
    group, chassis,
    paintMats: [paintMat],
    wheelMats: [wheelMat],
    drlMat, tailMat, lensMat,
    wheels,
    steeringWheel: swGroup,
    headlightL, headlightR,
    setFinish(f: Finish) {
      if (f === 'gloss') {
        paintMat.roughness = 0.30; paintMat.metalness = 0.70;
        paintMat.clearcoat = 1; paintMat.clearcoatRoughness = 0.06;
      } else if (f === 'metallic') {
        paintMat.roughness = 0.38; paintMat.metalness = 0.92;
        paintMat.clearcoat = 0.6; paintMat.clearcoatRoughness = 0.15;
      } else {
        paintMat.roughness = 0.78; paintMat.metalness = 0.25;
        paintMat.clearcoat = 0; paintMat.clearcoatRoughness = 0.4;
      }
      paintMat.needsUpdate = true;
    },
    setPaint(hex: string) { paintMat.color.set(hex); },
    setWheelColor(hex: string) { wheelMat.color.set(hex); },
  };
  refs.setFinish('gloss');
  return refs;
}
