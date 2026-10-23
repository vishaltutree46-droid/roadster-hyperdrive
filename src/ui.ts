// DOM menus, garage panel, settings, pause, completion screens.

import { PAINTS, WHEEL_COLORS, CONTROLS_HELP, formatTime, getBest, type Settings, type GameModeId, type QualityPreset, type TimeOfDay, type Weather } from './config';
import { driftBest } from './modes';

export interface UiCallbacks {
  onDrive(mode: GameModeId): void;
  onOpenGarage(): void;
  onQuitToMenu(): void;
  onResume(): void;
  onRestartMode(): void;
  onPhotoCapture(): void;
  onPhotoExit(): void;
  onSettingsChanged(): void;
  onWorldChanged(): void;
  onGarageView(view: 'front' | 'side' | 'rear' | 'top'): void;
  onGarageSpin(v: boolean): void;
  playClick(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error('missing ui element: ' + id);
  return e as T;
}
function show(id: string): void { el(id).classList.add('visible'); }
export function hide(id: string): void { el(id).classList.remove('visible'); }
function hideAllScreens(): void {
  ['screen-menu', 'screen-garage', 'screen-pause', 'screen-complete', 'photo-ui'].forEach(hide);
  const hud = el('hud');
  hud.classList.remove('visible');
  hud.style.display = 'none';
}

export class UiManager {
  constructor(private settings: Settings, private cb: UiCallbacks) {}

  init(): void {
    const s = this.settings, cb = this.cb;
    const click = () => cb.playClick();

    // --- main menu ---
    el('btn-drive').addEventListener('click', () => { click(); cb.onDrive('freeroam'); });
    el('btn-modes').addEventListener('click', () => { click(); show('panel-modes'); });
    el('btn-modes-back').addEventListener('click', () => { click(); hide('panel-modes'); });
    el('btn-garage').addEventListener('click', () => { click(); cb.onOpenGarage(); });
    el('btn-settings').addEventListener('click', () => { click(); this.syncSettingsPanel(); show('panel-settings'); });
    el('btn-settings-back').addEventListener('click', () => { click(); hide('panel-settings'); });
    el('btn-about').addEventListener('click', () => { click(); show('panel-about'); });
    el('btn-about-back').addEventListener('click', () => { click(); hide('panel-about'); });

    document.querySelectorAll<HTMLButtonElement>('#panel-modes [data-mode]').forEach(b => {
      b.addEventListener('click', () => { click(); hide('panel-modes'); cb.onDrive(b.dataset.mode as GameModeId); });
    });

    // world chips
    document.querySelectorAll<HTMLButtonElement>('#tod-chips [data-tod]').forEach(b => {
      b.addEventListener('click', () => {
        click();
        s.timeOfDay = b.dataset.tod as TimeOfDay;
        this.syncChips(); cb.onWorldChanged();
      });
    });
    document.querySelectorAll<HTMLButtonElement>('#weather-chips [data-wx]').forEach(b => {
      b.addEventListener('click', () => {
        click();
        s.weather = b.dataset.wx as Weather;
        this.syncChips(); cb.onWorldChanged();
      });
    });

    // --- settings ---
    el('set-quality').addEventListener('change', (e) => {
      s.quality = (e.target as HTMLSelectElement).value as QualityPreset;
      cb.onSettingsChanged();
    });
    el('set-autoq').addEventListener('change', (e) => {
      s.autoQuality = (e.target as HTMLInputElement).checked;
      cb.onSettingsChanged();
    });
    el('set-units').addEventListener('change', (e) => {
      s.units = (e.target as HTMLSelectElement).value as 'kmh' | 'mph';
      cb.onSettingsChanged();
    });
    el('set-sound').addEventListener('change', (e) => {
      s.sound = (e.target as HTMLInputElement).checked;
      cb.onSettingsChanged();
    });
    el('set-camera').addEventListener('change', (e) => {
      s.defaultCamera = parseInt((e.target as HTMLSelectElement).value, 10);
      cb.onSettingsChanged();
    });

    // --- garage ---
    this.buildSwatches();
    document.querySelectorAll<HTMLButtonElement>('#garage-ui [data-finish]').forEach(b => {
      b.addEventListener('click', () => {
        click();
        s.finish = b.dataset.finish as Settings['finish'];
        this.syncGarage(); cb.onSettingsChanged();
      });
    });
    document.querySelectorAll<HTMLButtonElement>('#garage-ui [data-view]').forEach(b => {
      b.addEventListener('click', () => { click(); cb.onGarageView(b.dataset.view as 'front' | 'side' | 'rear' | 'top'); });
    });
    el('garage-lights').addEventListener('click', () => {
      click();
      s.headlights = !s.headlights;
      this.syncGarage(); cb.onSettingsChanged();
    });
    el('garage-spin').addEventListener('click', () => {
      click();
      const b = el('garage-spin');
      const on = b.dataset.on !== '1';
      b.dataset.on = on ? '1' : '0';
      b.classList.toggle('active', on);
      cb.onGarageSpin(on);
    });
    el('btn-garage-drive').addEventListener('click', () => { click(); cb.onDrive('freeroam'); });
    el('btn-garage-menu').addEventListener('click', () => { click(); cb.onQuitToMenu(); });

    // --- pause ---
    el('btn-resume').addEventListener('click', () => { click(); cb.onResume(); });
    el('btn-restart').addEventListener('click', () => { click(); cb.onRestartMode(); });
    el('btn-pause-garage').addEventListener('click', () => { click(); cb.onOpenGarage(); });
    el('btn-quit-menu').addEventListener('click', () => { click(); cb.onQuitToMenu(); });

    // --- complete ---
    el('btn-complete-retry').addEventListener('click', () => { click(); cb.onRestartMode(); });
    el('btn-complete-menu').addEventListener('click', () => { click(); cb.onQuitToMenu(); });

    // --- photo ---
    el('btn-photo-capture').addEventListener('click', () => { click(); cb.onPhotoCapture(); });
    el('btn-photo-exit').addEventListener('click', () => { click(); cb.onPhotoExit(); });

    // controls help
    el('controls-list').innerHTML = CONTROLS_HELP.map(([k, v]) =>
      `<div class="ctl"><span class="key">${k}</span><span>${v}</span></div>`).join('');

    this.syncChips();
    this.syncGarage();
  }

