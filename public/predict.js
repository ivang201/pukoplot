// ============================================================
//  Предсказание для браузера: последний снимок сервера + та же физика (sim.js)
//  вперёд до «сейчас + полпинга» со своими нажатиями.
//  Отдельный модуль — чтобы его можно было гонять и в тестах без браузера.
// ============================================================
import { createWorld, newHippo, simStep, DT } from './sim.js';
import { arenaStep } from './arena.js';
import { NOMODS } from './cosmetics.js';

const BIG = 1e9;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Predictor {
  constructor() {
    this.W = null; this.pwH = new Map(); this.stopT = new Map();
    this.snap = null; this.hp = new Map();
    this.clockOff = null; this.rtt = 0; this.samples = [];
    this.inHist = []; this.needRelease = false; this.syncMult = 1; this.puddles = [];
    this.rules = null; this.myId = 0;
    this.T = 0; this.rem = 0; this.steps = 0;
    this.kind = 'race'; this.A = null; this.aH = new Map(); this.perks = new Map();
  }
  // бафы легендарок: id бегемота → множители (те же, что считает сервер)
  setPerks(map) { this.perks = map; }
  setTrack(tr) { this.W = createWorld(tr); this.pwH.clear(); this.puddles = []; this.kind = 'race'; }
  // арена: мир строит клиент по составу команд (createArena), сюда — только подменять состояние
  setArena(A) { this.A = A; this.kind = 'arena'; this.aH = new Map(A.hippos.map(h => [h.id, h])); if (this.snap && this.snap.t !== 'a') this.snap = null; }
  reset() { this.snap = null; this.samples = []; this.clockOff = null; }
  lead() { return clamp(this.rtt * 0.5, 0.004, 0.2); }
  // Часы сервера: берём ответ с самым маленьким пингом из последних
  onPong(m, t) {
    const r = t - m.c;
    if (r < 0 || r > 3 || typeof m.T !== 'number') return;
    this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.25 : r;
    this.samples.push({ r, off: m.T + r / 2 - t }); if (this.samples.length > 10) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.r < a.r ? b : a));
    this.clockOff = this.clockOff === null ? best.off : this.clockOff + (best.off - this.clockOff) * 0.15;
  }
  // то же по данным сетевого потока: r — пинг (с), off — смещение часов сервера относительно нашего времени
  onClock(r, off) {
    if (!(r >= 0 && r < 3)) return;
    this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.25 : r;
    this.samples.push({ r, off }); if (this.samples.length > 16) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.r < a.r ? b : a));
    this.clockOff = this.clockOff === null ? best.off : this.clockOff + (best.off - this.clockOff) * 0.15;
  }
  onSnap(m, t) {
    if (this.clockOff === null || m.T - t > this.clockOff) this.clockOff = m.T - t;   // снимок не может прийти раньше, чем создан
    if (this.snap && m.T <= this.snap.T && this.snap.t === m.t) return false;
    const fi = m.t === 'a' ? 5 : 4;
    for (const h of m.hp) { const o = this.hp.get(h[0]); if (o && o[fi] && !h[fi]) this.stopT.set(h[0], m.T); }
    this.snap = m; this.hp = new Map(m.hp.map(h => [h[0], h]));
    return true;
  }
  addPuddle(pd) { this.puddles.push(pd); }
  record(t, inp) {
    if (this.clockOff === null) return;
    const H = this.inHist, last = H[H.length - 1];
    const T = Math.max(last ? last.T : -BIG, t + this.clockOff + this.lead());
    if (!last || last.f !== inp.f || last.c !== inp.c) H.push({ T, f: inp.f, c: inp.c });
    const cut = this.snap ? this.snap.T - 0.5 : -BIG;
    while (H.length > 1 && H[1].T <= cut) H.shift();
    if (H.length > 400) H.splice(0, H.length - 400);
  }
  load(sn) {
    const W = this.W, R = W.raft;
    R.x = sn.x; R.z = sn.z; R.vx = sn.vx; R.vz = sn.vz; R.a = sn.a; R.w = sn.w; R.s = sn.s; R.hint = Math.round(sn.s);
    R.status = sn.st; R.invulnUntil = sn.inv ? BIG : 0; R.dirt = sn.rd || 0;
    R.boostUntil = sn.rf & 1 ? BIG : 0; R.shieldUntil = sn.rf & 2 ? BIG : 0;
    W.sync.group = null; W.sync.until = sn.sy ? sn.T + 0.25 : 0; W.sync.mult = this.syncMult;
    if (this.rules) W.rules = this.rules;
    W.puddles = this.puddles = this.puddles.filter(pd => pd.until > sn.T);
    W.hippos.length = 0;
    for (const hp of sn.hp) {
      const id = hp[0], fl = hp[7], f = !!hp[4];
      let h = this.pwH.get(id); if (!h) { h = newHippo(id); this.pwH.set(id, h); }
      h.seat = hp[1]; h.pos = hp[2]; h.vel = hp[3]; h.gas = hp[5]; h.heat = hp[6]; h.dirt = hp[8] || 0;
      h.fartOn = f; h.fartStart = fl & 8 ? sn.T : sn.T - 5; h.lastFart = f ? sn.T : -99;
      h.idleSince = f ? sn.T : (this.stopT.get(id) ?? sn.T - 5);
      h.offUntil = fl & 1 ? BIG : 0; h.overUntil = fl & 2 ? BIG : 0; h.stunUntil = fl & 4 ? BIG : 0; h.faintUntil = fl & 32 ? BIG : 0;
      h.needRelease = id === this.myId ? this.needRelease : false; h.sprayed = false;
      h.inFart = f; h.inAim = null; h.inCrawl = id === this.myId ? 0 : (Math.abs(h.vel) > 0.15 ? Math.sign(h.vel) : 0);
      h.pk = this.perks.get(id) || NOMODS;
      W.hippos.push(h);
    }
  }
  loadArena(sn) {
    const A = this.A;
    if (this.rules) A.rules = this.rules;
    A.radFixed = typeof sn.rad === 'number' ? sn.rad : null;
    A.bomb.raft = sn.bm ? sn.bm[0] : -1;
    A.event = sn.evt ? { k: sn.evt[0], until: sn.evt[1], ang: sn.evt[2] } : null;
    for (const r of sn.r) {
      const R = A.rafts[r[0]]; if (!R) continue;
      R.x = r[1]; R.z = r[2]; R.a = r[3]; R.w = r[4]; R.vx = r[5]; R.vz = r[6]; R.status = r[7]; R.invulnUntil = r[8] ? BIG : 0; R.dirt = r[9] || 0;
      const fl = r[10] || 0; R.boostUntil = fl & 1 ? BIG : 0; R.shieldUntil = fl & 2 ? BIG : 0; R.out = !!(fl & 4); R.inf = !!(fl & 8); R.magnetUntil = fl & 32 ? BIG : 0;
      if (r[11] !== undefined) { R.gate = r[11]; R.lap = r[12]; }
    }
    for (const hp of sn.hp) {
      const h = this.aH.get(hp[0]); if (!h) continue;
      const fl = hp[8], f = !!hp[5];
      h.pos = hp[3]; h.vel = hp[4]; h.gas = hp[6]; h.heat = hp[7]; h.dirt = hp[9] || 0;
      h.fartOn = f; h.fartStart = fl & 8 ? sn.T : sn.T - 5; h.lastFart = f ? sn.T : -99;
      h.idleSince = f ? sn.T : (this.stopT.get(h.id) ?? sn.T - 5);
      h.offUntil = fl & 1 ? BIG : 0; h.overUntil = fl & 2 ? BIG : 0; h.stunUntil = fl & 4 ? BIG : 0; h.faintUntil = fl & 32 ? BIG : 0;
      h.needRelease = h.id === this.myId ? this.needRelease : false;
      h.inFart = f; h.inAim = null; h.inCrawl = h.id === this.myId ? 0 : (Math.abs(h.vel) > 0.15 ? Math.sign(h.vel) : 0);
      h.pk = this.perks.get(h.id) || NOMODS;
    }
    if (A.ball && sn.b) { const B = A.ball; B.x = sn.b[0]; B.z = sn.b[1]; B.vx = sn.b[2]; B.vz = sn.b[3]; A.ballFreeze = (sn.b[2] === 0 && sn.b[3] === 0 && Math.hypot(B.x, B.z) > 24) ? BIG : 0; }
  }
  // Прокрутить мир до «сейчас + упреждение». Возвращает false, если ещё нечего показывать.
  run(t) {
    const sn = this.snap;
    const arena = this.kind === 'arena';
    if (!sn || this.clockOff === null || (arena ? !this.A || sn.t !== 'a' : !this.W || sn.t !== 's')) return false;
    if (arena) this.loadArena(sn); else this.load(sn);
    const Tp = Math.max(sn.T, t + this.clockOff + this.lead());
    const ph = sn.ph, mode = { canFart: ph === 'race' || ph === 'lobby', physics: ph === 'race' || ph === 'lobby', crawl: ph !== 'results', predict: true };
    const mine = arena ? this.aH.get(this.myId) : this.pwH.get(this.myId), inMe = arena ? !!mine : this.W.hippos.includes(mine), H = this.inHist;
    let hi = 0, T = sn.T;
    const steps = Math.min(36, Math.floor((Tp - sn.T) / DT));
    for (let k = 0; k < steps; k++) {
      T += DT;
      if (inMe) {
        while (hi + 1 < H.length && H[hi + 1].T <= T) hi++;
        const e = H[hi]; if (e && e.T <= T) { mine.inFart = !!e.f; mine.inCrawl = e.c; }
      }
      if (arena) arenaStep(this.A, T, mode, null); else simStep(this.W, T, mode, null);
    }
    this.steps = steps; this.T = T; this.rem = Math.min(DT, Math.max(0, Tp - T));
    if (inMe) { if (!mine.inFart) this.needRelease = false; else if (mine.gas <= 0.001) this.needRelease = true; }
    return true;
  }
}
