// Central configuration, types and persisted settings.

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type Finish = 'gloss' | 'metallic' | 'matte';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export type Weather = 'clear' | 'rain' | 'fog';
export type GameModeId = 'freeroam' | 'timetrial' | 'speed' | 'drift' | 'race' | 'photo';

export interface Settings {
  quality: QualityPreset;
  autoQuality: boolean;
  units: 'kmh' | 'mph';
  sound: boolean;
  defaultCamera: number;
  paint: string;      // hex
  paintName: string;
  finish: Finish;
  wheelColor: string; // hex
  headlights: boolean; // manual override (auto at night otherwise)
  timeOfDay: TimeOfDay;
  weather: Weather;
}

export const PAINTS: { name: string; color: string }[] = [
  { name: 'Crimson', color: '#a4121e' },
  { name: 'Midnight', color: '#0d1117' },
  { name: 'Pearl White', color: '#e8e9eb' },
  { name: 'Electric Blue', color: '#0f4fd8' },
  { name: 'Stealth Grey', color: '#5a5f66' },
  { name: 'Sunset Orange', color: '#d8541e' },
  { name: 'Racing Green', color: '#0e4d2e' },
  { name: 'Silver', color: '#b9bdc4' },
];

export const WHEEL_COLORS: { name: string; color: string }[] = [
  { name: 'Graphite', color: '#2a2d31' },
  { name: 'Silver', color: '#b9bdc4' },
  { name: 'Black', color: '#101114' },
  { name: 'Bronze', color: '#8a5a2b' },
];

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  autoQuality: true,
  units: 'kmh',
  sound: true,
  defaultCamera: 0,
  paint: '#a4121e',
  paintName: 'Crimson',
  finish: 'gloss',
  wheelColor: '#2a2d31',
  headlights: false,
  timeOfDay: 'day',
  weather: 'clear',
};

const KEY = 'roadster-hyperdrive-settings-v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* storage unavailable */ }
}

export function getBest(key: string): number {
  try {
    const v = localStorage.getItem('roadster-hyperdrive-best-' + key);
    return v ? parseFloat(v) : 0;
  } catch { return 0; }
}

export function setBest(key: string, value: number): void {
  try {
    const prev = getBest(key);
    if (!prev || value < prev) localStorage.setItem('roadster-hyperdrive-best-' + key, String(value));
  } catch { /* ignore */ }
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const c = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export const CONTROLS_HELP: [string, string][] = [
  ['W / ↑', 'Accelerate'],
  ['S / ↓', 'Brake / Reverse'],
  ['A D / ← →', 'Steer'],
  ['Space', 'Handbrake'],
  ['C', 'Change camera'],
  ['R', 'Reset car'],
  ['N', 'Boost (arcade, fictional)'],
  ['L', 'Headlights'],
  ['M', 'Mute'],
  ['Esc', 'Pause'],
];