  private buildSwatches(): void {
    const s = this.settings, cb = this.cb;
    const pw = el('paint-swatches');
    pw.innerHTML = '';
    PAINTS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = p.color;
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.addEventListener('click', () => {
        cb.playClick();
        s.paint = p.color; s.paintName = p.name;
        this.syncGarage(); cb.onSettingsChanged();
      });
      pw.appendChild(b);
    });
    const ww = el('wheel-swatches');
    ww.innerHTML = '';
    WHEEL_COLORS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = p.color;
      b.title = p.name;
      b.setAttribute('aria-label', 'Wheel ' + p.name);
      b.addEventListener('click', () => {
        cb.playClick();
        s.wheelColor = p.color;
        this.syncGarage(); cb.onSettingsChanged();
      });
      ww.appendChild(b);
    });
  }

  syncChips(): void {
    const s = this.settings;
    document.querySelectorAll<HTMLButtonElement>('#tod-chips [data-tod]').forEach(b =>
      b.classList.toggle('active', b.dataset.tod === s.timeOfDay));
    document.querySelectorAll<HTMLButtonElement>('#weather-chips [data-wx]').forEach(b =>
      b.classList.toggle('active', b.dataset.wx === s.weather));
  }

  syncGarage(): void {
    const s = this.settings;
    document.querySelectorAll<HTMLButtonElement>('#paint-swatches .swatch').forEach((b, i) =>
      b.classList.toggle('active', PAINTS[i].color.toLowerCase() === s.paint.toLowerCase()));
    document.querySelectorAll<HTMLButtonElement>('#wheel-swatches .swatch').forEach((b, i) =>
      b.classList.toggle('active', WHEEL_COLORS[i].color.toLowerCase() === s.wheelColor.toLowerCase()));
    document.querySelectorAll<HTMLButtonElement>('#garage-ui [data-finish]').forEach(b =>
      b.classList.toggle('active', b.dataset.finish === s.finish));
    el('garage-lights').classList.toggle('active', s.headlights);
    el('garage-paint-name').textContent = `${s.paintName} · ${s.finish}`;
  }

  syncSettingsPanel(): void {
    const s = this.settings;
    (el('set-quality') as HTMLSelectElement).value = s.quality;
    (el('set-autoq') as HTMLInputElement).checked = s.autoQuality;
    (el('set-units') as HTMLSelectElement).value = s.units;
    (el('set-sound') as HTMLInputElement).checked = s.sound;
    (el('set-camera') as HTMLSelectElement).value = String(s.defaultCamera);
    el('best-lap').textContent = getBest('lap') ? formatTime(getBest('lap')) : '—';
    el('best-race').textContent = getBest('race') ? formatTime(getBest('race')) : '—';
    el('best-drift').textContent = driftBest() ? Math.round(driftBest()) + ' pts' : '—';
  }

  showMenu(): void {
    hideAllScreens();
    show('screen-menu');
    this.syncChips();
  }

  showGarage(): void {
    hideAllScreens();
    show('screen-garage');
    this.syncGarage();
  }

  showDrive(): void {
    hideAllScreens();
    const hud = el('hud');
    hud.classList.add('visible');
    hud.style.display = 'block';
  }

  showPause(modeName: string): void {
    el('pause-subtitle').textContent = modeName;
    show('screen-pause');
  }

  hidePause(): void { hide('screen-pause'); }

  showComplete(title: string, lines: string[]): void {
    el('complete-title').textContent = title;
    el('complete-lines').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
    show('screen-complete');
  }

  hideComplete(): void { hide('screen-complete'); }

  showPhotoUi(v: boolean): void {
    if (v) show('photo-ui'); else hide('photo-ui');
  }

  setLoading(pct: number, text: string): void {
    el('load-bar').style.width = `${Math.round(pct * 100)}%`;
    el('load-text').textContent = text;
    if (pct >= 1) {
      window.setTimeout(() => el('loading').classList.add('done'), 350);
    }
  }
}
