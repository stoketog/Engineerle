/**
 * Sound effects, synthesised with the Web Audio API so there is nothing to download.
 * Short, bright and quiet by default; a rarer answer sounds richer. Nothing plays until
 * the player has touched the page (browsers keep audio locked until then), and nothing
 * plays at all when the volume is 0 or sound is muted.
 */

export type SfxName =
  | 'tap' | 'toggle' | 'open' | 'close' | 'start' | 'tick' | 'tickUrgent' | 'hit' | 'miss' | 'repeat' | 'timeup' | 'skip' | 'ascent' | 'finish'
  | 'scribble' | 'correct' | 'wrong' | 'solved' | 'failed' | 'creak' | 'crack' | 'clunk' | 'snap' | 'whoosh' | 'rumble' | 'splash' | 'pencil';

interface ToneOpts {
  f: number;
  /** Frequency the note glides to. */
  to?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
  at?: number;
  attack?: number;
  /** Send level to the echo. */
  echo?: number;
  lp?: number;
}
interface NoiseOpts {
  dur?: number;
  at?: number;
  gain?: number;
  type?: BiquadFilterType;
  f?: number;
  to?: number;
  q?: number;
  attack?: number;
  echo?: number;
}

/** Pentatonic ladder used by the answer chimes (A major pentatonic, from A5). */
const LADDER = [880, 1108.73, 1318.51, 1661.22, 1760, 2217.46, 2637.02];

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private echoIn: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private volume = 0.7;
  private muted = false;
  private last = new Map<string, number>();

  get enabled() {
    return !this.muted && this.volume > 0.001;
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
  }
  setMuted(m: boolean) {
    this.muted = m;
    this.applyGain();
  }
  private applyGain() {
    if (!this.master || !this.ctx) return;
    const g = this.muted ? 0 : this.volume * this.volume * 0.9;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
  }

  /** Create (or wake) the audio context. Call from a user gesture. */
  unlock() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      const master = ctx.createGain();
      master.connect(comp);
      comp.connect(ctx.destination);
      // a short feedback echo gives the chimes a little air
      const echoIn = ctx.createGain();
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.13;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const damp = ctx.createBiquadFilter();
      damp.type = 'lowpass';
      damp.frequency.value = 3600;
      echoIn.connect(delay);
      delay.connect(damp);
      damp.connect(fb);
      fb.connect(delay);
      damp.connect(master);
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.echoIn = echoIn;
      this.noiseBuf = buf;
      this.applyGain();
      return ctx;
    } catch {
      return null;
    }
  }

  private tone(o: ToneOpts) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const dur = o.dur ?? 0.25;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master!);
    if (o.echo) {
      const send = ctx.createGain();
      send.gain.value = o.echo;
      g.connect(send);
      send.connect(this.echoIn!);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(o: NoiseOpts) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.at ?? 0);
    const dur = o.dur ?? 0.2;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.loopStart = Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.f ?? 2000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t0 + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    if (o.echo) {
      const send = ctx.createGain();
      send.gain.value = o.echo;
      g.connect(send);
      send.connect(this.echoIn!);
    }
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  /** A bell-like note: a sine with a quiet octave and a bright, quick attack. */
  private chime(f: number, at: number, gain = 0.26, dur = 0.55, echo = 0.35) {
    this.tone({ f, dur, gain, at, attack: 0.003, echo });
    this.tone({ f: f * 2, dur: dur * 0.5, gain: gain * 0.35, at, attack: 0.002, echo: echo * 0.5 });
    this.tone({ f: f * 3.01, dur: dur * 0.25, gain: gain * 0.12, at, attack: 0.002 });
  }

  /* ── the engine loop (Engineerle): a firing-order buzz whose pitch follows `level` and whose wobble follows `rough` ── */
  private eng: { o1: OscillatorNode; o2: OscillatorNode; lfo: OscillatorNode; depth: GainNode; amp: GainNode; lp: BiquadFilterNode } | null = null;

  engineOn() {
    if (this.eng || !this.enabled) return;
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running' || !this.master) return;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    lfo.type = 'sine';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const amp = ctx.createGain();
    amp.gain.value = 0.0001;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.connect(depth);
    depth.connect(amp.gain);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(amp);
    amp.connect(this.master);
    o1.frequency.value = 40;
    o2.frequency.value = 20;
    lfo.frequency.value = 9;
    o1.start();
    o2.start();
    lfo.start();
    amp.gain.setTargetAtTime(0.16, ctx.currentTime, 0.15);
    this.eng = { o1, o2, lfo, depth, amp, lp };
  }
  /** level 0–1 sets the speed, rough 0–1 how violently it shudders. */
  engineSet(level: number, rough: number) {
    const e = this.eng;
    if (!e || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 34 + level * 46;
    e.o1.frequency.setTargetAtTime(f, t, 0.08);
    e.o2.frequency.setTargetAtTime(f / 2, t, 0.08);
    e.lp.frequency.setTargetAtTime(300 + level * 500 + rough * 500, t, 0.1);
    e.lfo.frequency.setTargetAtTime(5 + level * 9, t, 0.1);
    e.depth.gain.setTargetAtTime(rough * 0.14, t, 0.1);
  }
  engineOff() {
    const e = this.eng;
    if (!e || !this.ctx) return;
    this.eng = null;
    const t = this.ctx.currentTime;
    e.amp.gain.cancelScheduledValues(t);
    e.amp.gain.setTargetAtTime(0.0001, t, 0.12);
    for (const o of [e.o1, e.o2, e.lfo]) o.stop(t + 0.6);
  }

  play(name: SfxName, arg = 0) {
    if (!this.enabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
      return; // still locked: the page has not been touched yet
    }
    // never stack the same sound on top of itself within a few ms (double clicks, key repeat)
    const now = ctx.currentTime;
    const prev = this.last.get(name) ?? -1;
    if (now - prev < (name === 'scribble' ? 0.3 : 0.035)) return;
    this.last.set(name, now);
    switch (name) {
      case 'tap':
        this.tone({ f: 1500, to: 900, dur: 0.045, gain: 0.16, type: 'triangle' });
        this.noise({ dur: 0.02, f: 4200, q: 0.8, gain: 0.05 });
        break;
      case 'toggle':
        this.tone({ f: arg ? 1100 : 760, to: arg ? 1500 : 560, dur: 0.07, gain: 0.18, type: 'triangle' });
        break;
      case 'open':
        this.tone({ f: 520, to: 880, dur: 0.12, gain: 0.14, type: 'triangle' });
        this.noise({ dur: 0.1, f: 1500, to: 4000, q: 0.7, gain: 0.04 });
        break;
      case 'close':
        this.tone({ f: 840, to: 480, dur: 0.1, gain: 0.13, type: 'triangle' });
        break;
      case 'start':
        this.tone({ f: 659.25, dur: 0.13, gain: 0.2, type: 'triangle', echo: 0.2 });
        this.tone({ f: 987.77, dur: 0.22, gain: 0.22, at: 0.09, type: 'triangle', echo: 0.3 });
        break;
      case 'tick':
        this.tone({ f: 1250, to: 1000, dur: 0.05, gain: 0.14 });
        break;
      case 'tickUrgent':
        this.tone({ f: 1760, to: 1350, dur: 0.07, gain: 0.2 });
        this.tone({ f: 880, dur: 0.05, gain: 0.08, type: 'triangle' });
        break;
      case 'hit': {
        // arg = tier index 0..4. Everyday is one soft note; each tier above adds a note and some sparkle.
        const t = Math.max(0, Math.min(4, arg));
        const notes = [[0], [0, 2], [0, 2, 4], [0, 2, 4, 5], [0, 2, 4, 5, 6]][t];
        notes.forEach((n, i) => this.chime(LADDER[n], i * (t >= 3 ? 0.065 : 0.08), 0.22 + t * 0.012, 0.4 + t * 0.08, 0.3 + t * 0.05));
        if (t >= 2) this.noise({ dur: 0.35, at: 0.02, type: 'highpass', f: 5000, to: 9000, q: 0.5, gain: 0.02 + t * 0.008, echo: 0.3 });
        if (t >= 3) this.tone({ f: 220, to: 330, dur: 0.4, gain: 0.12, type: 'sine', at: 0 });
        if (t >= 4) {
          this.tone({ f: 110, to: 165, dur: 0.6, gain: 0.2, at: 0 });
          this.noise({ dur: 0.5, at: 0, f: 400, to: 3000, q: 0.8, gain: 0.07 });
        }
        break;
      }
      case 'miss':
        // gentle: a soft low knock, and it is free, so it must not feel like a punishment
        this.tone({ f: 260, to: 150, dur: 0.14, gain: 0.2, type: 'sine' });
        this.tone({ f: 196, to: 140, dur: 0.12, gain: 0.1, type: 'triangle', at: 0.07 });
        this.noise({ dur: 0.05, f: 700, type: 'lowpass', gain: 0.06 });
        break;
      case 'repeat':
        this.tone({ f: 420, dur: 0.06, gain: 0.12, type: 'triangle' });
        this.tone({ f: 420, dur: 0.06, gain: 0.1, type: 'triangle', at: 0.08 });
        break;
      case 'timeup':
        [440, 370, 311, 247].forEach((f, i) => this.tone({ f, dur: 0.3, gain: 0.17, at: i * 0.11, type: 'triangle', lp: 1800, echo: 0.2 }));
        break;
      case 'skip':
        this.noise({ dur: 0.2, f: 600, to: 3200, q: 1.2, gain: 0.07 });
        break;
      case 'ascent': {
        this.noise({ dur: 0.9, f: 300, to: 5000, q: 1.5, gain: 0.07, attack: 0.3 });
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.chime(f, 0.15 + i * 0.1, 0.2, 0.9, 0.4));
        this.tone({ f: 130.81, to: 261.63, dur: 1.0, gain: 0.16, attack: 0.2, type: 'sine' });
        break;
      }
      case 'finish':
        [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => this.chime(f, i * 0.09, 0.22, 0.8, 0.4));
        this.tone({ f: 130.81, dur: 0.9, gain: 0.14, at: 0.2, type: 'triangle', lp: 900 });
        break;
      case 'scribble': {
        // a pencil scribbling: quick scratchy strokes, rising and falling in pitch
        const strokes = 9 + Math.round(arg * 6);
        for (let i = 0; i < strokes; i++) {
          const at = i * 0.075 + Math.random() * 0.012;
          const up = i % 2 === 0;
          this.noise({ dur: 0.07, at, type: 'bandpass', f: up ? 2200 : 4300, to: up ? 4300 : 2200, q: 2.2, gain: 0.07 + Math.random() * 0.04, attack: 0.012 });
          this.noise({ dur: 0.05, at: at + 0.01, type: 'highpass', f: 6500, gain: 0.018, attack: 0.01 });
        }
        break;
      }
      case 'correct':
        [659.25, 830.61, 987.77, 1318.51].forEach((f, i) => this.chime(f, i * 0.07, 0.22, 0.6, 0.35));
        break;
      case 'wrong':
        this.tone({ f: 170, to: 120, dur: 0.22, gain: 0.16, type: 'sawtooth', lp: 700 });
        this.tone({ f: 128, to: 96, dur: 0.22, gain: 0.12, type: 'square', lp: 500, at: 0.0 });
        break;
      case 'solved':
        [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].forEach((f, i) => this.chime(f, i * 0.08, 0.24, 1.0, 0.45));
        this.tone({ f: 130.81, dur: 1.1, gain: 0.16, at: 0.1, type: 'triangle', lp: 900 });
        break;
      case 'failed':
        [392, 349.23, 293.66, 220].forEach((f, i) => this.tone({ f, dur: 0.38, gain: 0.16, at: i * 0.15, type: 'triangle', lp: 1400, echo: 0.2 }));
        break;
      case 'creak':
        // strained metal: a wavering, filtered saw. arg = strain 0..1
        this.tone({ f: 120 + arg * 90, to: 90 + arg * 140, dur: 0.5, gain: 0.07 + arg * 0.05, type: 'sawtooth', lp: 500 + arg * 900 });
        this.noise({ dur: 0.45, f: 900 + arg * 900, q: 6, gain: 0.03 + arg * 0.03, type: 'bandpass' });
        break;
      case 'crack':
        this.noise({ dur: 0.12, f: 3500, to: 800, q: 0.6, gain: 0.3, type: 'bandpass' });
        this.tone({ f: 200, to: 60, dur: 0.25, gain: 0.25, type: 'triangle' });
        this.noise({ dur: 0.5, at: 0.08, f: 500, type: 'lowpass', gain: 0.12 });
        break;
      case 'clunk':
        this.tone({ f: 150 + arg * 60, to: 70, dur: 0.12, gain: 0.3, type: 'sine' });
        this.noise({ dur: 0.04, f: 1200, type: 'bandpass', q: 1, gain: 0.1 });
        break;
      case 'snap':
        this.tone({ f: 1800, to: 1000, dur: 0.035, gain: 0.14, type: 'square', lp: 3000 });
        break;
      case 'whoosh':
        this.noise({ dur: 0.35, f: 500, to: 3500, q: 0.8, gain: 0.08, attack: 0.12 });
        break;
      case 'splash':
        this.noise({ dur: 0.7, f: 1800, to: 500, q: 0.7, gain: 0.2, attack: 0.02, type: 'bandpass', echo: 0.15 });
        this.tone({ f: 90, to: 45, dur: 0.5, gain: 0.22, type: 'sine' });
        this.noise({ dur: 1.0, at: 0.15, f: 700, type: 'lowpass', gain: 0.07, attack: 0.2 });
        break;
      case 'pencil':
        this.noise({ dur: 0.06, f: 3200, q: 2, gain: 0.05, attack: 0.01 });
        break;
      case 'rumble':
        this.tone({ f: 55 + arg * 25, dur: 0.5, gain: 0.18, type: 'sawtooth', lp: 220 });
        this.noise({ dur: 0.5, f: 180, type: 'lowpass', gain: 0.1 });
        break;
    }
  }
}

export const sfx = new Engine();
