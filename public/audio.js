// ============================================================
//  Звук. Пуки синтезируются заранее в банк сэмплов:
//  неровные «шлепки» сфинктера + хлюпанье, пузыри, воздух.
//  Каждый пук собирается из кусков: прострел → тело → подтёк.
// ============================================================

// ---------- генератор одного пука (офлайн, в Float32Array) ----------
function rnd(a, b) { return a + Math.random() * (b - a); }
function smoothNoise(n, rate, sr) {           // плавный случайный сигнал 0..1
  const out = new Float32Array(n); let v = Math.random(), target = Math.random(), k = 0;
  const step = Math.max(1, Math.floor(sr / rate));
  for (let i = 0; i < n; i++) {
    if (k-- <= 0) { target = Math.random(); k = step; }
    v += (target - v) * (1 / step) * 2.2; out[i] = v;
  }
  return out;
}
function onePoleLP(x, fc, sr) { const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0; for (let i = 0; i < x.length; i++) { y = (1 - a) * x[i] + a * y; x[i] = y; } }
function onePoleHP(x, fc, sr) { const a = Math.exp(-2 * Math.PI * fc / sr); let y = 0, px = 0; for (let i = 0; i < x.length; i++) { y = a * (y + x[i] - px); px = x[i]; x[i] = y; } }
function bandBurst(out, at, len, fc, amp, sr) {  // короткий «чвак» — шум через резонатор
  const w = 2 * Math.PI * fc / sr, r = 0.985, c = 2 * r * Math.cos(w);
  let y1 = 0, y2 = 0;
  for (let k = 0; k < len && at + k < out.length; k++) {
    const env = Math.sin(Math.PI * k / len) ** 2;
    const y = (Math.random() * 2 - 1) * env + c * y1 - r * r * y2;
    y2 = y1; y1 = y; out[at + k] += y * amp * 0.08;
  }
}
function bubble(out, at, len, f0, f1, amp, sr) {   // пузырь — чирп вверх
  let ph = 0;
  for (let k = 0; k < len && at + k < out.length; k++) {
    const t = k / len, f = f0 * Math.pow(f1 / f0, t);
    ph += 2 * Math.PI * f / sr;
    out[at + k] += Math.sin(ph) * amp * Math.exp(-4 * t) * Math.min(1, k / (sr * 0.002));
  }
}

const TYPES = {
  //        длит.       f0        конец f0   дрожь  влажн. обрывы  сила
  rip:     { dur: [0.16, 0.32], f0: [95, 150], fall: 0.65, jit: 0.10, wet: 0.15, gate: 0.05, amp: 1.0, att: 0.004 },
  brap:    { dur: [1.4, 2.0], f0: [42, 70], fall: 0.8, jit: 0.16, wet: 0.35, gate: 0.12, amp: 0.9, att: 0.03 },
  tuba:    { dur: [1.4, 2.0], f0: [70, 105], fall: 0.75, jit: 0.07, wet: 0.2, gate: 0.06, amp: 0.85, att: 0.03 },
  squeak:  { dur: [1.0, 1.6], f0: [170, 300], fall: 0.7, jit: 0.04, wet: 0.08, gate: 0.05, amp: 0.6, att: 0.02 },
  wet:     { dur: [1.4, 2.0], f0: [48, 85], fall: 0.85, jit: 0.28, wet: 1.0, gate: 0.25, amp: 0.9, att: 0.02 },
  sputter: { dur: [0.35, 0.6], f0: [60, 110], fall: 0.6, jit: 0.3, wet: 0.7, gate: 0.6, amp: 0.8, att: 0.005 },
  shit:    { dur: [1.1, 1.4], f0: [38, 60], fall: 0.6, jit: 0.35, wet: 1.6, gate: 0.35, amp: 1.0, att: 0.01 },
};

