// Game orchestrator: state machine, main loop, wiring of all systems.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadSettings, saveSettings, type Settings, type GameModeId, type QualityPreset } from './config';
import { buildWorld, type WorldRefs } from './world';
import { buildRoadster, type RoadsterRefs } from './carModel';
import { VehiclePhysics } from './physics';
import { InputManager } from './input';
import { AudioEngine } from './audio';
import { CameraRig, CAMERA_NAMES } from './cameras';
import { Hud } from './hud';
import { UiManager } from './ui';
import { ModeManager } from './modes';
import { Garage } from './garage';
import { SkidMarks, SpritePool, RainSystem } from './particles';

type State = 'loading' | 'menu' | 'garage' | 'intro' | 'drive' | 'paused' | 'complete';

const PHYS_DT = 1 / 120;
const MODE_NAMES: Record<GameModeId, string> = {
  freeroam: 'Free Roam', timetrial: 'Time Trial', speed: 'Speed Challenge',
  drift: 'Drift Challenge', race: 'Checkpoint Race', photo: 'Photo Mode',
};

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private worldScene = new THREE.Scene();
  private world!: WorldRefs;
  private garage!: Garage;
  private garageCam!: THREE.PerspectiveCamera;
  private car!: RoadsterRefs;
  private physics = new VehiclePhysics();
  private input = new InputManager();
  private audio = new AudioEngine();
  private rig = new CameraRig();
  private hud!: Hud;
  private ui!: UiManager;
  private modes!: ModeManager;
  private settings: Settings = loadSettings();
  private state: State = 'loading';
  private currentMode: GameModeId = 'freeroam';
  private photoMode = false;

  private skid!: SkidMarks;
  private smoke!: SpritePool;
  private sparks!: SpritePool;
  private rain!: RainSystem;
  private headL!: THREE.SpotLight;
  private headR!: THREE.SpotLight;

  private acc = 0;
  private lastT = 0;
  private distanceKm = 0;
  private introT = 0;
  private introMode = 0;
  private prevVF = 0;
  private accelSm = 0;
  private wheelPrevL = new THREE.Vector3();
  private wheelPrevR = new THREE.Vector3();
  private fpsEma = 60;
  private qTimer = 0;
  private effQuality: QualityPreset = 'high';
  private dragging = false;
  private lastPX = 0; private lastPY = 0;

  async init(): Promise<void> {
    const setProgress = (p: number, t: string) => this.ui?.setLoading(p, t) ?? this.bootProgress(p, t);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    // UI first so progress shows
    this.ui = new UiManager(this.settings, this.callbacks());
    this.ui.init();
    this.bootProgress(0.04, 'Starting renderer…');
    await this.yield();

    // world
    this.bootProgress(0.10, 'Building open world…');
    await this.yield();
    this.world = buildWorld(this.worldScene, this.renderer);
    this.world.setTimeOfDay(this.settings.timeOfDay);
    this.world.setWeather(this.settings.weather);
    this.bootProgress(0.52, 'World ready');

    // car
    await this.yield();
    this.bootProgress(0.60, 'Assembling Roadster…');
    this.car = buildRoadster(this.settings.paint, this.settings.wheelColor);
    this.applyCarSettings();
    this.worldScene.add(this.car.group);
    this.headL = this.makeHeadlight(this.car.headlightL);
    this.headR = this.makeHeadlight(this.car.headlightR);

    // garage
    await this.yield();
    this.bootProgress(0.70, 'Preparing garage…');
    this.garageCam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    this.garage = new Garage(this.renderer, this.settings, this.garageCam);

    // particles
    this.skid = new SkidMarks(this.worldScene);
    this.smoke = new SpritePool(this.worldScene, 420, 0x9aa0a8, 1.6, 34);
    this.sparks = new SpritePool(this.worldScene, 160, 0xffa030, -9, 12);
    this.rain = new RainSystem(this.worldScene);
    this.rain.setActive(this.settings.weather === 'rain');

    // hud + modes
    await this.yield();
    this.bootProgress(0.84, 'Wiring HUD…');
    this.hud = new Hud(this.settings, this.world.mapSamples,
      (x, z) => [((x + 1300) / 2600) * 176, ((z + 1300) / 2600) * 176]);
    this.modes = new ModeManager(() => ({
      world: this.world,
      physics: this.physics,
      onBanner: (t, s, ms) => this.hud.showBanner(t, s, ms),
      onToast: (m) => this.hud.toast(m),
      onFinish: (t, lines, m) => this.onModeFinish(t, lines, m),
      onCheckpointSound: () => this.audio.checkpoint(),
      resetCarToStart: () => this.resetCarToStart(),
      teleportTo: (x, z, yaw) => this.teleport(x, z, yaw),
    }));

    this.input.buildTouchControls();
    this.bindKeys();
    this.bindPhotoDrag();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'drive') this.pause();
    });

    this.applyQuality(this.settings.quality, true);
    this.resetCarToStart();
    this.rig.setMode(this.settings.defaultCamera);

    this.bootProgress(1, 'Ready');
    this.ui.setLoading(1, 'Ready');
    this.state = 'menu';
    this.ui.showMenu();
    this.garage.setInteractive(true);
    this.lastT = performance.now();
    (window as unknown as { __game?: Game }).__game = this; // debug/testing hook
    requestAnimationFrame(this.loop);
  }

  private yield(): Promise<void> {
    return new Promise(r => setTimeout(r, 0));
  }

  private bootProgress(p: number, t: string): void {
    const bar = document.getElementById('load-bar');
    const txt = document.getElementById('load-text');
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    if (txt) txt.textContent = t;
  }

  private makeHeadlight(anchor: THREE.Object3D): THREE.SpotLight {
    const s = new THREE.SpotLight(0xcfe4ff, 0, 130, 0.36, 0.6, 1.6);
    s.position.set(0, 0, 0.2);
    const tgt = new THREE.Object3D();
    tgt.position.set(0, -1.2, 40);
    anchor.add(tgt);
    s.target = tgt;
    anchor.add(s);
    return s;
  }

  // ---------------- UI callbacks ----------------
  private callbacks() {
    return {
      onDrive: (mode: GameModeId) => this.startDrive(mode),
      onOpenGarage: () => this.openGarage(),
      onQuitToMenu: () => this.quitToMenu(),
      onResume: () => this.resume(),
      onRestartMode: () => this.restartMode(),
      onPhotoCapture: () => this.capturePhoto(),
      onPhotoExit: () => this.exitPhoto(),
      onSettingsChanged: () => this.onSettingsChanged(),
      onWorldChanged: () => this.onWorldChanged(),
      onGarageView: (v: 'front' | 'side' | 'rear' | 'top') => this.garage.presetView(v),
      onGarageSpin: (v: boolean) => this.garage.setTurntable(v),
      playClick: () => this.audio.click(),
    };
  }

  private onSettingsChanged(): void {
    saveSettings(this.settings);
    this.applyCarSettings();
    this.garage.applySettings();
    this.applyQuality(this.settings.quality, true);
    this.audio.setMuted(!this.settings.sound);
    this.audio.init();
    this.rig.setMode(this.settings.defaultCamera);
  }

  private onWorldChanged(): void {
    saveSettings(this.settings);
    this.world.setTimeOfDay(this.settings.timeOfDay);
    this.world.setWeather(this.settings.weather);
    this.rain.setActive(this.settings.weather === 'rain');
    this.updateHeadlights();
  }

  private applyCarSettings(): void {
    if (!this.car) return;
    this.car.setPaint(this.settings.paint);
    this.car.setFinish(this.settings.finish);
    this.car.setWheelColor(this.settings.wheelColor);
    this.updateHeadlights();
  }

  private lightsOn(): boolean {
    return this.settings.headlights || this.settings.timeOfDay === 'night';
  }

  private updateHeadlights(): void {
    if (!this.car) return;
    const on = this.lightsOn();
    this.car.drlMat.emissiveIntensity = on ? 2.2 : 1.6;
    if (this.headL) { this.headL.intensity = on ? 130 : 0; this.headR.intensity = on ? 130 : 0; }
  }

  // ---------------- state transitions ----------------
  private startDrive(mode: GameModeId): void {
    this.audio.init();
    this.currentMode = mode;
    this.photoMode = mode === 'photo';
    this.ui.hideComplete();
    this.garage.setInteractive(false);
    this.input.showTouch(true);
    if (mode === 'photo') {
      this.modes.start('photo');
      this.state = 'drive';
      this.ui.showDrive();
      this.ui.showPhotoUi(true);
      this.hud.setVisible(false);
      this.rig.resetPhotoOrbit();
      this.hud.toast('Drag to orbit · wheel to zoom · P or ✕ to exit');
    } else if (mode === 'speed' || mode === 'drift') {
      this.modes.start(mode);
      this.state = 'drive';
      this.ui.showDrive();
      this.hud.setVisible(true);
      this.rig.setMode(this.settings.defaultCamera);
    } else {
      // cinematic intro orbit before handing over control
      this.resetCarToStart();
      this.introMode = this.settings.defaultCamera;
      this.rig.setMode(4);
      this.introT = 0;
      this.state = 'intro';
      this.ui.showDrive();
      this.hud.setVisible(true);
      this.hud.showBanner('TESLA ROADSTER — HYPERDRIVE', 'Press any drive key to skip intro', 3600);
    }
    this.updateHeadlights();
  }

  private endIntro(): void {
    this.modes.start(this.currentMode);
    this.rig.setMode(this.introMode);
    this.state = 'drive';
  }

  private openGarage(): void {
    this.audio.init();
    this.modes.stop();
    this.photoMode = false;
    this.ui.showPhotoUi(false);
    this.state = 'garage';
    this.ui.showGarage();
    this.garage.applySettings();
    this.garage.setInteractive(true);
    this.input.showTouch(false);
  }

  private quitToMenu(): void {
    this.modes.stop();
    this.photoMode = false;
    this.ui.showPhotoUi(false);
    this.ui.hideComplete();
    this.ui.hidePause();
    this.state = 'menu';
    this.ui.showMenu();
    this.garage.setInteractive(true);
    this.input.showTouch(false);
  }

  private pause(): void {
    if (this.state !== 'drive') return;
    this.state = 'paused';
    this.ui.showPause(MODE_NAMES[this.currentMode]);
    this.input.showTouch(false);
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'drive';
    this.ui.hidePause();
    this.input.showTouch(true);
    this.lastT = performance.now();
  }

  private restartMode(): void {
    this.ui.hideComplete();
    this.ui.hidePause();
    this.state = 'drive';
    this.photoMode = false;
    this.ui.showPhotoUi(false);
    this.hud.setVisible(true);
    this.modes.start(this.currentMode);
    this.rig.setMode(this.settings.defaultCamera);
    this.input.showTouch(true);
  }

  private onModeFinish(title: string, lines: string[], _mode: GameModeId): void {
    this.state = 'complete';
    this.ui.showComplete(title, lines);
    this.input.showTouch(false);
  }

  private exitPhoto(): void {
    this.ui.showPhotoUi(false);
    this.hud.setVisible(true);
    this.photoMode = false;
    this.modes.start('freeroam');
    this.currentMode = 'freeroam';
    this.rig.setMode(this.settings.defaultCamera);
  }

  private capturePhoto(): void {
    this.renderWorld();
    const url = this.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `roadster-hyperdrive-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.hud.toast('Screenshot saved');
  }

  // ---------------- car placement ----------------
  private resetCarToStart(): void {
    const s = this.world.startPose;
    this.teleport(s.x, s.z, s.yaw);
  }

  private teleport(x: number, z: number, yaw: number): void {
    const surf = this.world.getSurface(x, z);
    this.physics.reset(x, surf.groundY, z, yaw);
    this.skid.reset();
    this.rig.snap(this.physics.pos, yaw);
    this.syncCarVisual(0);
    this.initWheelPrev();
  }

  private resetCar(): void {
    const nr = this.world.nearestRoad(this.physics.pos.x, this.physics.pos.z);
    const yaw = Math.atan2(nr.tx, nr.tz);
    this.teleport(this.physics.pos.x, this.physics.pos.z, yaw);
    // nudge onto road if far
    if (nr.dist > 20) this.resetCarToStart();
    this.hud.toast('Car reset');
  }

  // ---------------- input ----------------
  private bindKeys(): void {
    this.input.onKey = (code) => {
      if (this.state === 'intro') {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
          this.endIntro();
        }
        return;
      }
      if (this.state !== 'drive') {
        if (code === 'Escape' && this.state === 'paused') this.resume();
        return;
      }
      switch (code) {
        case 'KeyC': this.rig.setMode(this.rig.mode + 1); this.hud.toast('Camera: ' + CAMERA_NAMES[this.rig.mode]); break;
        case 'KeyR': this.resetCar(); break;
        case 'KeyL':
          this.settings.headlights = !this.settings.headlights;
          saveSettings(this.settings);
          this.updateHeadlights();
          this.hud.toast(this.lightsOn() ? 'Headlights on' : 'Headlights off');
          break;
        case 'KeyM':
          this.settings.sound = !this.settings.sound;
          saveSettings(this.settings);
          this.audio.setMuted(!this.settings.sound);
          this.hud.toast(this.settings.sound ? 'Sound on' : 'Muted');
          break;
        case 'KeyP':
          if (this.photoMode) this.exitPhoto();
          else this.startDrive('photo');
          break;
        case 'Escape':
          if (this.photoMode) this.exitPhoto(); else this.pause();
          break;
      }
    };
  }

  private bindPhotoDrag(): void {
    const cv = this.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.photoMode || this.state !== 'drive') return;
      this.dragging = true; this.lastPX = e.clientX; this.lastPY = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.photoMode) return;
      const dx = e.clientX - this.lastPX, dy = e.clientY - this.lastPY;
      this.lastPX = e.clientX; this.lastPY = e.clientY;
      this.rig.orbitControl(dx * 0.008, dy * 0.006, 0);
    });
    cv.addEventListener('pointerup', () => { this.dragging = false; });
    cv.addEventListener('wheel', (e) => {
      if (!this.photoMode || this.state !== 'drive') return;
      e.preventDefault();
      this.rig.orbitControl(0, 0, e.deltaY * 0.01);
    }, { passive: false });
  }

  // ---------------- quality ----------------
  private applyQuality(q: QualityPreset, force: boolean): void {
    if (!force && q === this.effQuality) return;
    this.effQuality = q;
    const dpr = window.devicePixelRatio || 1;
    const pr = q === 'low' ? 0.75 : q === 'medium' ? 1 : q === 'high' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(pr);
    this.world.applyQuality(q);
    const useComposer = q !== 'low';
    if (useComposer && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.worldScene, this.rig.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.55, 0.82);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    if (this.bloom) {
      this.bloom.strength = q === 'medium' ? 0.22 : q === 'high' ? 0.35 : 0.45;
      this.bloom.enabled = useComposer;
    }
    this.onResize();
  }

  private autoQualityTick(dt: number): void {
    if (!this.settings.autoQuality || this.state !== 'drive') return;
    this.qTimer += dt;
    if (this.qTimer < 4) return;
    this.qTimer = 0;
    const order: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(this.effQuality);
    if (this.fpsEma < 42 && i > 0) this.applyQuality(order[i - 1], true);
    else if (this.fpsEma > 57 && i < order.indexOf(this.settings.quality)) this.applyQuality(order[i + 1], true);
  }

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.onResize();
    this.garageCam.aspect = w / h;
    this.garageCam.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  // ---------------- main loop ----------------
  private loop = (t: number): void => {
    requestAnimationFrame(this.loop);
    const rawDt = (t - this.lastT) / 1000;
    this.lastT = t;
    // clamped dt for physics stability; rawDt (capped) for wall-clock timers
    const dt = !(rawDt > 0) || rawDt > 0.1 ? 0.016 : rawDt;
    const wallDt = Math.min(Math.max(rawDt, 0), 0.5);
    if (!(rawDt > 0)) return;
    this.fpsEma += ((1 / Math.max(rawDt, 1e-4)) - this.fpsEma) * 0.04;
    this.tick(dt, wallDt);
  };

  private tick(dt: number, wallDt: number): void {
    if (this.state === 'menu' || this.state === 'garage') {
      this.garage.update(dt);
      this.renderer.render(this.garage.scene, this.garageCam);
      return;
    }
    if (this.state === 'paused' || this.state === 'complete') {
      this.renderWorld();
      this.audio.update(0, 0, 0, false);
      return;
    }

    const driving = this.state === 'drive' && !this.photoMode;
    const phys = this.physics;

    // --- input + physics ---
    if (this.state === 'intro') {
      this.introT += wallDt;
      if (this.introT > 4.2) this.endIntro();
    } else if (driving) {
      const inp = this.input.sample(dt);
      inp.boost = inp.boost || this.input.keys.has('KeyN');
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 8) {
        const surf = this.world.getSurface(phys.pos.x, phys.pos.z);
        phys.step(PHYS_DT, inp, surf);
        // collisions
        const cols = this.world.queryColliders(phys.pos.x, phys.pos.z);
        for (const c of cols) phys.collideCircle(c.x, c.z, c.r);
        if (phys.collision) {
          this.audio.collision(phys.collision.hard);
          this.rig.addShake(phys.collision.hard ? 0.9 : 0.35);
          this.modes.onCollision();
          const p = phys.pos;
          for (let k = 0; k < 10; k++) {
            this.sparks.spawn(p.x, p.y + 0.5, p.z, (Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8, 0.5, 10);
          }
        }
        phys.updateEnergy(PHYS_DT, inp);
        this.acc -= PHYS_DT;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      this.distanceKm += phys.vel.length() * dt / 1000;

      // skid marks + smoke
      const marking = phys.drifting || (inp.handbrake && phys.speedKmh > 12) ||
        (inp.throttle > 0.85 && phys.speedKmh < 25 && this.world.getSurface(phys.pos.x, phys.pos.z).onRoad);
      this.updateWheelTracks(marking);
      if (phys.drifting || (inp.throttle > 0.85 && phys.speedKmh < 30)) {
        for (const sx of [-1, 1]) {
          const w = this.wheelWorld(-0.8 * sx, -1.325);
          this.smoke.spawn(w.x, 0.25, w.z, (Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2, 1.1, 30);
        }
      }
      // audio
      this.audio.update(
        Math.min(1, phys.speedKmh / 320),
        inp.throttle, phys.slip, phys.boostActive,
      );
      this.modes.update(dt);
    } else if (this.photoMode) {
      this.audio.update(0, 0, 0, false);
    }

    // --- visuals ---
    this.syncCarVisual(dt);
    this.skid.update();
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.rain.update(dt, phys.pos.x, phys.pos.z);
    this.world.update(dt, phys.pos);
    this.rig.update(dt, phys.pos, phys.yaw, phys.speedKmh, this.photoMode);
    this.updateHud();
    this.autoQualityTick(dt);
    this.renderWorld();
  }

  private wheelWorld(lx: number, lz: number): THREE.Vector3 {
    const s = Math.sin(this.physics.yaw), c = Math.cos(this.physics.yaw);
    return new THREE.Vector3(
      this.physics.pos.x + lx * c + lz * s,
      this.physics.pos.y,
      this.physics.pos.z - lx * s + lz * c,
    );
  }

  private initWheelPrev(): void {
    this.wheelPrevL.copy(this.wheelWorld(-0.8, -1.325));
    this.wheelPrevR.copy(this.wheelWorld(0.8, -1.325));
  }

  private updateWheelTracks(marking: boolean): void {
    const curL = this.wheelWorld(-0.8, -1.325);
    const curR = this.wheelWorld(0.8, -1.325);
    if (marking) {
      const s = Math.sin(this.physics.yaw), c = Math.cos(this.physics.yaw);
      this.skid.addWheel(this.wheelPrevL, curL, 0.13, s, c);
      this.skid.addWheel(this.wheelPrevR, curR, 0.13, s, c);
    }
    this.wheelPrevL.copy(curL);
    this.wheelPrevR.copy(curR);
  }

  private syncCarVisual(dt: number): void {
    const phys = this.physics;
    this.car.group.position.copy(phys.pos);
    this.car.group.rotation.y = phys.yaw;
    // body roll / pitch
    const accel = dt > 0 ? (phys.vForward - this.prevVF) / dt : 0;
    this.prevVF = phys.vForward;
    this.accelSm += (THREE.MathUtils.clamp(accel, -20, 20) - this.accelSm) * Math.min(1, 6 * dt);
    const rollT = THREE.MathUtils.clamp(-phys.vLateral * 0.016 - phys.steerVis * Math.min(1, Math.abs(phys.vForward) / 30) * 0.05, -0.085, 0.085);
    const pitchT = THREE.MathUtils.clamp(-this.accelSm * 0.0022, -0.045, 0.05);
    this.car.chassis.rotation.z += (rollT - this.car.chassis.rotation.z) * Math.min(1, 8 * dt);
    this.car.chassis.rotation.x += (pitchT - this.car.chassis.rotation.x) * Math.min(1, 8 * dt);
    // wheels
    for (const w of this.car.wheels) {
      if (w.front) w.pivot.rotation.y = phys.steerVis;
      w.spinner.rotation.x += (phys.vForward / 0.34) * dt;
    }
    this.car.steeringWheel.rotation.z = -phys.steerVis * 2.4;
    // lights
    const braking = this.input.keys.has('KeyS') || this.input.keys.has('ArrowDown');
    this.car.tailMat.emissiveIntensity = braking ? 4.2 : (this.lightsOn() ? 2.4 : 1.3);
  }

  private updateHud(): void {
    const phys = this.physics;
    const vF = phys.vForward;
    const gear = vF < -0.5 ? 'R' : vF > 0.5 ? 'D' : 'N';
    const braking = this.input.keys.has('KeyS') || this.input.keys.has('ArrowDown');
    this.hud.update({
      speedKmh: phys.speedKmh,
      gear,
      power01: braking ? -0.4 : Math.min(1, Math.abs(vF) / 60) * (this.input.keys.has('KeyW') || this.input.keys.has('ArrowUp') ? 1 : 0.25),
      battery: phys.energy,
      boost: phys.boostActive,
      drifting: phys.drifting,
      distanceKm: this.distanceKm,
      cameraMode: this.photoMode ? 4 : this.rig.mode,
      headlights: this.lightsOn(),
      timeOfDay: this.settings.timeOfDay,
      weather: this.settings.weather,
      muted: !this.settings.sound,
      timerText: this.modes.timerText,
      scoreText: this.modes.scoreText,
      bannerText: null,
      bannerSub: null,
      carX: phys.pos.x, carZ: phys.pos.z, carYaw: phys.yaw,
    });
  }

  private renderWorld(): void {
    if (this.composer && this.effQuality !== 'low') {
      this.composer.render();
    } else {
      this.renderer.render(this.worldScene, this.rig.camera);
    }
  }
}
