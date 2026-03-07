export class AudioManager {
  constructor() {
    this.ctx = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.initialized = true;
  }

  ensure() {
    if (!this.initialized) this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  select() {
    this.ensure();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(800, this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.05);
    g.gain.setValueAtTime(0.15, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    o.stop(this.ctx.currentTime + 0.1);
  }

  place() {
    this.ensure();
    const t = this.ctx.currentTime;

    // thunk
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.15);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 0.2);

    // noise snap
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    const n = this.ctx.createBufferSource();
    const ng = this.ctx.createGain();
    n.buffer = buf;
    ng.gain.setValueAtTime(0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(ng).connect(this.ctx.destination);
    n.start(t);
  }

  collision() {
    this.ensure();
    const t = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.03));
    }
    const n = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    n.buffer = buf;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    n.connect(g).connect(this.ctx.destination);
    n.start(t);
  }

  verb() {
    this.ensure();
    const t = this.ctx.currentTime;
    // whoosh - filtered noise sweep
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.4, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const n = this.ctx.createBufferSource();
    n.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(2000, t + 0.2);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    f.Q.value = 5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    n.connect(f).connect(g).connect(this.ctx.destination);
    n.start(t);
    n.stop(t + 0.4);
  }

  levelComplete() {
    this.ensure();
    const t = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + i * 0.15);
      g.gain.linearRampToValueAtTime(0.2, t + i * 0.15 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.5);
      o.connect(g).connect(this.ctx.destination);
      o.start(t + i * 0.15);
      o.stop(t + i * 0.15 + 0.5);
    });
  }

  pop(index) {
    this.ensure();
    const t = this.ctx.currentTime;
    // ascending pitch per block index for a satisfying sequential feel
    const baseFreq = 400 + index * 60;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(baseFreq, t);
    o.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, t + 0.12);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 0.15);

    // tiny click layer
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.02, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
    const n = this.ctx.createBufferSource();
    const ng = this.ctx.createGain();
    n.buffer = buf;
    ng.gain.setValueAtTime(0.15, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    n.connect(ng).connect(this.ctx.destination);
    n.start(t);
  }

  error() {
    this.ensure();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.2);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 0.2);
  }
}
