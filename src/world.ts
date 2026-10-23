// Open world: coastal highway loop, mountain road, tunnel, river bridge,
// city district, test pad, palms, sky, day/night + weather.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { QualityPreset, TimeOfDay, Weather } from './config';
import type { SurfaceInfo } from './physics';

// ---------- analytic terrain ----------
function gauss(x: number, z: number, cx: number, cz: number, amp: number, sigma: number): number {
  const dx = x - cx, dz = z - cz;
  return amp * Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
}
function distToSeg2D(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  const px = ax + dx * t, pz = az + dz * t;
  return Math.hypot(x - px, z - pz);
}
// tunnel cutting segment (cut-and-cover)
const TUN_A = { x: 185, z: -548 };
const TUN_B = { x: 515, z: -548 };

export function terrainHeight(x: number, z: number): number {
  let h = 0;
  h += gauss(x, z, 620, -260, 60, 300);
  h += gauss(x, z, 950, 150, 34, 200);
  h += gauss(x, z, -700, 500, 18, 260);
  h += gauss(x, z, -500, -700, 26, 240);
  // ocean shelf
  const t = THREE.MathUtils.smoothstep(z, 400, 480);
  h = h * (1 - t) + -5 * t;
  // river channel at x=300 (z 140..660)
  const rz = THREE.MathUtils.smoothstep(z, 140, 200) * (1 - THREE.MathUtils.smoothstep(z, 600, 660));
  h -= 9 * Math.exp(-Math.pow((x - 300) / 70, 2)) * rz;
  // tunnel cutting
  const d = distToSeg2D(x, z, TUN_A.x, TUN_A.z, TUN_B.x, TUN_B.z);
  h -= 15 * Math.exp(-Math.pow(d / 20, 2));
  return h;
}

// ---------- canvas texture helpers ----------
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface Collider { x: number; z: number; r: number }
export interface CheckpointGate {
  pos: THREE.Vector3; yaw: number;
  group: THREE.Group; beacon: THREE.Mesh;
  setNext(v: boolean): void; setPassed(v: boolean): void;
}
export interface RoadQuery { dist: number; y: number; tx: number; tz: number; idx: number }

export interface WorldRefs {
  update(dt: number, carPos: THREE.Vector3): void;
  setTimeOfDay(t: TimeOfDay): void;
  setWeather(w: Weather): void;
  getSurface(x: number, z: number): SurfaceInfo;
  nearestRoad(x: number, z: number): RoadQuery;
  queryColliders(x: number, z: number): Collider[];
  roadLength: number;
  startPose: { x: number; y: number; z: number; yaw: number };
  checkpoints: CheckpointGate[];
  speedZone: { x0: number; x1: number; z: number };
  testPad: { x: number; z: number; r: number };
  mapSamples: { x: number; z: number }[];
  applyQuality(q: QualityPreset): void;
}

const ROAD_W = 13;

