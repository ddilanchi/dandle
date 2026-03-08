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

  rocketThrust(duration) {
    this.ensure();
    const t = this.ctx.currentTime;

    // Sustained engine rumble
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * (duration + 0.2)), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(80, t);
    filt.frequency.exponentialRampToValueAtTime(300, t + 0.15);
    filt.frequency.setValueAtTime(180, t + 0.15);
    filt.Q.value = 6;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
    g.gain.setValueAtTime(0.45, t + duration - 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    noise.connect(filt).connect(g).connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + duration + 0.05);

    // Ignition pop
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    og.gain.setValueAtTime(0.4, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(this.ctx.destination);
    o.start(t); o.stop(t + 0.3);

    // Countdown beeps — one per second of thrust
    for (let i = 1; i < duration; i++) {
      const bo = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bo.type = 'sine';
      bo.frequency.value = 1200 - i * 80;
      bg.gain.setValueAtTime(0.12, t + i);
      bg.gain.exponentialRampToValueAtTime(0.001, t + i + 0.08);
      bo.connect(bg).connect(this.ctx.destination);
      bo.start(t + i); bo.stop(t + i + 0.1);
    }

    // Cutoff thud
    const co = this.ctx.createOscillator();
    const cg = this.ctx.createGain();
    co.type = 'sine';
    co.frequency.setValueAtTime(200, t + duration);
    co.frequency.exponentialRampToValueAtTime(40, t + duration + 0.25);
    cg.gain.setValueAtTime(0.3, t + duration);
    cg.gain.exponentialRampToValueAtTime(0.001, t + duration + 0.25);
    co.connect(cg).connect(this.ctx.destination);
    co.start(t + duration); co.stop(t + duration + 0.3);
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
  // Walking bass + right-hand jazz melody

  // Major scale intervals (semitones): root, 2, 3, 5, 7, 9, 11
  static MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11, 12];
  // Root notes per level (Hz)
  static LEVEL_ROOTS = [
    261.63, // C4 - Level 1
    293.66, // D4 - Level 2
    329.63, // E4 - Level 3
    349.23, // F4 - Level 4
    392.00, // G4 - Level 5
    440.00, // A4 - Level 6
    261.63, // fallback
  ];

  _buildScale(rootHz) {
    // Two octaves of the scale, from bass to treble
    const scale = [];
    for (let oct = -2; oct < 2; oct++) {
      for (const interval of AudioManager.MAJOR_INTERVALS) {
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
    this._rootHz = root;
    this._musicPlaying = true;
    this._beatDur = 0.38; // quarter note duration
    this._cubeCount = 5;
    this._nextBeat = this.ctx.currentTime + 0.05;
    this._beatIndex = 0;
    this._melodyNote = 16; // start in upper half of scale

    this._musicGain = this.ctx.createGain();
    this._musicGain.gain.value = 0.07;
    this._musicGain.connect(this.ctx.destination);

    this._scheduleLoop();
  }

  stopMusic() {
    this._musicPlaying = false;
    if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null; }
    if (this._musicGain) {
      try { this._musicGain.gain.linearRampToValueAtTime(0, (this.ctx?.currentTime || 0) + 0.4); } catch (e) {}
    }
  }

  setMusicIntensity(cubeCount) { this._cubeCount = cubeCount; }

  _getBeatDur() {
    // Slightly faster as cubes accumulate
    const speedup = Math.min(this._cubeCount / 50, 0.25);
    return this._beatDur * (1 - speedup);
  }

  _scheduleLoop() {
    if (!this._musicPlaying) return;
    const now = this.ctx.currentTime;
    const lookahead = 0.25;
    while (this._nextBeat < now + lookahead) {
      this._playBeat(this._nextBeat, this._beatIndex);
      this._nextBeat += this._getBeatDur();
      this._beatIndex++;
    }
    this._musicTimer = setTimeout(() => this._scheduleLoop(), 80);
  }

  _playBeat(time, beat) {
    // Walking bass on every beat (scale steps up/down)
    this._playWalkingBass(time, beat);
    // Melody on beats 1 and 3 of each bar (every 4 beats), with some off-beat fills
    const pos = beat % 4;
    if (pos === 0) this._playMelody(time, 'chord');
    else if (pos === 2) this._playMelody(time, 'run');
    else if (Math.random() > 0.65) this._playMelody(time, 'fill');
    // Mellow drums
    this._playDrums(time, beat);
  }

  _playDrums(time, beat) {
    const pos = beat % 4;
    const bd = this._getBeatDur();

    // Soft kick on 1 and 3
    if (pos === 0 || pos === 2) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(65, time);
      o.frequency.exponentialRampToValueAtTime(30, time + 0.12);
      g.gain.setValueAtTime(0.18, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
      o.connect(g).connect(this._musicGain);
      o.start(time); o.stop(time + 0.15);
    }

    // Soft snare/brush on 2 and 4
    if (pos === 1 || pos === 3) {
      // Noise burst with bandpass for brush feel
      const len = Math.ceil(this.ctx.sampleRate * 0.08);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.025));
      }
      const n = this.ctx.createBufferSource();
      n.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 3000;
      f.Q.value = 0.8;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.09, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
      n.connect(f).connect(g).connect(this._musicGain);
      n.start(time);

      // Tiny body tone under the snare
      const o = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(180, time);
      o.frequency.exponentialRampToValueAtTime(120, time + 0.05);
      og.gain.setValueAtTime(0.07, time);
      og.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
      o.connect(og).connect(this._musicGain);
      o.start(time); o.stop(time + 0.06);
    }

    // Gentle hi-hat on every beat (and occasional off-beat)
    const hatLen = Math.ceil(this.ctx.sampleRate * 0.03);
    const hatBuf = this.ctx.createBuffer(1, hatLen, this.ctx.sampleRate);
    const hatData = hatBuf.getChannelData(0);
    for (let i = 0; i < hatLen; i++) {
      hatData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.008));
    }
    const hat = this.ctx.createBufferSource();
    hat.buffer = hatBuf;
    const hf = this.ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 7000;
    const hg = this.ctx.createGain();
    hg.gain.setValueAtTime(0.04, time);
    hg.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    hat.connect(hf).connect(hg).connect(this._musicGain);
    hat.start(time);

    // Off-beat hat (swung 8th note feel)
    if (Math.random() > 0.4) {
      const offTime = time + bd * 0.6;
      const hat2 = this.ctx.createBufferSource();
      hat2.buffer = hatBuf;
      const hg2 = this.ctx.createGain();
      hg2.gain.setValueAtTime(0.025, offTime);
      hg2.gain.exponentialRampToValueAtTime(0.001, offTime + 0.025);
      hat2.connect(hf.context === this.ctx ? this.ctx.createBiquadFilter() : hf);
      // Create fresh filter for second hat
      const hf2 = this.ctx.createBiquadFilter();
      hf2.type = 'highpass';
      hf2.frequency.value = 7000;
      hat2.connect(hf2).connect(hg2).connect(this._musicGain);
      hat2.start(offTime);
    }
  }

  _playWalkingBass(time, beat) {
    // Walk up/down the lower octave of the scale
    // Pattern: root → 3rd → 5th → leading tone, then repeat up/down
    const bar = Math.floor(beat / 4) % 4;
    const pos = beat % 4;
    // Walking patterns: up on even bars, down on odd bars
    const walkUp   = [0, 2, 4, 6]; // scale degrees (index into scale, bass octave)
    const walkDown = [7, 5, 3, 1];
    const bassOct = 8; // index offset into scale for bass register (oct -1)
    const idx = bassOct + (bar % 2 === 0 ? walkUp[pos] : walkDown[pos]);
    const freq = this._scale[Math.max(0, Math.min(this._scale.length - 1, idx))];

    const dur = this._getBeatDur() * 0.85;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.7, time);
    g.gain.exponentialRampToValueAtTime(0.01, time + dur);
    o.connect(g).connect(this._musicGain);
    o.start(time); o.stop(time + dur);
  }

  _playMelody(time, type) {
    const scaleLen = this._scale.length;
    const midPoint = Math.floor(scaleLen * 0.6); // upper half of scale

    if (type === 'chord') {
      // Play a two-note chord (root + third or fifth)
      const base = midPoint + Math.floor(Math.random() * 4);
      const third = Math.min(scaleLen - 1, base + 2);
      const dur = this._getBeatDur() * 1.8;
      [base, third].forEach(idx => {
        const freq = this._scale[Math.max(0, Math.min(scaleLen - 1, idx))];
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.001, time);
        g.gain.linearRampToValueAtTime(0.35, time + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, time + dur);
        o.connect(g).connect(this._musicGain);
        o.start(time); o.stop(time + dur);
      });
    } else if (type === 'run') {
      // Short scale run of 3–4 notes
      const dir = Math.random() > 0.5 ? 1 : -1;
      const runLen = 3 + Math.floor(Math.random() * 2);
      let note = this._melodyNote;
      const bd = this._getBeatDur();
      for (let i = 0; i < runLen; i++) {
        note = Math.max(midPoint - 2, Math.min(scaleLen - 1, note + dir));
        const freq = this._scale[note];
        const noteTime = time + i * (bd / runLen);
        const dur = (bd / runLen) * 0.8;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.001, noteTime);
        g.gain.linearRampToValueAtTime(0.25, noteTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, noteTime + dur);
        o.connect(g).connect(this._musicGain);
        o.start(noteTime); o.stop(noteTime + dur);
      }
      this._melodyNote = note;
    } else {
      // Fill: single syncopated note
      const step = (Math.random() > 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 2));
      this._melodyNote = Math.max(midPoint - 2, Math.min(scaleLen - 1, this._melodyNote + step));
      const freq = this._scale[this._melodyNote];
      const dur = this._getBeatDur() * 0.6;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.001, time);
      g.gain.linearRampToValueAtTime(0.2, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      o.connect(g).connect(this._musicGain);
      o.start(time); o.stop(time + dur);
    }
  }
}