export function genFart(type, sr) {
  const P = TYPES[type];
  const dur = rnd(...P.dur), N = Math.floor(dur * sr);
  const out = new Float32Array(N);
  const f0 = rnd(...P.f0), f1 = f0 * P.fall * rnd(0.85, 1.15);
  const wander = smoothNoise(N, 6, sr), ampN = smoothNoise(N, 14, sr), gateN = smoothNoise(N, 9, sr);
  const flapF = rnd(240, 520), flapTau = sr * rnd(0.0018, 0.0035);
  const atk = P.att * sr, rel = 0.05 * sr;
  const env = (i) => Math.min(1, i / atk) * Math.min(1, (N - i) / rel);
  // 1) шлепки сфинктера — неровный импульсный поезд
  let t = 0;
  while (t < N) {
    const u = t / N;
    let f = (f0 + (f1 - f0) * u) * (0.8 + 0.45 * wander[t | 0]) * (1 + P.jit * (Math.random() * 2 - 1));
    if (type === 'squeak') f *= 1 + 0.08 * Math.sin(u * 40);
    const period = sr / Math.max(25, f);
    const gated = gateN[t | 0] < P.gate ? 0.05 : 1;          // обрывы — «сбивается»
    const a = env(t) * (0.55 + 0.45 * ampN[t | 0]) * (0.75 + 0.5 * Math.random()) * gated;
    const L = Math.min(period * 1.6, sr * 0.014);
    const ff = flapF * rnd(0.85, 1.2) * (type === 'squeak' ? 1.8 : 1);
    for (let k = 0; k < L && t + k < N; k++) {
      const e = Math.exp(-k / flapTau);
      out[(t | 0) + k] += a * e * (Math.sin(2 * Math.PI * ff * k / sr) * 0.8 + (k < sr * 0.0012 ? (Math.random() * 2 - 1) * 0.6 : 0));
    }
    t += period;
  }
  // 2) хлюпанье: пузыри, чваки, бульки
  const wetRate = 38 * P.wet;
  let tw = Math.random() * sr * 0.05;
  while (tw < N && P.wet > 0) {
    const u = tw / N, e = env(tw | 0);
    const r = Math.random();
    if (r < 0.45) bubble(out, tw | 0, (sr * rnd(0.015, 0.05)) | 0, rnd(160, 320), rnd(450, 900), 0.35 * e * P.wet, sr);
    else if (r < 0.85) bandBurst(out, tw | 0, (sr * rnd(0.01, 0.035)) | 0, rnd(500, 1700), 1.6 * e * Math.min(1, P.wet), sr);
    else bubble(out, tw | 0, (sr * rnd(0.04, 0.09)) | 0, rnd(70, 120), rnd(90, 160), 0.6 * e * Math.min(1, P.wet), sr);
    tw += sr * (-Math.log(Math.random() + 1e-6) / wetRate) * (u > 0.75 ? 0.6 : 1);
  }
  // 3) воздух
  for (let i = 0; i < N; i++) out[i] += (Math.random() * 2 - 1) * 0.05 * env(i) * (0.4 + ampN[i]);
  // 4) «тело» — мягкий фильтр
  onePoleHP(out, 35, sr);
  onePoleLP(out, type === 'squeak' ? 3800 : 2400, sr);
  onePoleLP(out, type === 'squeak' ? 5200 : 3400, sr);
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(out[i]));
  const g = (pk > 0 ? 0.92 / pk : 1) * P.amp;
  for (let i = 0; i < N; i++) out[i] *= g;
  return out;
}

const BANK_PLAN = { rip: 6, brap: 6, tuba: 4, squeak: 4, wet: 7, sputter: 6, shit: 3 };

