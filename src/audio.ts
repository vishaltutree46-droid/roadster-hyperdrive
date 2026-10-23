// Procedural audio: synthesized EV motor whine, wind, tire skid, impacts, UI.
// All sounds are synthesized in code — not recordings of any real vehicle.

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motorOsc1: OscillatorNode | null = null;
  private motorOsc2: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private motorFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  private started = false;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  init(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return; // audio unsupported
    }
    const ctx = this.ctx;
    this.started = true;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // shared noise buffer (2s white noise)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // --- motor whine: two detuned saws through a lowpass ---
    this.motorOsc1 = ctx.createOscillator();
    this.motorOsc1.type = 'sawtooth';
    this.motorOsc2 = ctx.createOscillator();
    this.motorOsc2.type = 'sawtooth';
    this.motorOsc2.detune.value = 8;
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 900;
    this.motorFilter.Q.value = 2;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorOsc1.connect(this.motorFilter);
    this.motorOsc2.connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain);
    this.motorGain.connect(this.master);
    this.motorOsc1.start();
    this.motorOsc2.start();

    // --- wind: looped noise through bandpass ---
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuf;
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    windSrc.start();

    // --- tire skid: looped noise through highpass ---
    const skidSrc = ctx.createBufferSource();
    skidSrc.buffer = this.noiseBuf;
    skidSrc.loop = true;
    skidSrc.playbackRate.value = 0.7;
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'highpass';
    skidFilter.frequency.value = 2400;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skidSrc.connect(skidFilter);
    skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    skidSrc.start();
  }

  /** speed01: 0..1 of top speed, throttle 0..1, slip 0..1, boost on/off */
  update(speed01: number, throttle: number, slip: number, boost: boolean): void {
    if (!this.ctx || !this.started || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const rpm = 55 + speed01 * 420 + throttle * 60 + (boost ? 120 : 0);
    this.motorOsc1?.frequency.setTargetAtTime(rpm, t, 0.05);
    this.motorOsc2?.frequency.setTargetAtTime(rpm * 1.5, t, 0.05);
    this.motorFilter?.frequency.setTargetAtTime(700 + speed01 * 2600, t, 0.1);
    this.motorGain?.gain.setTargetAtTime(0.015 + throttle * 0.05 + speed01 * 0.02, t, 0.08);
    this.windGain?.gain.setTargetAtTime(Math.pow(speed01, 2.2) * 0.35, t, 0.2);
    this.skidGain?.gain.setTargetAtTime(Math.min(1, slip) * 0.16, t, 0.06);
  }

  collision(hard: boolean): void {
    if (!this.ctx || !this.started || !this.noiseBuf || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = hard ? 500 : 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(hard ? 0.5 : 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.2, 0.4);
  }

  click(): void {
    if (!this.ctx || !this.started || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.09);
  }

  checkpoint(): void {
    if (!this.ctx || !this.started || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [523, 784].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const g = ctx.createGain();
      const st = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.18, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.25);
      o.connect(g); g.connect(this.master!);
      o.start(st); o.stop(st + 0.3);
    });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }
}
