// In-game HUD: speed cluster, gear, power/battery bars, minimap, banners.

import type { Settings, TimeOfDay, Weather } from './config';
import { CAMERA_NAMES } from './cameras';

export interface HudState {
  speedKmh: number;
  gear: 'P' | 'R' | 'N' | 'D';
  power01: number;   // motor power draw
  battery: number;   // 0..100
  boost: boolean;
  drifting: boolean;
  distanceKm: number;
  cameraMode: number;
  headlights: boolean;
  timeOfDay: TimeOfDay;
  weather: Weather;
  muted: boolean;
  timerText: string | null;
  scoreText: string | null;
  bannerText: string | null;
  bannerSub: string | null;
  carX: number; carZ: number; carYaw: number;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('missing hud element: ' + id);
  return e as T;
}

export class Hud {
  private speedEl = el('hud-speed');
  private unitEl = el('hud-unit');
  private gearEl = el('hud-gear');
  private powerEl = el('hud-power-fill');
  private battEl = el('hud-batt-fill');
  private battLabel = el('hud-batt-label');
  private driftEl = el('hud-drift');
  private distEl = el('hud-dist');
  private camEl = el('hud-camera');
  private lightEl = el('hud-lights');
  private clockEl = el('hud-clock');
  private muteEl = el('hud-mute');
  private timerEl = el('hud-timer');
  private scoreEl = el('hud-score');
  private bannerEl = el('hud-banner');
  private bannerTitle = el('hud-banner-title');
  private bannerSub = el('hud-banner-sub');
  private boostEl = el('hud-boost');
  private map: HTMLCanvasElement = el('hud-map');
  private mapCtx: CanvasRenderingContext2D;
  private staticMap: HTMLCanvasElement | null = null;
  private bannerTimeout = 0;

  constructor(
    private settings: Settings,
    roadSamples: { x: number; z: number }[],
    private worldToMap: (x: number, z: number) => [number, number],
  ) {
    this.mapCtx = this.map.getContext('2d')!;
    this.buildStaticMap(roadSamples);
  }

  private buildStaticMap(roadSamples: { x: number; z: number }[]): void {
    const c = document.createElement('canvas');
    c.width = c.height = 176;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(8,12,18,0.72)';
    g.beginPath(); g.arc(88, 88, 86, 0, Math.PI * 2); g.fill();
    // water hint (ocean at +z)
    g.fillStyle = 'rgba(30,90,140,0.5)';
    g.fillRect(0, 128, 176, 48);
    // road loop
    g.strokeStyle = '#e8e8e8';
    g.lineWidth = 3;
    g.beginPath();
    roadSamples.forEach((p, i) => {
      const [mx, my] = this.worldToMap(p.x, p.z);
      if (i === 0) g.moveTo(mx, my); else g.lineTo(mx, my);
    });
    g.closePath();
    g.stroke();
    g.strokeStyle = '#37e0ff';
    g.lineWidth = 1;
    g.stroke();
    this.staticMap = c;
  }

  showBanner(title: string, sub: string | null, ms = 2600): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub || '';
    this.bannerEl.classList.add('visible');
    window.clearTimeout(this.bannerTimeout);
    this.bannerTimeout = window.setTimeout(() => this.bannerEl.classList.remove('visible'), ms);
  }

  toast(msg: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    el('toasts').appendChild(t);
    window.setTimeout(() => t.classList.add('show'), 20);
    window.setTimeout(() => { t.classList.remove('show'); window.setTimeout(() => t.remove(), 400); }, 2600);
  }

  update(s: HudState): void {
    const kmh = s.speedKmh;
    const shown = this.settings.units === 'mph' ? Math.round(kmh * 0.621371) : Math.round(kmh);
    this.speedEl.textContent = String(shown);
    this.unitEl.textContent = this.settings.units === 'mph' ? 'mph' : 'km/h';
    this.gearEl.textContent = s.gear;
    this.gearEl.className = 'gear g-' + s.gear;
    this.powerEl.style.width = `${Math.round(s.power01 * 100)}%`;
    this.powerEl.classList.toggle('regen', s.power01 < 0);
    this.battEl.style.width = `${Math.round(s.battery)}%`;
    this.battEl.classList.toggle('low', s.battery < 20);
    this.battLabel.textContent = `${Math.round(s.battery)}%`;
    this.driftEl.classList.toggle('on', s.drifting);
    this.distEl.textContent = s.distanceKm.toFixed(1) + ' km';
    this.camEl.textContent = CAMERA_NAMES[s.cameraMode] || '';
    this.lightEl.classList.toggle('on', s.headlights);
    this.clockEl.textContent = `${s.timeOfDay === 'day' ? '☀' : s.timeOfDay === 'sunset' ? '🌇' : '🌙'} ${s.weather === 'rain' ? '🌧' : s.weather === 'fog' ? '🌫' : ''}`;
    this.muteEl.textContent = s.muted ? '🔇' : '🔊';
    this.timerEl.textContent = s.timerText || '';
    this.timerEl.style.display = s.timerText ? 'block' : 'none';
    this.scoreEl.textContent = s.scoreText || '';
    this.scoreEl.style.display = s.scoreText ? 'block' : 'none';
    this.boostEl.classList.toggle('on', s.boost);
    this.drawMap(s);
  }

  private drawMap(s: HudState): void {
    const g = this.mapCtx;
    g.clearRect(0, 0, 176, 176);
    if (this.staticMap) g.drawImage(this.staticMap, 0, 0);
    const [mx, my] = this.worldToMap(s.carX, s.carZ);
    // map: world +x → right, world +z → down. Forward (sin yaw, cos yaw)
    // becomes canvas vector (fx, fz); angle measured clockwise from up:
    const fx = Math.sin(s.carYaw), fz = Math.cos(s.carYaw);
    const ang = Math.atan2(fx, -fz);
    g.save();
    g.translate(mx, my);
    g.rotate(ang);
    g.fillStyle = '#37e0ff';
    g.strokeStyle = '#06222b';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  setVisible(v: boolean): void {
    el('hud').style.display = v ? 'block' : 'none';
  }
}
