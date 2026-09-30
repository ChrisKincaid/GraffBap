// Synthesized spray-can sounds; the AudioContext is created lazily inside a user gesture.
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = false;
let hiss: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

const MASTER_LEVEL = 0.6;

function audio(): AudioContext | null {
  if (!ac) {
    if (typeof AudioContext === 'undefined') return null;
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = muted ? 0 : MASTER_LEVEL;
    master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') void ac.resume();
  return ac;
}

function envelope(a: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(master!);
  return g;
}

function click(a: AudioContext, t: number, level: number): void {
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3000 + Math.random() * 900;
  bp.Q.value = 5;
  src.connect(bp).connect(envelope(a, t, 0.55 * level, 0.002, 0.045));
  src.start(t, Math.random() * 1.5, 0.06);

  const ping = a.createOscillator();
  ping.frequency.value = 2300 + Math.random() * 400;
  ping.connect(envelope(a, t, 0.07 * level, 0.002, 0.08));
  ping.start(t);
  ping.stop(t + 0.1);
}

export function playShake(): void {
  const a = audio();
  if (!a || muted) return;
  const t0 = a.currentTime + 0.01;
  // Ball rattling end-to-end: strong/weak pairs.
  [0, 0.075, 0.2, 0.275, 0.4, 0.475].forEach((dt, i) => click(a, t0 + dt, i % 2 ? 0.55 : 1));
}

export function startHiss(intensity: number): void {
  const a = audio();
  if (!a || hiss) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const hp = a.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 9000;
  const gain = a.createGain();
  const t = a.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.06 + 0.1 * intensity, t + 0.04);
  src.connect(hp).connect(lp).connect(gain).connect(master!);
  src.start(t, Math.random() * 1.5);
  hiss = { src, gain };
}

// Returns true if a hiss was playing.
export function stopHiss(): boolean {
  if (!hiss || !ac) return false;
  const t = ac.currentTime;
  hiss.gain.gain.cancelScheduledValues(t);
  hiss.gain.gain.setValueAtTime(hiss.gain.gain.value, t);
  hiss.gain.gain.linearRampToValueAtTime(0, t + 0.08);
  hiss.src.stop(t + 0.1);
  hiss = null;
  return true;
}

export function playPuff(): void {
  const a = audio();
  if (!a || muted) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noise;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1600, t);
  lp.frequency.exponentialRampToValueAtTime(300, t + 0.18);
  src.connect(lp).connect(envelope(a, t, 0.3, 0.01, 0.18));
  src.start(t, Math.random() * 1.5, 0.22);
}

export function setMuted(m: boolean): void {
  muted = m;
  if (ac && master) master.gain.setTargetAtTime(m ? 0 : MASTER_LEVEL, ac.currentTime, 0.02);
}

// Browsers only start audio after a user gesture; call from the first input to resume the context.
export function unlockAudio(): void {
  audio();
}

// ---------- Tactile foley ----------
// Felt nib chirping on steel: short, faint, vibrato-warbled squeak.
export function playSqueak(): void {
  const a = audio();
  if (!a || muted) return;
  const t = a.currentTime;
  const f0 = 1700 + Math.random() * 900;
  const o = a.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * (1.1 + Math.random() * 0.2), t + 0.09);
  const lfo = a.createOscillator();
  lfo.frequency.value = 38 + Math.random() * 20;
  const depth = a.createGain();
  depth.gain.value = 60;
  lfo.connect(depth).connect(o.frequency);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f0;
  bp.Q.value = 4;
  o.connect(bp).connect(envelope(a, t, 0.025, 0.015, 0.09));
  o.start(t);
  o.stop(t + 0.13);
  lfo.start(t);
  lfo.stop(t + 0.13);
}

// Masking tape peel: crackly noise with a rising band sweep.
export function playPeel(): void {
  const a = audio();
  if (!a || muted) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(4200, t + 0.32);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  for (let i = 0; i < 14; i++) g.gain.setValueAtTime(0.05 + Math.random() * 0.12, t + i * 0.022);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
  src.connect(bp).connect(g).connect(master!);
  src.start(t, Math.random() * 1.5, 0.4);
}

// ---------- Wheel-on-rail clatter ----------
// Seconds per "ka-clack" at 1x; the scheduler looks ahead so timing stays tight.
const CLATTER_PERIOD = 1.1;
let clatter: { timer: number; next: number; rate: number } | null = null;

