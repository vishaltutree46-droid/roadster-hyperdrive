// Garage: studio showcase with turntable, orbit/zoom, live customization.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildRoadster, type RoadsterRefs } from './carModel';
import type { Settings } from './config';

export class Garage {
  scene = new THREE.Scene();
  car: RoadsterRefs;
  private controls: OrbitControls;
  private turntable = true;
  private platform: THREE.Mesh;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private settings: Settings,
    private cam: THREE.PerspectiveCamera,
  ) {
    this.scene.background = new THREE.Color(0x07090d);
    this.scene.fog = new THREE.Fog(0x07090d, 18, 46);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // studio lighting
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fb7ff, 1.1);
    rim.position.set(-7, 5, -6);
    this.scene.add(rim);
    const fill = new THREE.HemisphereLight(0xbcd0e8, 0x11141a, 0.55);
    this.scene.add(fill);
    const spot = new THREE.SpotLight(0xffffff, 60, 30, 0.5, 0.5);
    spot.position.set(0, 11, 0);
    spot.target.position.set(0, 0, 0);
    this.scene.add(spot, spot.target);

    // floor + platform
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(24, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.35, metalness: 0.75 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.platform = new THREE.Mesh(
      new THREE.CylinderGeometry(4.4, 4.6, 0.22, 48),
      new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.3, metalness: 0.8 })
    );
    this.platform.position.y = 0.11;
    this.platform.receiveShadow = true;
    this.scene.add(this.platform);
    // glowing ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4.4, 0.035, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0x061014, emissive: 0x37e0ff, emissiveIntensity: 1.6 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.23;
    this.scene.add(ring);

    // car
    this.car = buildRoadster(settings.paint, settings.wheelColor);
    this.car.group.position.y = 0.22;
    this.scene.add(this.car.group);
    this.applySettings();

    this.cam.position.set(6.5, 2.2, 6.5);
    this.controls = new OrbitControls(this.cam, renderer.domElement);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = 1.48;
    this.controls.enablePan = false;
    this.controls.autoRotate = false;
  }

  applySettings(): void {
    const s = this.settings;
    this.car.setPaint(s.paint);
    this.car.setFinish(s.finish);
    this.car.setWheelColor(s.wheelColor);
    this.car.drlMat.emissiveIntensity = s.headlights ? 3.2 : 1.1;
    this.car.tailMat.emissiveIntensity = s.headlights ? 2.6 : 1.2;
  }

  setTurntable(v: boolean): void { this.turntable = v; }

  setInteractive(v: boolean): void { this.controls.enabled = v; }

  presetView(name: 'front' | 'side' | 'rear' | 'top'): void {
    const c = this.controls;
    if (name === 'front') { c.object.position.set(0, 1.6, 8.5); }
    else if (name === 'rear') { c.object.position.set(0, 1.8, -8.5); }
    else if (name === 'side') { c.object.position.set(8.5, 1.3, 0); }
    else { c.object.position.set(0.5, 10.5, 0.5); }
    c.target.set(0, 0.8, 0);
  }

  update(dt: number): void {
    if (this.turntable) {
      this.car.group.rotation.y += dt * 0.35;
    }
    this.controls.update();
    // wheel spin idle? keep parked
  }

  onResize(w: number, h: number): void {
    // camera handled by game
    void w; void h;
  }
}
