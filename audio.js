// Generativer Klang – alles wird zur Laufzeit mit der Web Audio API synthetisiert.

const PENTA = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99, 880.0, 1046.5];

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* privater Modus o. Ä. */
  }
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = load('mc.muted', false);
    this.level = 0.85;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.level;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.4, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(this.master);

    this.noiseBuf = this.makeNoise(2);
    this.startAmbient();
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    save('mc.muted', m);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : this.level, t, 0.15);
  }

  out(node, wet) {
    const dryG = this.ctx.createGain();
    dryG.gain.value = 1 - wet * 0.5;
    const wetG = this.ctx.createGain();
    wetG.gain.value = wet;
    node.connect(dryG).connect(this.dry);
    node.connect(wetG).connect(this.reverb);
  }

  tone({ freq, type = 'sine', attack = 0.005, decay = 0.6, gain = 0.15, when = 0, wet = 0.4, glide = null, detune = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.value = detune;
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + decay * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g);
    this.out(g, wet);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  noise({ dur = 0.3, freq = 800, q = 1, type = 'bandpass', gain = 0.1, when = 0, sweep = null, wet = 0.3, attack = 0.01 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.out(g, wet);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  startAmbient() {
    const ctx = this.ctx;
    const pad = ctx.createGain();
    pad.gain.value = 0.0;
    pad.gain.setTargetAtTime(0.05, ctx.currentTime, 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.7;
    lp.connect(pad);
    this.out(pad, 0.7);

    [[73.42, 'sine', 0], [110, 'triangle', -6], [146.83, 'sine', 5], [220, 'sine', -3]].forEach(([f, type, det], i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.22, 0.3, 0.08][i];
      o.connect(g).connect(lp);
      o.start();
    });

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();

    // leiser Wind
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.018;
    const wl = ctx.createOscillator();
    wl.frequency.value = 0.08;
    const wlg = ctx.createGain();
    wlg.gain.value = 180;
    wl.connect(wlg).connect(wf.frequency);
    wind.connect(wf).connect(wg);
    this.out(wg, 0.5);
    wind.start();
    wl.start();

    // vereinzelte, ferne Glockentöne
    const chime = () => {
      if (!this.muted) {
        const f = PENTA[3 + Math.floor(Math.random() * 7)];
        this.tone({ freq: f, attack: 0.04, decay: 4.5, gain: 0.018, wet: 0.95 });
        if (Math.random() < 0.4) this.tone({ freq: f * 1.5, attack: 0.05, decay: 3.5, gain: 0.01, wet: 0.95, when: 0.35 });
      }
      setTimeout(chime, 5000 + Math.random() * 9000);
    };
    setTimeout(chime, 2500);
  }

  hover() {
    this.tone({ freq: 1567.98, decay: 0.12, gain: 0.012, wet: 0.5 });
  }

  select() {
    this.tone({ freq: 880, decay: 0.35, gain: 0.07, wet: 0.5 });
    this.tone({ freq: 1318.5, decay: 0.5, gain: 0.03, wet: 0.7, when: 0.03 });
  }

  deselect() {
    this.tone({ freq: 659.25, decay: 0.3, gain: 0.045, wet: 0.5, glide: 587.33 });
  }

  deny() {
    this.tone({ freq: 196, type: 'triangle', decay: 0.18, gain: 0.06, wet: 0.2 });
    this.tone({ freq: 185, type: 'triangle', decay: 0.18, gain: 0.05, wet: 0.2, when: 0.09 });
  }

  whoosh(dur = 0.5) {
    this.noise({ dur, freq: 300, sweep: 1400, q: 0.8, gain: 0.05, attack: dur * 0.5, wet: 0.5 });
  }

  land(size = 2) {
    const base = [0, 150, 120, 95][size];
    this.tone({ freq: base, glide: base * 0.55, decay: 0.22, gain: 0.22, wet: 0.25 });
    this.noise({ dur: 0.09, freq: 2400, q: 0.9, gain: 0.05, wet: 0.2, attack: 0.002 });
  }

  drop(i) {
    const f = PENTA[i % PENTA.length];
    this.tone({ freq: f, decay: 0.8, gain: 0.045, wet: 0.75 });
    this.tone({ freq: 110 + i * 3, glide: 70, decay: 0.15, gain: 0.07, wet: 0.2 });
  }

  capture(value = 1) {
    this.tone({ freq: 587.33, decay: 0.9, gain: 0.07, wet: 0.7 });
    this.tone({ freq: 440, decay: 1.2, gain: 0.06, wet: 0.8, when: 0.11 });
    if (value >= 2) this.tone({ freq: 349.23, decay: 1.4, gain: 0.05, wet: 0.85, when: 0.22 });
    if (value >= 3) this.tone({ freq: 293.66, decay: 1.8, gain: 0.05, wet: 0.9, when: 0.33 });
    this.noise({ dur: 0.7, freq: 2500, sweep: 700, q: 2, gain: 0.03, wet: 0.7 });
  }

  vault() {
    this.tone({ freq: 1174.66, decay: 1.2, gain: 0.035, wet: 0.85 });
    this.tone({ freq: 1760, decay: 1.0, gain: 0.018, wet: 0.9, when: 0.06 });
  }

  merge() {
    [440, 587.33, 698.46, 880, 1174.66].forEach((f, i) => this.tone({ freq: f, decay: 1.4, gain: 0.05, wet: 0.85, when: i * 0.07 }));
    this.noise({ dur: 0.9, freq: 600, sweep: 4000, q: 1.5, gain: 0.03, wet: 0.8, attack: 0.4 });
  }

  turn() {
    this.tone({ freq: 523.25, attack: 0.02, decay: 1.6, gain: 0.025, wet: 0.9 });
  }

  tick(remaining) {
    this.tone({ freq: remaining <= 2 ? 1046.5 : 784, type: 'triangle', decay: 0.12, gain: 0.05, wet: 0.3 });
  }

  clockCall() {
    [784, 587.33, 784].forEach((f, i) => this.tone({ freq: f, type: 'triangle', decay: 0.5, gain: 0.05, wet: 0.6, when: i * 0.16 }));
  }

  ui() {
    this.tone({ freq: 1046.5, decay: 0.15, gain: 0.03, wet: 0.4 });
  }

  win() {
    const notes = [293.66, 440, 587.33, 698.46, 880, 1174.66];
    notes.forEach((f, i) => this.tone({ freq: f, attack: 0.03, decay: 3.2, gain: 0.06, wet: 0.9, when: i * 0.14 }));
    this.tone({ freq: 146.83, attack: 0.6, decay: 4, gain: 0.08, wet: 0.8 });
  }

  start() {
    [293.66, 392, 587.33].forEach((f, i) => this.tone({ freq: f, attack: 0.05, decay: 2.6, gain: 0.05, wet: 0.9, when: i * 0.12 }));
  }
}