export class Sfx {
  constructor() { this.ctx = null; this.master = null; this.muted = false; this.voices = new Map(); this.bank = {}; this.hiss = new Map(); }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate); this.brown = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const r = Math.random() * 2 - 1; w[i] = r; last = (last + 0.02 * r) / 1.02; b[i] = last * 3.5; }
    // журчание реки
    const amb = c.createBufferSource(); amb.buffer = this.brown; amb.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = c.createGain(); g.gain.value = 0.09;
    amb.connect(lp); lp.connect(g); g.connect(this.master); amb.start();
    // банк пуков — генерируем по кусочку, чтобы не подвисало
    const todo = []; for (const [k, n] of Object.entries(BANK_PLAN)) for (let i = 0; i < n; i++) todo.push(k);
    todo.sort(() => Math.random() - 0.5);
    const first = ['rip', 'brap', 'wet', 'sputter', 'shit']; for (const k of first) todo.splice(todo.indexOf(k), 1);
    let wk = null;
    try { wk = new Worker(new URL('./audio-worker.js', import.meta.url), { type: 'module' }); } catch { wk = null; }
    if (wk) {
      wk.onmessage = (e) => { const { k, d } = e.data; const buf = c.createBuffer(1, d.length, c.sampleRate); buf.copyToChannel(d, 0); (this.bank[k] = this.bank[k] || []).push(buf); };
      wk.onerror = () => { wk = null; this.fallbackBank(todo); };
      wk.postMessage({ list: [...first, ...todo], sr: c.sampleRate });
    } else { for (const k of first) this.addToBank(k); this.fallbackBank(todo); }
  }
  fallbackBank(todo) {
    const step = () => { const k = todo.shift(); if (!k) return; this.addToBank(k); (window.requestIdleCallback || setTimeout)(step, { timeout: 500 }); };
    step();
  }
  addToBank(k) {
    const sr = this.ctx.sampleRate, data = genFart(k, sr);
    const buf = this.ctx.createBuffer(1, data.length, sr); buf.copyToChannel(data, 0);
    (this.bank[k] = this.bank[k] || []).push(buf);
  }
  pick(k) { const arr = this.bank[k] || this.bank.brap; return arr && arr[(Math.random() * arr.length) | 0]; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05); }

  out(pan = 0, vol = 1) {
    const c = this.ctx, g = c.createGain(); g.gain.value = vol;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(this.master); }
    else g.connect(this.master);
    return g;
  }
  playBuf(buf, dest, when, rate = 1, gain = 1, fadeIn = 0.01) {
    if (!buf) { const g = this.ctx.createGain(); return { s: { stop() {} }, g, end: when + 0.15 }; }   // банк ещё не готов
    const c = this.ctx, s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = c.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(gain, when + fadeIn);
    s.connect(g); g.connect(dest); s.start(when);
    return { s, g, end: when + buf.duration / rate };
  }

  // --- длительный пук: прострел → тело (цепочка кусков) → подтёк при отпускании
  fartStart(id, { seed = 0, loud = 1, pan = 0, heat = 0, gas = 1, burst = true, voice = null } = {}) {
    if (!this.ctx || this.voices.has(id)) return;
    const c = this.ctx, t = c.currentTime;
    let dest = this.out(pan, 0.9 * loud);
    const V = voice || {}, extra = [];
    // голос попы из гардероба: фильтр «тубы», металлический «робот», оперное вибрато
    if (V.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = V.lp; f.Q.value = 4; f.connect(dest); dest = f; }
    if (V.robot) {
      const rg = c.createGain(); rg.gain.value = 0; const osc = c.createOscillator(); osc.type = 'square'; osc.frequency.value = 55;
      const og = c.createGain(); og.gain.value = 1; osc.connect(og); og.connect(rg.gain); rg.connect(dest); osc.start(); extra.push(osc); dest = rg;
    }
    let vib = null;
    if (V.vib) { const lfo = c.createOscillator(); lfo.frequency.value = 6; const lg = c.createGain(); lg.gain.value = V.vib; lfo.connect(lg); lfo.start(); extra.push(lfo); vib = lg; }
    const rate = (0.88 + (seed % 4) * 0.07) * rnd(0.94, 1.06) * (V.rate || 1);
    const v = { dest, rate, parts: [], next: t, heat, gas, alive: true, extra, vib };
    if (burst) { const r = this.playBuf(this.pick('rip'), dest, t, rate * rnd(0.95, 1.1), 1.0, 0.003); v.parts.push(r); v.next = r.end - 0.06; }
    this.voices.set(id, v);
    this.feed(v);
  }
  feed(v) {          // подкидываем следующий кусок тела заранее
    if (!v.alive) return;
    const c = this.ctx;
    while (v.next < c.currentTime + 0.5) {
      let type;
      const r = Math.random();
      if (v.gas < 0.2) type = r < 0.6 ? 'sputter' : 'wet';
      else if (v.heat > 0.7) type = r < 0.5 ? 'squeak' : (r < 0.8 ? 'tuba' : 'wet');
      else type = r < 0.38 ? 'wet' : r < 0.68 ? 'brap' : r < 0.86 ? 'tuba' : 'squeak';
      const buf = this.pick(type);
      const p = this.playBuf(buf, v.dest, Math.max(v.next, c.currentTime), v.rate * rnd(0.95, 1.05), type === 'squeak' ? 0.7 : 0.9, 0.06);
      if (v.vib && p.s.playbackRate) v.vib.connect(p.s.playbackRate);
      v.parts.push(p); if (v.parts.length > 6) v.parts.shift();
      v.next = p.end - 0.07;
    }
    v.timer = setTimeout(() => this.feed(v), 200);
  }
  fartUpdate(id, heat, gas) { const v = this.voices.get(id); if (v) { v.heat = heat; v.gas = gas; } }
  fartStop(id, tail = true) {
    const v = this.voices.get(id); if (!v) return;
    this.voices.delete(id); v.alive = false; clearTimeout(v.timer);
    const t = this.ctx.currentTime;
    for (const p of v.parts) { p.g.gain.cancelScheduledValues(t); p.g.gain.setTargetAtTime(0, t, 0.035); try { p.s.stop(t + 0.3); } catch {} }
    for (const o of v.extra || []) { try { o.stop(t + 0.5); } catch {} }
    if (tail && Math.random() < 0.75) this.playBuf(this.pick('sputter'), v.dest, t + 0.02, v.rate * rnd(0.9, 1.15), 0.55, 0.005);
  }
  stopAll() { for (const id of [...this.voices.keys()]) this.fartStop(id, false); for (const id of [...this.hiss.keys()]) this.sizzle(id, 0); }

  // --- шипение перегретой попы
  sizzle(id, level) {
    if (!this.ctx) return;
    let h = this.hiss.get(id);
    if (level <= 0.01) { if (h) { h.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); const s = h.s; setTimeout(() => { try { s.stop(); } catch {} }, 600); this.hiss.delete(id); } return; }
    if (!h) {
      const c = this.ctx, s = c.createBufferSource(); s.buffer = this.white; s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3500;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      h = { s, g }; this.hiss.set(id, h);
    }
    h.g.gain.setTargetAtTime(level * 0.12, this.ctx.currentTime, 0.08);
  }

  tone(freq, dur, type = 'sine', vol = 0.25, when = 0, slide = 0, dest = null) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  burst(dur, freq, type = 'lowpass', vol = 0.4, q = 1, when = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + when, n = c.createBufferSource(); n.buffer = this.white; n.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + dur + 0.05);
  }
  shit(pan = 0) {
    if (!this.ctx) return;
    const d = this.out(pan, 1);
    this.playBuf(this.pick('shit'), d, this.ctx.currentTime, rnd(0.85, 1.0), 1);
    this.tone(120, 0.25, 'sine', 0.4, 0.75, 0.5);     // «плюх»
  }
  pop() { this.burst(0.25, 2500, 'highpass', 0.7); this.tone(300, 0.5, 'sine', 0.5, 0, 0.15); this.burst(1.4, 900, 'lowpass', 0.25); }
  smash() { this.tone(70, 0.6, 'sine', 0.7, 0, 0.4); this.burst(0.5, 1200, 'lowpass', 0.6); this.burst(0.15, 4000, 'highpass', 0.3); }
  bite() { this.burst(0.06, 3000, 'bandpass', 0.8, 2); this.tone(90, 0.3, 'square', 0.25, 0.02, 0.5); }
  splash(v = 1) { this.burst(0.9, 900, 'lowpass', 0.5 * v); this.burst(0.4, 2500, 'bandpass', 0.2 * v, 0.7); }
  fall() { this.tone(700, 1.2, 'triangle', 0.25, 0, 0.2); this.burst(1.6, 600, 'lowpass', 0.35); }
  bump(v = 1) { this.tone(90, 0.25, 'sine', 0.35 * v, 0, 0.5); this.burst(0.25, 600, 'lowpass', 0.25 * v); }
  yell(pan = 0) {       // «А-а-а!» при вылете
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, d = this.out(pan, 0.5);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(rnd(260, 340), t); o.frequency.exponentialRampToValueAtTime(150, t + 0.8);
    const vib = c.createOscillator(); vib.frequency.value = 7; const vg = c.createGain(); vg.gain.value = 12; vib.connect(vg); vg.connect(o.frequency);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 5;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1250; f2.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(d);
    o.start(t); vib.start(t); o.stop(t + 0.9); vib.stop(t + 0.9);
    setTimeout(() => this.splash(0.8), 650);
  }
  overheat() {          // свисток чайника + пар
    this.burst(1.6, 4000, 'highpass', 0.35);
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.setValueAtTime(2200, t); o.frequency.linearRampToValueAtTime(2900, t + 0.9);
    const l = c.createOscillator(); l.frequency.value = 9; const lg = c.createGain(); lg.gain.value = 60; l.connect(lg); lg.connect(o.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g); g.connect(this.master); o.start(t); l.start(t); o.stop(t + 1.2); l.stop(t + 1.2);
  }
  ding() { this.tone(880, 0.5, 'sine', 0.25); this.tone(1320, 0.7, 'sine', 0.2, 0.08); }
  sync(n) { [523, 659, 784, 1047].slice(0, n).forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.22, i * 0.07)); }
  beep(hi) { this.tone(hi ? 1046 : 523, hi ? 0.6 : 0.25, 'square', 0.13); }
  fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.25, i * 0.13)); }
  // --- отрыжка: низкий «бу-у-эрп» с дребезгом связок
  burp(pan = 0, seed = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, d = this.out(pan, 0.55);
    const dur = rnd(0.35, 0.8), f0 = rnd(95, 135) * (1 + (seed % 4) * 0.05);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 1.25, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.08); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
    const am = c.createOscillator(); am.type = 'square'; am.frequency.value = rnd(24, 38);
    const amg = c.createGain(); amg.gain.value = 0.45; am.connect(amg);
    const vca = c.createGain(); vca.gain.value = 0.55; amg.connect(vca.gain);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.setValueAtTime(rnd(450, 650), t); f1.frequency.linearRampToValueAtTime(rnd(300, 420), t + dur); f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 1400;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.03); g.gain.setValueAtTime(1, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(vca); vca.connect(f1); f1.connect(f2); f2.connect(g); g.connect(d);
    o.start(t); am.start(t); o.stop(t + dur + 0.05); am.stop(t + dur + 0.05);
  }
  // --- урчание кишечника «как перед поносом»: булькающие переливы, падающие и взлетающие
  rumble(pan = 0, level = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime, d = this.out(pan, 0.5 * level);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 4; lp.connect(d);
    let t = t0;
    const n = 3 + ((Math.random() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const dur = rnd(0.12, 0.45), f = rnd(110, 320), up = Math.random() < 0.5;
      const o = c.createOscillator(); o.type = Math.random() < 0.5 ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(up ? f * rnd(1.6, 2.6) : f * rnd(0.35, 0.6), t + dur);
      const wob = c.createOscillator(); wob.frequency.value = rnd(14, 30); const wg = c.createGain(); wg.gain.value = f * 0.25; wob.connect(wg); wg.connect(o.frequency);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(rnd(0.25, 0.5), t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(lp); o.start(t); wob.start(t); o.stop(t + dur + 0.05); wob.stop(t + dur + 0.05);
      t += dur * rnd(0.5, 1.1);
    }
    // вязкое бурление под переливами
    const s = c.createBufferSource(); s.buffer = this.brown; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 2;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    s.connect(bp); bp.connect(g); g.connect(d); s.start(t0, Math.random()); s.stop(t + 0.3);
  }
  // --- холостой с жидким: мокрый шлепок без реактивной струи
  misfire(pan = 0) {
    if (!this.ctx) return;
    const d = this.out(pan, 1), t = this.ctx.currentTime;
    this.playBuf(this.pick('wet'), d, t, rnd(0.6, 0.75), 0.9, 0.004);
    this.playBuf(this.pick('shit'), d, t + 0.12, rnd(0.7, 0.85), 0.8, 0.004);
    this.tone(160, 0.3, 'sine', 0.35, 0.35, 0.4);
  }
  // --- обморок: «уф» и щебет птичек
  faint(pan = 0) {
    if (!this.ctx) return;
    const d = this.out(pan, 0.6);
    this.tone(220, 0.5, 'sine', 0.3, 0, 0.5, d);
    for (let i = 0; i < 6; i++) this.tone(rnd(2400, 3400), 0.09, 'sine', 0.08, 0.35 + i * 0.13, 1.4, d);
  }
  geyser() { this.burst(1.6, 700, 'lowpass', 0.5); this.burst(1.2, 3000, 'bandpass', 0.2, 0.6, 0.1); }
  ach(rank = 0) {      // чем реже достижение — тем торжественнее
    const notes = [[784, 988], [784, 988, 1175], [659, 880, 1109, 1319], [523, 784, 1047, 1319, 1568], [523, 659, 784, 1047, 1319, 1568], [392, 523, 784, 1047, 1319, 1568, 2093]][Math.min(5, rank)];
    notes.forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.18, i * 0.075));
  }
  // --- Щелчок: выстрел калом — короткий мокрый «пфлюп» с хлопком
  shot(pan = 0) {
    if (!this.ctx) return;
    const d = this.out(pan, 0.9), t = this.ctx.currentTime;
    this.playBuf(this.pick('rip'), d, t, rnd(1.2, 1.5), 0.9, 0.002);
    this.playBuf(this.pick('wet'), d, t + 0.03, rnd(1.4, 1.8), 0.5, 0.004);
    this.tone(180, 0.12, 'sine', 0.3, 0, 0.4, d);
  }
  splat(pan = 0, v = 1) {      // снаряд шлёпнулся
    if (!this.ctx) return;
    const d = this.out(pan, 0.7 * v);
    this.playBuf(this.pick('shit'), d, this.ctx.currentTime, rnd(1.3, 1.7), 0.7, 0.002);
    this.burst(0.18, 900, 'lowpass', 0.25 * v);
  }
  pickup(kind = 'bean') {
    const seq = kind === 'gold' ? [784, 988, 1175, 1568] : kind === 'pepper' ? [523, 659, 880] : kind === 'clip' ? [659, 523, 784] : [659, 880];
    seq.forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.2, i * 0.06));
  }
  // --- мега-пук: низкий раскат + взрыв
  mega(pan = 0) {
    if (!this.ctx) return;
    const d = this.out(pan, 1.1), t = this.ctx.currentTime;
    this.playBuf(this.pick('tuba'), d, t, 0.45, 1.0, 0.003);
    this.playBuf(this.pick('rip'), d, t + 0.02, 0.6, 0.9, 0.003);
    this.playBuf(this.pick('brap'), d, t + 0.25, 0.5, 0.8, 0.02);
    this.tone(55, 1.1, 'sine', 0.7, 0, 0.35, d); this.burst(1.2, 500, 'lowpass', 0.7); this.burst(0.3, 3000, 'highpass', 0.25);
  }
  ready() { [523, 784].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.15, i * 0.07)); }
  // --- подарки: щелчки ленты, раскрытие по редкости
  tick(v = 1) { this.tone(1400 + Math.random() * 200, 0.03, 'square', 0.05 * v); }
  reveal(rank = 0) {
    const sets = [[659, 784], [659, 880, 1175], [523, 784, 1047, 1319], [392, 523, 784, 1047, 1319, 1568, 2093]];
    sets[rank].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.22, i * 0.08));
    if (rank >= 2) this.burst(0.6, 5000, 'highpass', 0.15, 1, 0.1);
  }
  coin() { this.tone(1568, 0.08, 'square', 0.06); this.tone(2093, 0.18, 'square', 0.05, 0.06); }
}