export function buildWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer): WorldRefs {
  // environment reflections for PBR paint
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.fog = new THREE.FogExp2(0xbcd9f5, 0.00035);

  // ---------- lights ----------
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x5a6b4a, 0.7);
  scene.add(hemi);

  // ---------- sky dome ----------
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x2f6fd0) },
    horizonColor: { value: new THREE.Color(0xbcd9f5) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(0xfff2dd) },
    nightFactor: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(2800, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 topColor, horizonColor, sunColor; uniform vec3 sunDir; uniform float nightFactor;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizonColor, topColor, pow(clamp(h,0.0,1.0), 0.55));
          if(h < 0.0) col = mix(horizonColor, horizonColor*0.3, clamp(-h*4.0,0.0,1.0));
          float sd = dot(d, sunDir);
          col += sunColor * pow(clamp(sd,0.0,1.0), 600.0) * 1.1;
          col += sunColor * smoothstep(0.99935, 0.99975, sd) * 4.0;
          if(nightFactor > 0.01 && h > 0.02){
            vec3 sp = d * 260.0;
            vec3 cell = floor(sp);
            float rnd = fract(sin(dot(cell, vec3(12.9898,78.233,37.719))) * 43758.5453);
            float star = smoothstep(0.28, 0.0, length(fract(sp)-0.5)) * step(0.992, rnd);
            col += vec3(0.85,0.92,1.0) * star * nightFactor * smoothstep(0.02,0.3,h);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  scene.add(sky);

  // ---------- terrain ----------
  const terGeo = new THREE.PlaneGeometry(2600, 2600, 150, 150);
  terGeo.rotateX(-Math.PI / 2);
  {
    const p = terGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const cGrass = new THREE.Color(0x4a7c3a), cGrass2 = new THREE.Color(0x5d8f43);
    const cSand = new THREE.Color(0xc2a878), cRock = new THREE.Color(0x6f6a63);
    const cWaterBed = new THREE.Color(0x274b5a);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = terrainHeight(x, z);
      p.setY(i, h);
      const n = Math.sin(x * 0.11) * Math.sin(z * 0.13) * 0.5 + 0.5;
      if (h < -2) tmp.copy(cWaterBed);
      else if (h < 0.6 && z > 300) tmp.copy(cSand);
      else if (h > 26) tmp.copy(cRock).lerp(cGrass, 0.25);
      else tmp.copy(cGrass).lerp(cGrass2, n);
      // darken tunnel cutting walls slightly
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    terGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terGeo.computeVertexNormals();
  }
  const terrain = new THREE.Mesh(terGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- water ----------
  const waterTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#0d4a66'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 8, 1);
    }
  });
  waterTex.repeat.set(30, 10);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1a6a94, map: waterTex, transparent: true, opacity: 0.92,
    roughness: 0.18, metalness: 0.35,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2600, 800), waterMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -1.2, 820);
  scene.add(ocean);
  const river = new THREE.Mesh(new THREE.PlaneGeometry(260, 560), waterMat);
  river.rotation.x = -Math.PI / 2;
  river.position.set(300, -1.15, 400);
  scene.add(river);

  // ---------- road curve ----------
  const ctrl: [number, number][] = [
    [-650, 300], [-350, 305], [-50, 300], [200, 300], [300, 300], [400, 300],
    [520, 300], [650, 290], [820, 180], [900, -40], [860, -260], [700, -420],
    [520, -520], [350, -560], [180, -545], [0, -520], [-180, -480], [-320, -420],
    [-480, -320], [-600, -80], [-680, 120],
  ];
  const curvePts = ctrl.map(([x, z]) => new THREE.Vector3(x, terrainHeight(x, z) + 0.12, z));
  const curve = new THREE.CatmullRomCurve3(curvePts, true, 'catmullrom', 0.35);
  const N = 1500;
  const sp = curve.getSpacedPoints(N); // N+1 points, last == first
  const samples = sp.slice(0, N);
  // bridge deck over river at x=300 (road runs along x near z=300)
  // deck blends from natural grade up to 4.5m over the water (water at -1.2)
  for (let i = 0; i < N; i++) {
    const p = samples[i];
    if (Math.abs(p.z - 300) < 60 && Math.abs(p.x - 300) < 130) {
      const f = Math.cos(((p.x - 300) / 130) * Math.PI / 2);
      const w = f * f;
      p.y = p.y * (1 - w) + 4.5 * w;
    }
  }
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const t = curve.getTangent(i / N);
    t.y = 0; t.normalize();
    tangents.push(t);
  }
  const up = new THREE.Vector3(0, 1, 0);
  const sideOf = (i: number) => new THREE.Vector3().crossVectors(tangents[i], up).normalize();

  let roadLength = 0;
  for (let i = 0; i < N; i++) roadLength += samples[i].distanceTo(samples[(i + 1) % N]);

  // ---------- road ribbons ----------
  const roadTex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#33363b'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const v = 40 + Math.random() * 30;
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    g.fillStyle = '#e8e8e8';
    g.fillRect(8, 0, 7, 256); g.fillRect(241, 0, 7, 256); // edge lines
    g.fillRect(124, 10, 8, 120); // center dash
  });
  function ribbon(width: number, yOff: number, mat: THREE.Material, vScale: number): THREE.Mesh {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let dist = 0;
    for (let i = 0; i <= N; i++) {
      const s = samples[i % N];
      const side = sideOf(i % N);
      if (i > 0) dist += s.distanceTo(samples[(i - 1) % N]);
      pos.push(s.x - side.x * width / 2, s.y + yOff, s.z - side.z * width / 2);
      pos.push(s.x + side.x * width / 2, s.y + yOff, s.z + side.z * width / 2);
      uv.push(0, dist / vScale, 1, dist / vScale);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9, metalness: 0 });
  (roadTex as THREE.Texture).repeat.set(1, 1);
  const roadMesh = ribbon(ROAD_W, 0, roadMat, 14);
  scene.add(roadMesh);
  const shoulder = ribbon(ROAD_W + 5, -0.03, new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.95 }), 20);
  scene.add(shoulder);

  // ---------- colliders + spatial hash ----------
  const colliders: Collider[] = [];
  const hash = new Map<number, Collider[]>();
  const hkey = (x: number, z: number) => (Math.floor(x / 25) + 100) * 1000 + (Math.floor(z / 25) + 100);
  function addCollider(x: number, z: number, r: number): void {
    const c = { x, z, r };
    colliders.push(c);
    const k = hkey(x, z);
    let arr = hash.get(k);
    if (!arr) { arr = []; hash.set(k, arr); }
    arr.push(c);
  }
  function queryColliders(x: number, z: number): Collider[] {
    const out: Collider[] = [];
    const ix = Math.floor(x / 25), iz = Math.floor(z / 25);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const arr = hash.get((ix + a + 100) * 1000 + (iz + b + 100));
      if (arr) out.push(...arr);
    }
    return out;
  }

  // ---------- rails / posts / bridge walls ----------
  const inBridge = (i: number) => Math.abs(samples[i].z - 300) < 60 && Math.abs(samples[i].x - 300) < 130;
  {
    const railGeo = new THREE.BoxGeometry(6.6, 0.28, 0.08); // overlapping → continuous rail
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.8 });
    const wallGeo = new THREE.BoxGeometry(4.4, 1.1, 0.25);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8d8d90, roughness: 0.8 });
    const postGeo = new THREE.BoxGeometry(0.14, 0.62, 0.14);
    const railT: { x: number; y: number; z: number; ry: number }[] = [];
    const wallT: typeof railT = [];
    const postT: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < N; i += 2) {
      const s = samples[i], side = sideOf(i);
      const yaw = Math.atan2(tangents[i].x, tangents[i].z);
      for (const sgn of [-1, 1]) {
        const x = s.x + side.x * 7.3 * sgn, z = s.z + side.z * 7.3 * sgn;
        if (inBridge(i)) {
          wallT.push({ x, y: s.y + 0.55, z, ry: yaw });
          if (i % 4 === 0) addCollider(x, z, 0.6);
        } else {
          railT.push({ x, y: s.y + 0.62, z, ry: yaw });
          if (i % 4 === 0) {
            postT.push({ x, y: s.y + 0.3, z });
            addCollider(x, z, 0.45);
          }
        }
      }
    }
    const mkInst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: typeof railT) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      list.forEach((t, k) => {
        e.set(0, t.ry, 0); q.setFromEuler(e); v.set(t.x, t.y, t.z);
        m4.compose(v, q, sc); im.setMatrixAt(k, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      return im;
    };
    mkInst(railGeo, railMat, railT);
    mkInst(wallGeo, wallMat, wallT);
    const pim = new THREE.InstancedMesh(postGeo, railMat, postT.length);
    const m4 = new THREE.Matrix4();
    postT.forEach((t, k) => { m4.makeTranslation(t.x, t.y, t.z); pim.setMatrixAt(k, m4); });
    pim.instanceMatrix.needsUpdate = true;
    scene.add(pim);
  }

  // ---------- bridge piers ----------
  for (const px of [240, 300, 360]) {
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.6, 13, 10),
      new THREE.MeshStandardMaterial({ color: 0x7d7d80, roughness: 0.85 }));
    pier.position.set(px, -2, 300); // spans river bed (-8.5) up to deck (4.5)
    pier.castShadow = true;
    scene.add(pier);
  }

  // ---------- streetlights ----------
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd9a0, emissiveIntensity: 0.15, roughness: 0.5 });
  {
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7.2, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.6 });
    const headGeo = new THREE.BoxGeometry(0.75, 0.14, 0.28);
    const lampPos: { x: number; y: number; z: number; ry: number }[] = [];
    for (let i = 0; i < N; i += 19) {
      const s = samples[i], side = sideOf(i);
      if (distToSeg2D(s.x, s.z, TUN_A.x, TUN_A.z, TUN_B.x, TUN_B.z) < 15) continue; // no lamps inside tunnel
      const sgn = (i / 19) % 2 === 0 ? 1 : -1;
      const x = s.x + side.x * 8.6 * sgn, z = s.z + side.z * 8.6 * sgn;
      const yaw = Math.atan2(tangents[i].x, tangents[i].z) + (sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
      lampPos.push({ x, y: s.y + 3.6, z, ry: yaw });
      addCollider(x, z, 0.4);
    }
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampPos.length);
    const heads = new THREE.InstancedMesh(headGeo, lampHeadMat, lampPos.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    lampPos.forEach((t, k) => {
      e.set(0, 0, 0); q.setFromEuler(e); v.set(t.x, t.y, t.z); m4.compose(v, q, sc); poles.setMatrixAt(k, m4);
      e.set(0, t.ry, 0); q.setFromEuler(e); v.set(t.x, t.y + 3.6, t.z); m4.compose(v, q, sc); heads.setMatrixAt(k, m4);
    });
    poles.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    scene.add(poles, heads);
  }

  // ---------- tunnel (cut-and-cover) ----------
  let tunI0 = 0, tunI1 = 0, best = 1e9;
  for (let i = 0; i < N; i++) {
    const d = Math.hypot(samples[i].x - TUN_A.x, samples[i].z - TUN_A.z);
    if (d < best) { best = d; tunI0 = i; }
  }
  best = 1e9;
  for (let i = 0; i < N; i++) {
    const d = Math.hypot(samples[i].x - TUN_B.x, samples[i].z - TUN_B.z);
    if (d < best) { best = d; tunI1 = i; }
  }
  if (tunI1 < tunI0) { const t = tunI0; tunI0 = tunI1; tunI1 = t; }
  {
    // tube: half-cylinder rings along samples
    const rings: number[] = [];
    for (let i = tunI0 - 6; i <= tunI1 + 6; i++) rings.push(((i % N) + N) % N);
    const ARC = 12, R = 8.6;
    const pos: number[] = [], idx: number[] = [], uvs: number[] = [];
    rings.forEach((ri, r) => {
      const s = samples[ri], side = sideOf(ri);
      for (let a = 0; a <= ARC; a++) {
        const th = (a / ARC) * Math.PI; // 0..π across the top
        const ox = Math.cos(th) * R, oy = Math.sin(th) * R;
        pos.push(s.x + side.x * ox, s.y - 0.4 + oy, s.z + side.z * ox);
        uvs.push(a / ARC, r / rings.length);
      }
    });
    for (let r = 0; r < rings.length - 1; r++) {
      for (let a = 0; a < ARC; a++) {
        const p0 = r * (ARC + 1) + a, p1 = p0 + 1, p2 = p0 + ARC + 1, p3 = p2 + 1;
        idx.push(p0, p2, p1, p1, p2, p3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tube = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: 0x4a4d52, roughness: 0.9, side: THREE.DoubleSide,
    }));
    scene.add(tube);
    // interior light strips
    const stripGeo = new THREE.BoxGeometry(0.3, 0.12, 2.2);
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xbfd9ff, emissiveIntensity: 2.4 });
    const strips: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    for (let i = tunI0; i <= tunI1; i += 4) {
      const s = samples[i];
      m4.makeTranslation(s.x, s.y + 7.6, s.z);
      strips.push(m4.clone());
    }
    const sim = new THREE.InstancedMesh(stripGeo, stripMat, strips.length);
    strips.forEach((m, k) => sim.setMatrixAt(k, m));
    sim.instanceMatrix.needsUpdate = true;
    scene.add(sim);
    // rock lid over the tube (cut-and-cover): edges skirt down into the terrain
    const midX = (TUN_A.x + TUN_B.x) / 2, midZ = (TUN_A.z + TUN_B.z) / 2;
    const midY = samples[tunI0].y;
    const lidGeo = new THREE.PlaneGeometry(340, 120, 44, 14);
    lidGeo.rotateX(-Math.PI / 2);
    {
      const p = lidGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const ridge = Math.exp(-Math.pow(z / 30, 2)) * 26;
        const n = Math.sin(x * 0.15) * Math.cos(z * 0.2) * 2.5 + Math.sin(x * 0.05 + z * 0.07) * 4;
        let y = ridge + n + 9.5;
        const az = Math.abs(z), ax = Math.abs(x);
        if (az > 40) y = Math.max(-4, y - (az - 40) * 1.7); // side skirts dive into terrain
        if (ax > 155) y = Math.max(-4, y - (ax - 155) * 1.7); // end skirts
        p.setY(i, y);
      }
      lidGeo.computeVertexNormals();
    }
    const lid = new THREE.Mesh(lidGeo, new THREE.MeshStandardMaterial({ color: 0x5c5a52, roughness: 1, flatShading: true }));
    lid.position.set(midX, midY, midZ);
    lid.rotation.y = 0.02;
    lid.castShadow = true;
    scene.add(lid);
    // portal frames
    const portalMat = new THREE.MeshStandardMaterial({ color: 0x6b675c, roughness: 0.95 });
    for (const ri of [rings[0], rings[rings.length - 1]]) {
      const s = samples[ri], side = sideOf(ri);
      const yaw = Math.atan2(tangents[ri].x, tangents[ri].z);
      const grp = new THREE.Group();
      grp.position.copy(s);
      grp.rotation.y = yaw;
      const pil1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 13, 3), portalMat);
      pil1.position.set(-9.8, 6, 0);
      const pil2 = pil1.clone(); pil2.position.x = 9.8;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 2.6, 3), portalMat);
      beam.position.set(0, 12.2, 0);
      pil1.castShadow = pil2.castShadow = beam.castShadow = true;
      grp.add(pil1, pil2, beam);
      scene.add(grp);
      addCollider(s.x + side.x * 9.8, s.z + side.z * 9.8, 1.4);
      addCollider(s.x - side.x * 9.8, s.z - side.z * 9.8, 1.4);
    }
    // tunnel wall colliders
    for (let i = tunI0; i <= tunI1; i += 2) {
      const s = samples[i], side = sideOf(i);
      addCollider(s.x + side.x * 8.2, s.z + side.z * 8.2, 0.6);
      addCollider(s.x - side.x * 8.2, s.z - side.z * 8.2, 0.6);
    }
  }

  // ---------- city district ----------
  const CITY = { x: -400, z: -300, r: 175 };
  const winTex = canvasTexture(128, 256, (g) => {
    g.fillStyle = '#151a21'; g.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 6; x++) {
      g.fillStyle = '#0a0e14';
      g.fillRect(8 + x * 20, 10 + y * 15, 12, 8);
    }
  });
  const winEmi = canvasTexture(128, 256, (g) => {
    g.fillStyle = '#000000'; g.fillRect(0, 0, 128, 256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 6; x++) {
      if (Math.random() < 0.45) {
        g.fillStyle = Math.random() < 0.7 ? '#ffd9a0' : '#bfe0ff';
        g.fillRect(8 + x * 20, 10 + y * 15, 12, 8);
      }
    }
  });
  const bldgMat = new THREE.MeshStandardMaterial({
    map: winTex, emissiveMap: winEmi, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.7,
  });
  {
    const district = new THREE.Mesh(new THREE.PlaneGeometry(420, 420),
      new THREE.MeshStandardMaterial({ color: 0x232528, roughness: 0.95 }));
    district.rotation.x = -Math.PI / 2;
    district.position.set(CITY.x, 0.06, CITY.z);
    district.receiveShadow = true;
    scene.add(district);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const spots: { x: number; z: number; w: number; h: number; d: number; ry: number }[] = [];
    for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++) {
      const x = CITY.x + gx * 46 + (Math.random() - 0.5) * 14;
      const z = CITY.z + gz * 46 + (Math.random() - 0.5) * 14;
      if (Math.hypot(x - CITY.x, z - CITY.z) > CITY.r) continue;
      const nr = nearestRoadRaw(x, z);
      if (nr < 30) continue;
      const w = 16 + Math.random() * 14, d = 16 + Math.random() * 14;
      const h = 22 + Math.random() * Math.random() * 70;
      spots.push({ x, z, w, h, d, ry: (Math.random() - 0.5) * 0.2 });
      addCollider(x, z, Math.max(w, d) / 2 + 1.5);
    }
    const im = new THREE.InstancedMesh(geo, bldgMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    spots.forEach((s, k) => {
      e.set(0, s.ry, 0); q.setFromEuler(e); v.set(s.x, 0, s.z); sc.set(s.w, s.h, s.d);
      m4.compose(v, q, sc); im.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
  }
  function nearestRoadRaw(x: number, z: number): number {
    let b = 1e9;
    for (let i = 0; i < N; i += 6) {
      const dx = samples[i].x - x, dz = samples[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < b) b = d;
    }
    return Math.sqrt(b);
  }

  // ---------- palm trees ----------
  {
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.22, 5.6, 7);
    trunkGeo.translate(0, 2.8, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
    const frondTex = canvasTexture(128, 64, (g) => {
      g.clearRect(0, 0, 128, 64);
      for (let i = 0; i < 7; i++) {
        const a = (i / 6 - 0.5) * 1.9;
        g.save(); g.translate(8, 32); g.rotate(a);
        const grad = g.createLinearGradient(0, 0, 120, 0);
        grad.addColorStop(0, '#2e6b2a'); grad.addColorStop(1, '#4f9c3e');
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(0, -7); g.lineTo(118, -2); g.lineTo(118, 2); g.lineTo(0, 7); g.closePath(); g.fill();
        g.restore();
      }
    });
    const frondGeo = new THREE.PlaneGeometry(4.6, 1.7);
    const frondMat = new THREE.MeshStandardMaterial({
      map: frondTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9,
    });
    const spots: { x: number; z: number; s: number; ry: number }[] = [];
    for (let i = 0; i < 260 && spots.length < 190; i++) {
      const x = -640 + Math.random() * 1280;
      const z = 300 + (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 34);
      if (Math.abs(x - 300) < 100) continue; // river/bridge
      const nr = nearestRoadRaw(x, z);
      if (nr < 12) continue;
      const h = terrainHeight(x, z);
      if (h < -1 || h > 4) continue;
      spots.push({ x, z, s: 0.8 + Math.random() * 0.5, ry: Math.random() * Math.PI * 2 });
      addCollider(x, z, 0.45);
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    spots.forEach((s, k) => {
      const h = terrainHeight(s.x, s.z);
      e.set((Math.random() - 0.5) * 0.1, s.ry, (Math.random() - 0.5) * 0.1); q.setFromEuler(e);
      v.set(s.x, h - 0.1, s.z); sc.set(s.s, s.s, s.s);
      m4.compose(v, q, sc); trunks.setMatrixAt(k, m4);
      for (let f = 0; f < 2; f++) {
        e.set(0, s.ry + f * Math.PI / 2 + 0.4, 0); q.setFromEuler(e);
        v.set(s.x, h - 0.1 + 5.6 * s.s, s.z);
        m4.compose(v, q, sc); fronds.setMatrixAt(k * 2 + f, m4);
      }
    });
    trunks.instanceMatrix.needsUpdate = true; fronds.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    scene.add(trunks, fronds);
  }

  // ---------- bushes & rocks ----------
  {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
    const spots: { x: number; z: number; s: number; c: THREE.Color }[] = [];
    for (let i = 0; i < 900 && spots.length < 380; i++) {
      const x = -1100 + Math.random() * 2200, z = -1100 + Math.random() * 2200;
      if (nearestRoadRaw(x, z) < 14) continue;
      if (Math.hypot(x - CITY.x, z - CITY.z) < CITY.r + 20) continue;
      if (Math.abs(x - 300) < 95 && z > 130 && z < 670) continue;
      const d = distToSeg2D(x, z, TUN_A.x, TUN_A.z, TUN_B.x, TUN_B.z);
      if (d < 46) continue;
      const h = terrainHeight(x, z);
      if (h < -1.5) continue;
      const rock = h > 24 || Math.random() < 0.25;
      spots.push({
        x, z, s: 0.45 + Math.random() * 1.0,
        c: rock ? new THREE.Color(0x4a463e) : new THREE.Color().setHSL(0.30 + Math.random() * 0.04, 0.5, 0.22 + Math.random() * 0.08),
      });
    }
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    spots.forEach((s, k) => {
      e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); q.setFromEuler(e);
      v.set(s.x, terrainHeight(s.x, s.z) + s.s * 0.35, s.z); sc.set(s.s, s.s * 0.75, s.s);
      m4.compose(v, q, sc); im.setMatrixAt(k, m4);
      im.setColorAt(k, s.c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true;
    scene.add(im);
  }

  // ---------- distant mountains ----------
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a6a7d, roughness: 1, flatShading: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const r = 1250 + Math.random() * 250;
      const h = 150 + Math.random() * 130;
      const g = new THREE.ConeGeometry(200 + Math.random() * 140, h, 7, 3);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        p.setX(k, p.getX(k) * (1 + (Math.random() - 0.5) * 0.25));
        p.setZ(k, p.getZ(k) * (1 + (Math.random() - 0.5) * 0.25));
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.position.set(Math.cos(a) * r, h / 2 - 14, Math.sin(a) * r);
      scene.add(m);
    }
  }

  // ---------- clouds ----------
  const cloudTex = canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  });
  const clouds: THREE.Sprite[] = [];
  for (let i = 0; i < 14; i++) {
    const sm = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.35 + Math.random() * 0.3, depthWrite: false, fog: false });
    const s = new THREE.Sprite(sm);
    s.position.set((Math.random() - 0.5) * 2400, 170 + Math.random() * 120, (Math.random() - 0.5) * 2400);
    s.scale.set(220 + Math.random() * 220, 70 + Math.random() * 60, 1);
    scene.add(s);
    clouds.push(s);
  }

  // ---------- test pad (flat coastal ground, reachable offroad) ----------
  const PAD = { x: -80, z: 170, r: 58 };
  {
    const padY = terrainHeight(PAD.x, PAD.z);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD.r, 40),
      new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.92 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(PAD.x, padY + 0.07, PAD.z);
    pad.receiveShadow = true;
    scene.add(pad);
    const coneGeo = new THREE.ConeGeometry(0.28, 0.7, 10);
    coneGeo.translate(0, 0.35, 0);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xe8641e, roughness: 0.6 });
    const cones: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const x = PAD.x + Math.cos(a) * (PAD.r - 6), z = PAD.z + Math.sin(a) * (PAD.r - 6);
      m4.makeTranslation(x, padY + 0.07, z);
      cones.push(m4.clone());
      addCollider(x, z, 0.3);
    }
    const cim = new THREE.InstancedMesh(coneGeo, coneMat, cones.length);
    cones.forEach((m, k) => cim.setMatrixAt(k, m));
    cim.instanceMatrix.needsUpdate = true;
    cim.castShadow = true;
    scene.add(cim);
    // gantry
    const gm = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.5, metalness: 0.7 });
    for (const sgn of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 10), gm);
      pil.position.set(PAD.x + sgn * 9, padY + 4, PAD.z - PAD.r + 4);
      pil.castShadow = true;
      scene.add(pil);
      addCollider(PAD.x + sgn * 9, PAD.z - PAD.r + 4, 0.55);
    }
    const bannerTex = canvasTexture(512, 96, (g) => {
      g.fillStyle = '#0b0e13'; g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#37e0ff'; g.font = 'bold 56px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('HYPERDRIVE', 256, 52);
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(17, 3),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
    banner.position.set(PAD.x, padY + 7.4, PAD.z - PAD.r + 4);
    scene.add(banner);
  }

  // ---------- checkpoint gates ----------
  const bannerNum = (n: number) => canvasTexture(256, 96, (g) => {
    g.fillStyle = 'rgba(6,10,16,0.92)'; g.fillRect(0, 0, 256, 96);
    g.strokeStyle = '#37e0ff'; g.lineWidth = 5; g.strokeRect(4, 4, 248, 88);
    g.fillStyle = '#37e0ff'; g.font = 'bold 52px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(n === 0 ? 'START' : `CP ${n}`, 128, 52);
  });
  const checkpoints: CheckpointGate[] = [];
  const gateFractions = [0.02, 0.145, 0.27, 0.395, 0.52, 0.645, 0.77, 0.895];
  gateFractions.forEach((f, gi) => {
    const i = Math.floor(f * N) % N;
    const s = samples[i], side = sideOf(i);
    const yaw = Math.atan2(tangents[i].x, tangents[i].z);
    const grp = new THREE.Group();
    grp.position.copy(s);
    grp.rotation.y = yaw;
    const pylMats: THREE.MeshStandardMaterial[] = [];
    for (const sgn of [-1, 1]) {
      const pym = new THREE.MeshStandardMaterial({ color: 0x0b0e13, emissive: 0x37e0ff, emissiveIntensity: 1.6, roughness: 0.4 });
      const py = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 4.2, 10), pym);
      py.position.set(sgn * 7.2, 2.1, 0);
      py.castShadow = true;
      grp.add(py);
      pylMats.push(pym);
      addCollider(s.x + side.x * 7.2 * sgn, s.z + side.z * 7.2 * sgn, 0.5);
    }
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 1.7),
      new THREE.MeshBasicMaterial({ map: bannerNum(gi), side: THREE.DoubleSide, transparent: true }));
    ban.position.set(0, 4.6, 0);
    grp.add(ban);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 70, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x37e0ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    beacon.position.set(0, 35, 0);
    beacon.visible = false;
    grp.add(beacon);
    scene.add(grp);
    checkpoints.push({
      pos: s.clone(), yaw, group: grp, beacon,
      setNext(v: boolean) { beacon.visible = v; },
      setPassed(v: boolean) { pylMats.forEach(m => { m.emissive.set(v ? 0x2bd96a : 0x37e0ff); }); },
    });
  });

  // ---------- start pose ----------
  let startIdx = 0, sd = 1e9;
  for (let i = 0; i < N; i++) {
    const d = Math.hypot(samples[i].x + 500, samples[i].z - 300);
    if (d < sd) { sd = d; startIdx = i; }
  }
  const ss = samples[startIdx];
  const startPose = {
    x: ss.x, y: ss.y, z: ss.z,
    yaw: Math.atan2(tangents[startIdx].x, tangents[startIdx].z),
  };

  // ---------- queries ----------
  function nearestRoad(x: number, z: number): RoadQuery {
    let bi = 0, bd = 1e18;
    for (let i = 0; i < N; i += 4) {
      const dx = samples[i].x - x, dz = samples[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    for (let k = -4; k <= 4; k++) {
      const i = (((bi + k) % N) + N) % N;
      const dx = samples[i].x - x, dz = samples[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    return { dist: Math.sqrt(bd), y: samples[bi].y, tx: tangents[bi].x, tz: tangents[bi].z, idx: bi };
  }

  function getSurface(x: number, z: number): SurfaceInfo {
    const nr = nearestRoad(x, z);
    if (nr.dist < ROAD_W / 2 + 1) {
      return { grip: 1, drag: 1, onRoad: true, groundY: nr.y + 0.02 };
    }
    const h = terrainHeight(x, z);
    if (h < -2) return { grip: 0.45, drag: 9, onRoad: false, groundY: Math.max(h, -1.0) }; // water
    if (h < 0.8 && z > 280) return { grip: 0.7, drag: 2.2, onRoad: false, groundY: h };   // sand
    return { grip: 0.6, drag: 1.7, onRoad: false, groundY: h };                            // grass
  }

  // ---------- time of day / weather ----------
  let tod: TimeOfDay = 'day';
  let wx: Weather = 'clear';
  const sunDirV = new THREE.Vector3();

  function applySky(): void {
    const fog = scene.fog as THREE.FogExp2;
    let exposure = 1.0;
    // clouds follow the mood
    const cloudTint = tod === 'day' ? new THREE.Color(0xffffff)
      : tod === 'sunset' ? new THREE.Color(0xffd9c0) : new THREE.Color(0x2a3547);
    const cloudOp = tod === 'night' ? 0.30 : 0.55;
    for (const c of clouds) {
      (c.material as THREE.SpriteMaterial).color.copy(cloudTint);
      (c.material as THREE.SpriteMaterial).opacity = cloudOp * (0.7 + 0.3 * Math.random());
    }
    if (tod === 'day') {
      sunDirV.set(-0.45, 0.75, 0.35).normalize();
      sun.color.set(0xfff4e0); sun.intensity = 2.6;
      hemi.color.set(0xbcd8ff); hemi.groundColor.set(0x5a6b4a); hemi.intensity = 0.7;
      skyUniforms.topColor.value.set(0x2f6fd0);
      skyUniforms.horizonColor.value.set(0xbcd9f5);
      skyUniforms.sunColor.value.set(0xfff2dd);
      skyUniforms.nightFactor.value = 0;
      fog.color.set(0xbcd9f5); fog.density = 0.00035;
      lampHeadMat.emissiveIntensity = 0.15;
      bldgMat.emissiveIntensity = 0.25;
    } else if (tod === 'sunset') {
      sunDirV.set(-0.92, 0.14, 0.25).normalize();
      sun.color.set(0xffb36b); sun.intensity = 2.1;
      hemi.color.set(0xd8a06a); hemi.groundColor.set(0x4a4038); hemi.intensity = 0.45;
      skyUniforms.topColor.value.set(0x2a3f66);
      skyUniforms.horizonColor.value.set(0xff9a4d);
      skyUniforms.sunColor.value.set(0xffc27d);
      skyUniforms.nightFactor.value = 0.06;
      fog.color.set(0xe8a06a); fog.density = 0.0005;
      lampHeadMat.emissiveIntensity = 1.6;
      bldgMat.emissiveIntensity = 0.8;
    } else {
      sunDirV.set(0.35, 0.62, -0.5).normalize(); // moon
      sun.color.set(0x9fb6ff); sun.intensity = 0.5;
      hemi.color.set(0x24344f); hemi.groundColor.set(0x0c0f14); hemi.intensity = 0.22;
      skyUniforms.topColor.value.set(0x04070f);
      skyUniforms.horizonColor.value.set(0x0b1526);
      skyUniforms.sunColor.value.set(0xcdd9ff);
      skyUniforms.nightFactor.value = 1;
      fog.color.set(0x0b1526); fog.density = 0.00095;
      lampHeadMat.emissiveIntensity = 2.6;
      bldgMat.emissiveIntensity = 1.3;
      exposure = 0.92;
    }
    if (wx === 'rain') {
      sun.intensity *= 0.35;
      hemi.intensity *= 0.7;
      skyUniforms.topColor.value.multiplyScalar(0.55);
      skyUniforms.horizonColor.value.set(0x8b98a5);
      fog.color.set(0x8b98a5); fog.density = Math.max(fog.density, 0.0022);
      roadMat.roughness = 0.35; roadMat.color.set(0x9aa0ad);
      bldgMat.emissiveIntensity = Math.max(bldgMat.emissiveIntensity, 0.9);
      exposure *= 0.95;
    } else if (wx === 'fog') {
      sun.intensity *= 0.5;
      fog.density = 0.006;
      fog.color.set(tod === 'night' ? 0x11161f : 0xc3ccd4);
      skyUniforms.horizonColor.value.set(0xc3ccd4);
      roadMat.roughness = 0.7;
    } else {
      roadMat.roughness = 0.9; roadMat.color.set(0xffffff);
    }
    skyUniforms.sunDir.value.copy(sunDirV);
    renderer.toneMappingExposure = exposure;
  }

  function setTimeOfDay(t: TimeOfDay): void { tod = t; applySky(); }
  function setWeather(w: Weather): void { wx = w; applySky(); }
  applySky();

  // ---------- per-frame ----------
  let elapsed = 0;
  function update(dt: number, carPos: THREE.Vector3): void {
    elapsed += dt;
    waterTex.offset.x = elapsed * 0.008;
    waterTex.offset.y = elapsed * 0.013;
    for (const c of clouds) {
      c.position.x += dt * 2.2;
      if (c.position.x > 1300) c.position.x = -1300;
    }
    // sun follows car for tight shadows
    sun.position.set(carPos.x + sunDirV.x * 380, carPos.y + sunDirV.y * 380, carPos.z + sunDirV.z * 380);
    sun.target.position.copy(carPos);
    // beacon pulse
    for (const cp of checkpoints) {
      if (cp.beacon.visible) {
        (cp.beacon.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.07 * Math.sin(elapsed * 4);
      }
    }
  }

  function applyQuality(q: QualityPreset): void {
    const size = q === 'ultra' ? 2048 : q === 'high' ? 2048 : q === 'medium' ? 1024 : 512;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    sun.castShadow = q !== 'low';
  }

  return {
    update, setTimeOfDay, setWeather, getSurface, nearestRoad,
    queryColliders, roadLength, startPose, checkpoints,
    speedZone: { x0: -450, x1: 150, z: 300 },
    testPad: PAD,
    mapSamples: samples.filter((_, i) => i % 4 === 0).map(s => ({ x: s.x, z: s.z })),
    applyQuality,
  };
}
