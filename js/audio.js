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

  explode() {
    this.ensure();
    const t = this.ctx.currentTime;

    // Deep boom
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(20, t + 0.8);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 1.0);

    // Crackle noise burst
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.08));
    }
    const n = this.ctx.createBufferSource();
    const ng = this.ctx.createGain();
    n.buffer = buf;
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(ng).connect(this.ctx.destination);
    n.start(t);

    // High shatter
    const o2 = this.ctx.createOscillator();
    const g2 = this.ctx.createGain();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(2000, t);
    o2.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    g2.gain.setValueAtTime(0.15, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o2.connect(g2).connect(this.ctx.destination);
    o2.start(t);
    o2.stop(t + 0.3);
  }

  // ── Background music ──
  // Procedural jazz/blues that reacts to cube count

  // Blues scale intervals (semitones from root): root, b3, 4, b5, 5, b7
  static BLUES_INTERVALS = [0, 3, 5, 6, 7, 10];
  // Root notes per level (Hz) — different keys
  static LEVEL_ROOTS = [
    130.81, // C3 - Level 1
    155.56, // Eb3 - Level 2
    174.61, // F3 - Level 3
    196.00, // G3 - Level 4
    116.54, // Bb2 - Level 5
    146.83, // D3 - fallback
  ];

  _buildScale(rootHz) {
    const scale = [];
    for (let oct = 0; oct < 2; oct++) {
      for (const interval of AudioManager.BLUES_INTERVALS) {
        scale.push(rootHz * Math.pow(2, (interval + oct * 12) / 12));
      }
    }
    return scale;
  }

  startMusic(level = 1) {
    this.ensure();
    this.stopMusic();

    const rootIdx = Math.min(level - 1, AudioManager.LEVEL_ROOTS.length - 1);
    const root = AudioManager.LEVEL_ROOTS[Math.max(0, rootIdx)];
    this._scale = this._buildScale(root);
    this._bassRoot = root;
    this._musicPlaying = true;
    this._baseTempo = 0.45;
    this._cubeCount = 5;
    this._nextBeat = this.ctx.currentTime + 0.1;
    this._beatIndex = 0;
    this._lastMelodyNote = 3;

    this._musicGain = this.ctx.createGain();
    this._musicGain.gain.value = 0.08;
    this._musicGain.connect(this.ctx.destination);

    this._scheduleLoop();
  }

  stopMusic() {
    this._musicPlaying = false;
    if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; }
    if (this._musicGain) {
      try { this._musicGain.gain.linearRampToValueAtTime(0, (this.ctx?.currentTime || 0) + 0.5); } catch (e) {}
    }
  }

  setMusicIntensity(cubeCount) { this._cubeCount = cubeCount; }

  _getTempo() {
    const speedup = Math.min(this._cubeCount / 40, 0.3);
    return this._baseTempo * (1 - speedup);
  }

  _scheduleLoop() {
    if (!this._musicPlaying) return;
    const now = this.ctx.currentTime;
    const lookahead = 0.2;
    while (this._nextBeat < now + lookahead) {
      this._playBeat(this._nextBeat, this._beatIndex);
      this._nextBeat += this._getTempo();
      this._beatIndex++;
    }
    this._musicTimer = setTimeout(() => this._scheduleLoop(), 100);
  }

  _playBeat(time, beat) {
    const bar = beat % 8;
    this._playBass(time, bar);
    if (bar === 0 || bar === 2 || bar === 4 || bar === 6) {
      if (Math.random() > 0.2) this._playMelody(time);
    }
    if ((bar === 3 || bar === 5) && Math.random() > 0.5) this._playMelody(time);
  }

  _playBass(time, bar) {
    const bassNotes = [0, 0, 4, 3, 2, 2, 4, 3];
    const freq = this._scale[bassNotes[bar]] * 0.5;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    const dur = this._getTempo() * 0.8;
    g.gain.setValueAtTime(0.6, time);
    g.gain.exponentialRampToValueAtTime(0.01, time + dur);
    o.connect(g).connect(this._musicGain);
    o.start(time); o.stop(time + dur);
  }

  _playMelody(time) {
    const step = Math.floor(Math.random() * 3) - 1;
    this._lastMelodyNote = Math.max(2, Math.min(this._scale.length - 1, this._lastMelodyNote + step));
    if (Math.random() > 0.85) {
      this._lastMelodyNote = 2 + Math.floor(Math.random() * (this._scale.length - 3));
    }
    const freq = this._scale[this._lastMelodyNote];
    const dur = this._getTempo() * (0.5 + Math.random() * 0.4);
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const g2 = this.ctx.createGain();
    o1.type = 'sine'; o1.frequency.value = freq;
    o2.type = 'sine'; o2.frequency.value = freq * 2;
    g2.gain.value = 0.15;
    g.gain.setValueAtTime(0.01, time);
    g.gain.linearRampToValueAtTime(0.5, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.01, time + dur);
    o1.connect(g).connect(this._musicGain);
    o2.connect(g2).connect(g);
    o1.start(time); o2.start(time);
    o1.stop(time + dur); o2.stop(time + dur);
  }
}