function thunk(a: AudioContext, t: number, level: number): void {
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700 + Math.random() * 200;
  bp.Q.value = 1.5;
  src.connect(bp).connect(envelope(a, t, 0.35 * level, 0.003, 0.09));
  src.start(t, Math.random() * 1.5, 0.12);

  const body = a.createOscillator();
  body.frequency.setValueAtTime(110, t);
  body.frequency.exponentialRampToValueAtTime(55, t + 0.12);
  body.connect(envelope(a, t, 0.4 * level, 0.004, 0.14));
  body.start(t);
  body.stop(t + 0.2);

  const ring = a.createOscillator();
  ring.frequency.value = 1250 + Math.random() * 150;
  ring.connect(envelope(a, t, 0.025 * level, 0.002, 0.18));
  ring.start(t);
  ring.stop(t + 0.22);
}

function scheduleClatter(): void {
  if (!ac || !clatter) return;
  while (clatter.next < ac.currentTime + 0.2) {
    const period = CLATTER_PERIOD / clatter.rate;
    thunk(ac, clatter.next, 1);
    thunk(ac, clatter.next + Math.min(0.16, period * 0.15), 0.75);
    clatter.next += period;
  }
}

// Mute is handled by the master gain, so unmuting mid-roll picks the rhythm back up.
export function startClatter(rate: number): void {
  const a = audio();
  if (!a) return;
  if (clatter) {
    clatter.rate = rate;
    return;
  }
  clatter = { timer: 0, next: a.currentTime + 0.05, rate };
  clatter.timer = window.setInterval(scheduleClatter, 50);
  scheduleClatter();
}

export function setClatterRate(rate: number): void {
  if (clatter) clatter.rate = rate;
}

export function stopClatter(): void {
  if (!clatter) return;
  clearInterval(clatter.timer);
  clatter = null;
}

// ---------- Subway: quick bright rail ticks with an occasional wheel squeal ----------
const SUB_TICK_PERIOD = 0.55;
let subway: { timer: number; next: number; nextSqueal: number; rate: number } | null = null;

// Lighter, higher double-tick than the freight thunk: short cars on jointed track.
function tick(a: AudioContext, t: number, level: number): void {
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400 + Math.random() * 400;
  bp.Q.value = 4;
  src.connect(bp).connect(envelope(a, t, 0.18 * level, 0.001, 0.035));
  src.start(t, Math.random() * 1.5, 0.05);

  const ping = a.createOscillator();
  ping.type = 'triangle';
  ping.frequency.value = 3200 + Math.random() * 300;
  ping.connect(envelope(a, t, 0.02 * level, 0.001, 0.05));
  ping.start(t);
  ping.stop(t + 0.07);
}

// Flange-on-rail screech through curves: a warbling high partial that swells and fades.
function squeal(a: AudioContext, t: number): void {
  const f = 2600 + Math.random() * 900;
  const dur = 0.5 + Math.random() * 0.6;
  const o = a.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * (0.96 + Math.random() * 0.08), t + dur);
  const lfo = a.createOscillator();
  lfo.frequency.value = 6 + Math.random() * 5;
  const depth = a.createGain();
  depth.gain.value = f * 0.012;
  lfo.connect(depth).connect(o.frequency);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = 9;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.012, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(bp).connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
  lfo.start(t);
  lfo.stop(t + dur + 0.05);
}

function scheduleSubway(): void {
  if (!ac || !subway) return;
  while (subway.next < ac.currentTime + 0.2) {
    const period = SUB_TICK_PERIOD / subway.rate;
    tick(ac, subway.next, 1);
    tick(ac, subway.next + Math.min(0.09, period * 0.16), 0.7);
    subway.next += period;
  }
  if (ac.currentTime >= subway.nextSqueal) {
    squeal(ac, ac.currentTime + 0.05);
    subway.nextSqueal = ac.currentTime + 14 + Math.random() * 14;
  }
}

export function startSubwayRumble(rate: number): void {
  const a = audio();
  if (!a) return;
  if (subway) {
    subway.rate = rate;
    return;
  }
  const t = a.currentTime;
  subway = { timer: 0, next: t + 0.05, nextSqueal: t + 6 + Math.random() * 6, rate };
  subway.timer = window.setInterval(scheduleSubway, 50);
  scheduleSubway();
}

export function stopSubwayRumble(): void {
  if (!subway) return;
  clearInterval(subway.timer);
  subway = null;
}
