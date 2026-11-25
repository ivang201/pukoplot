// ============================================================
//  ПУКОПЛОТ — физика мира (одна и та же на сервере и в браузере)
//  Сервер считает «по-честному» и рассылает события.
//  Браузер в режиме predict прокручивает мир вперёд от последнего снимка,
//  чтобы плот отзывался без задержки сети (события и случайности там выключены).
// ============================================================
import {
  PHYS, DT, moveRaft, addRaftJet, bounceRaft, kickRaft, RAFT_R, RIM_R, DEFAULT_RULES, frame, locate, obstacleShapes, obstacleState, closestOnSeg, wrapAngle,
  sectorCenter, sectorHalf, geyserErupting, extendTrack, rimCount, isCenter, shapeOf, rimR, supportDir,
} from './shared.js';
import { NOMODS } from './cosmetics.js';

export { DT };
const NOOP = new Proxy({}, { get: () => () => {} });

export function createWorld(tr) {
  return {
    tr,
    raft: { x: 0, z: 0, vx: 0, vz: 0, a: 0, w: 0, hint: 0, s: 0, status: 0, statusT: 0, invulnUntil: 0, cp: -1, cpS: 3, lastEject: -9, dirt: 0, maxS: 0, boostUntil: 0, shieldUntil: 0 },
    pickups: [], pkId: 1, pkNext: 0,
    hippos: [], puddles: [], blobs: [], puddleId: 1,
    sync: { group: null, until: 0, mult: 1 },
    rules: { ...DEFAULT_RULES },
    geyserHit: new Map(),
  };
}

export function newHippo(id) {
  return { id, seat: 0, pos: 0, vel: 0, gas: 1, heat: 0, fartOn: false, fartStart: 0, lastFart: -99, idleSince: 0, overUntil: 0, stunUntil: 0, offUntil: 0, faintUntil: 0, faintCd: 0, needRelease: false, inAim: null, inCrawl: 0, inFart: false, dirt: 0, blobAcc: 0, sprayed: false };
}

export const homePos = (seat, n) => isCenter(seat) ? Math.PI : wrapAngle(sectorCenter(seat, rimCount(n)));
export const seatRadius = (seat, S, pos) => isCenter(seat) ? 0 : (S ? rimR(S, pos) : RIM_R);
const shapeW = (W) => shapeOf(W.rules && W.rules.raft);
export function resetHippos(W) {
  const n = W.hippos.length;
  for (const h of W.hippos) {
    h.pos = homePos(h.seat, n); h.vel = 0; h.gas = 1; h.heat = 0; h.fartOn = false;
    h.overUntil = 0; h.stunUntil = 0; h.offUntil = 0; h.faintUntil = 0; h.needRelease = false; h.dirt = 0; h.sprayed = false;
  }
}

export function resetRaft(W, s = 3) {
  const f = frame(W.tr, s, 0), L = W.tr.L;
  Object.assign(W.raft, { x: f.x, z: f.z, a: f.h, w: 0, vx: f.fx * L.current * 0.5, vz: f.fz * L.current * 0.5, hint: Math.round(s), s, status: 0, dirt: 0 });
  W.blobs.length = 0; W.raft.boostUntil = 0; W.raft.shieldUntil = 0;
  resetHippos(W);
}

export function hippoWorld(W, h) {
  const th = W.raft.a + h.pos, r = seatRadius(h.seat, shapeW(W), h.pos);
  return { th, x: W.raft.x + Math.sin(th) * r, z: W.raft.z + Math.cos(th) * r };
}

function makePuddle(W, h, T) {
  const w = hippoWorld(W, h);
  const pd = { id: W.puddleId++, x: +(w.x + Math.sin(w.th) * 1.4).toFixed(2), z: +(w.z + Math.cos(w.th) * 1.4).toFixed(2), r: PHYS.puddleR, until: T + PHYS.puddleTime };
  W.puddles.push(pd); if (W.puddles.length > 10) W.puddles.shift();
  return pd;
}

const _shapes = [], _prev = [];

// mode: { canFart, physics, crawl, predict }
export function simStep(W, T, mode, ev) {
  const E = ev || NOOP, predict = !!mode.predict, S = shapeW(W);
  const R = W.raft, tr = W.tr, L = tr.L, rules = W.rules;
  const n = W.hippos.length, nr = rimCount(n), half = sectorHalf(nr);
  R.fx = R.fz = R.tq = R.totalThrust = 0;

  // ---------------- бегемоты
  for (const h of W.hippos) {
    const K = h.pk || NOMODS;
    if (h.offUntil > 0 && T >= h.offUntil) { h.offUntil = 0; h.pos = homePos(h.seat, n); h.vel = 0; E.back(h); }
    const off = h.offUntil > T, fainted = T < h.faintUntil;
    // перебирание руками по своему сектору
    if (!off && !fainted && mode.crawl && isCenter(h.seat)) {
      // центральный бегемот вертится на месте как угодно
      const want = (h.inCrawl || 0) * PHYS.centerSpin * K.crawl;
      h.vel += (want - h.vel) * Math.min(1, DT * 10);
      h.pos = wrapAngle(h.pos + h.vel * DT);
      R.a = wrapAngle(R.a - h.vel * DT * 0.03);
    } else if (!off && !fainted && mode.crawl) {
      const c = sectorCenter(h.seat, nr);
      let lp = wrapAngle(h.pos - c), lt = lp;
      if (h.inAim !== null && h.inAim !== undefined) lt = wrapAngle(h.inAim + Math.PI - R.a - c);
      else if (h.inCrawl) lt = lp + h.inCrawl * 0.6;
      let diff;
      if (nr <= 1) diff = wrapAngle(lt - lp); else { lt = Math.max(-half, Math.min(half, lt)); diff = lt - lp; }
      const cs = PHYS.crawlSpeed * K.crawl, want = Math.max(-cs, Math.min(cs, diff * 7));
      h.vel += (want - h.vel) * Math.min(1, DT * 12);
      let move = h.vel * DT;
      if (nr > 1) { const nlp = Math.max(-half, Math.min(half, lp + move)); move = nlp - lp; if (nlp === half || nlp === -half) h.vel = 0; }
      h.pos = wrapAngle(h.pos + move);
      R.a = wrapAngle(R.a - move * PHYS.crawlReact);
    } else if (fainted) h.vel *= 0.9;
    // пук
    if (!h.inFart) {
      if (h.sprayed && !h.needRelease && h.gas > 0) E.sprayRelease(h);   // отпустил на грани — молодец
      h.needRelease = false; h.sprayed = false;
    }
    const blocked = off || fainted || T < h.overUntil || T < h.stunUntil || !mode.canFart || R.status !== 0;
    const wants = h.inFart && !blocked && !h.needRelease;
    if (wants && h.gas <= 0.001) h.needRelease = true;
    if (wants && h.gas > 0) {
      if (!h.fartOn) {
        // холостой с жидким: вместо реактивного пука — конфуз
        if (!predict && rules.misfire > 0 && Math.random() < rules.misfire * K.misfire * (1 + h.heat) * (h.gas < 0.4 ? 1.6 : 1)) {
          h.stunUntil = T + PHYS.misfireFaint; h.faintUntil = T + PHYS.misfireFaint * K.faint; h.needRelease = true;
          h.dirt = Math.min(1, h.dirt + 0.5); R.dirt = Math.min(1, R.dirt + 0.15);
          E.misfire(h, makePuddle(W, h, T));
          continue;
        }
        h.fartStart = T; h.heat = Math.min(1, h.heat + PHYS.heatStart);
        onFartStart(W, h, T, E);
      }
      h.fartOn = true;
      h.gas = Math.max(0, h.gas - PHYS.gasDrain * K.drain * (L.gasMult || 1) * DT);
      h.heat = Math.min(1, h.heat + PHYS.heatRise * K.heat * (L.heatMult || 1) * DT);
      h.lastFart = T; h.idleSince = T;
      if (h.gas < PHYS.sprayGas) { h.sprayed = true; R.dirt = Math.min(1, R.dirt + 0.05 * DT); }
      E.fartTick(h);
      if (h.heat >= 1) { h.overUntil = T + PHYS.overheatTime; h.fartOn = false; E.overheat(h); }
      if (h.gas <= 0) {     // газ кончился — щёлкнул
        if (!predict) {
          h.stunUntil = T + PHYS.shitStun; h.fartOn = false; h.needRelease = true; h.sprayed = false;
          h.dirt = Math.min(1, h.dirt + 0.4); R.dirt = Math.min(1, R.dirt + 0.12);
          E.shit(h, makePuddle(W, h, T));
        } else h.fartOn = false;
        continue;
      }
      const th = R.a + h.pos, center = isCenter(h.seat), rr = center ? 0 : rimR(S, h.pos);
      const burst = T - h.fartStart < PHYS.burstTime ? PHYS.burstMult : 1;
      const F = PHYS.thrust * K.thrust * (L.thrustMult || 1) * burst * (T < W.sync.until ? W.sync.mult : 1) * (T < R.boostUntil ? 1.5 : 1);
      addRaftJet(R, h, T, F, th, rr);
      // коричневый газ рождает «облака вони»
      const brown = Math.max(0, Math.min(1, (0.5 - h.gas) / 0.35));
      if (!predict && brown > 0.25) {
        h.blobAcc += DT;
        if (h.blobAcc >= PHYS.blobEvery) {
          h.blobAcc = 0;
          const ox = Math.sin(th), oz = Math.cos(th);
          const br = center ? rimR(S, h.pos) : rr;          // у центрального струя уходит за борт, а не в лица соседям
          W.blobs.push({ x: R.x + ox * (br + 0.7), z: R.z + oz * (br + 0.7), vx: ox * 6 + R.vx * 0.5, vz: oz * 6 + R.vz * 0.5, r: PHYS.blobR0, age: 0, str: brown, owner: h.id });
          if (W.blobs.length > 70) W.blobs.shift();
        }
      }
    } else {
      h.fartOn = false;
      h.heat = Math.max(0, h.heat - PHYS.heatCool * K.cool * DT);
      if (T - (h.idleSince || 0) > PHYS.gasRegenDelay) h.gas = Math.min(1, h.gas + PHYS.gasRegen * K.regen * (L.regenMult || 1) * DT);
    }
    if (!predict && rules.burps && !off && Math.random() < PHYS.burpPerSec * DT) E.burp(h);
  }

  if (!mode.physics) return;

  // ---------------- авария: ждём возрождения
  if (R.status !== 0) {
    if (predict) return;
    if (R.status === 2) { R.x += R.vx * DT; R.z += R.vz * DT; }
    if (T - R.statusT > 1.8) {
      resetRaft(W, R.cpS); R.invulnUntil = T + 1.6;
      E.respawn();
    }
    return;
  }

  if (tr.endless && extendTrack(tr, R.s + 450)) E.extended();

  const loc = locate(tr, R.x, R.z, R.hint);
  R.hint = loc.i; R.s = loc.s;
  let ax = 0, az = 0, aw = 0;

  for (const o of L.obstacles) {
    if (Math.abs(o.s - R.s) > 16) continue;
    if (o.type === 'whirl') {
      const st = obstacleState(o, tr, T);
      const dx = st.x - R.x, dz = st.z - R.z, dist = Math.hypot(dx, dz), Rr = o.r + RAFT_R * 0.5;
      if (dist < Rr) { const k = 1 - dist / Rr, ux = dx / (dist || 1), uz = dz / (dist || 1); ax += (ux * 4 + uz * 7) * k * o.str; az += (uz * 4 - ux * 7) * k * o.str; aw += 5 * k * o.str; }
    } else if (o.type === 'boost') {
      if (Math.abs(R.s - o.s) < o.len / 2 && Math.abs(loc.d - o.d) < o.wid / 2) { ax += loc.fx * 22; az += loc.fz * 22; }
    } else if (o.type === 'geyser') {
      if (geyserErupting(o, T)) {
        const st = obstacleState(o, tr, T);
        const dx = R.x - st.x, dz = R.z - st.z, dist = Math.hypot(dx, dz);
        if (dist < o.r + RAFT_R * 0.6) {
          const ux = dx / (dist || 1), uz = dz / (dist || 1);
          ax += ux * 26; az += uz * 26; aw += 6;
          const last = W.geyserHit.get(o);
          if (!predict && (last === undefined || T - last > 1.2)) { W.geyserHit.set(o, T); E.geyser(o); ejectCheck(W, T, 9.5, -ux, -uz, true, E, 'geyser'); }
        }
      }
    }
  }
  // лужи — вязко
  let slow = false;
  if (!predict) W.puddles = W.puddles.filter(pd => pd.until > T);
  for (const pd of W.puddles) if (pd.until > T && Math.hypot(pd.x - R.x, pd.z - R.z) < pd.r + RAFT_R * 0.6) slow = true;

  R.vx += ax * DT; R.vz += az * DT; R.w += aw * DT;
  moveRaft(R, S, T, L.drag || 1, loc.fx * L.current, loc.fz * L.current, slow);

  // препятствия
  _shapes.length = 0; _prev.length = 0;
  for (const o of L.obstacles) {
    if (Math.abs(o.s - R.s) > 16) continue;
    obstacleShapes(o, tr, T, _shapes); obstacleShapes(o, tr, T - DT, _prev);
  }
  const invuln = T < R.invulnUntil;
  for (let k = 0; k < _shapes.length; k++) {
    const sh = _shapes[k], pr = _prev[k];
    const [qx, qz, u] = closestOnSeg(R.x, R.z, sh.ax, sh.az, sh.bx, sh.bz);
    const dx = R.x - qx, dz = R.z - qz, dist = Math.hypot(dx, dz), minD = supportDir(S, R.a, -dx, -dz) + sh.r;
    if (dist >= minD) continue;
    if (sh.kill && !invuln && !predict) { crash(W, sh.kill, T, E); return; }
    const nx = dist > 1e-6 ? dx / dist : 1, nz = dist > 1e-6 ? dz / dist : 0;
    R.x += nx * (minD - dist); R.z += nz * (minD - dist);
    const pqx = pr ? pr.ax + (pr.bx - pr.ax) * u : qx, pqz = pr ? pr.az + (pr.bz - pr.az) * u : qz;
    const ovx = Math.max(-25, Math.min(25, (qx - pqx) / DT)), ovz = Math.max(-25, Math.min(25, (qz - pqz) / DT));
    const imp = contact(W, nx, nz, ovx, ovz, sh.e, sh.hard, T, E, predict);
    if (sh.hard && imp > PHYS.smashSpeed && !invuln && !predict) { crash(W, 'smash', T, E); return; }
  }

  // стенки и обрывы
  const l2 = locate(tr, R.x, R.z, R.hint);
  R.hint = l2.i; R.s = l2.s;
  const hw = l2.w / 2, side = l2.d > 0 ? 1 : -1;
  const isGap = (side > 0 ? tr.gapL : tr.gapR)[l2.i];
  const isSpike = (side > 0 ? tr.spikeL : tr.spikeR)[l2.i];
  if (isGap) {
    if (Math.abs(l2.d) > hw + 0.4 && !predict) { crash(W, 'fall', T, E); return; }
  }
  const ext = supportDir(S, R.a, l2.nx * side, l2.nz * side);          // насколько борт выступает к стенке
  if (isGap) { /* обрыв обработан выше */ } else if (isSpike && !invuln && !predict && Math.abs(l2.d) + ext > hw - PHYS.spikeReach) {
    crash(W, 'pop', T, E); return;            // шипы торчат внутрь русла — колют раньше, чем плот коснётся вала
  } else if (Math.abs(l2.d) + ext > hw) {
    const pen = Math.abs(l2.d) + ext - hw, nx = -l2.nx * side, nz = -l2.nz * side;
    R.x += nx * pen; R.z += nz * pen;
    contact(W, nx, nz, 0, 0, PHYS.wallBounce, false, T, E, predict);
  }
  if (l2.s < 2.2) {
    R.x += l2.fx * (2.2 - l2.s); R.z += l2.fz * (2.2 - l2.s);
    const vn = R.vx * l2.fx + R.vz * l2.fz;
    if (vn < 0) { R.vx -= 1.4 * vn * l2.fx; R.vz -= 1.4 * vn * l2.fz; }
  }
  if (R.s > R.maxS) R.maxS = R.s;
  if (predict) return;

  // облака вони и обмороки
  updateBlobs(W, T, E);
  if (W.rules.pickups !== false) updatePickups(W, T, E);

  // чекпоинты и финиш
  const cps = L.checkpoints;
  while (R.cp + 1 < cps.length && R.s >= cps[R.cp + 1]) { R.cp++; R.cpS = cps[R.cp]; E.cp(R.cp + 1, cps.length); }
  if (!tr.endless && R.s >= tr.length - 6) E.finish();
}

function onFartStart(W, h, T, E) {
  const S = W.sync;
  if (!S.group || T - S.group.t0 > PHYS.syncWindow) S.group = { t0: T, ids: new Set(), told: 1 };
  S.group.ids.add(h.id);
  const c = S.group.ids.size;
  if (c >= 2 && c > S.group.told) { S.group.told = c; S.until = T + PHYS.syncTime; S.mult = 1 + 0.22 * (c - 1); E.sync(c, [...S.group.ids]); }
  E.fartStart(h);
}

function crash(W, kind, T, E) {
  const R = W.raft;
  if (R.status !== 0) return;
  R.status = kind === 'fall' ? 2 : 1; R.statusT = T;
  E.crash(kind);
}

function contact(W, nx, nz, ovx, ovz, e, hard, T, E, predict) {
  const R = W.raft, S = shapeW(W);
  const vn = (R.vx - ovx) * nx + (R.vz - ovz) * nz;
  if (vn >= 0) return 0;
  if (!predict) ejectCheck(W, T, -vn, nx, nz, hard, E);
  bounceRaft(R, S, nx, nz, ovx, ovz, e, vn);
  return -vn;
}

function ejectCheck(W, T, speed, nx, nz, hard, E, cause = 'hit') {
  const R = W.raft, thr = (hard ? PHYS.ejectHard : PHYS.ejectSoft) * (W.tr.L.ejectMult || 1) * shapeW(W).eject;
  if (speed < thr || T - R.lastEject < 0.5) return;
  R.lastEject = T;
  const base = Math.min(0.95, 0.35 + (speed - thr) / 5);
  const contactAng = Math.atan2(-nx, -nz);
  const sp = Math.hypot(R.vx, R.vz) || 1;
  for (const h of W.hippos) {
    if (h.offUntil > T || speed < thr * (h.pk || NOMODS).eject) continue;
    const da = Math.abs(wrapAngle(R.a + h.pos - contactAng));
    if (Math.random() < (da < 1.9 ? base : base * 0.3)) {
      h.offUntil = T + PHYS.offTime; h.fartOn = false;
      const w = hippoWorld(W, h);
      const dx = -nx * 0.6 + (R.vx / sp) * 0.4 + (Math.random() - 0.5) * 0.5, dz = -nz * 0.6 + (R.vz / sp) * 0.4 + (Math.random() - 0.5) * 0.5;
      const dl = Math.hypot(dx, dz) || 1;
      E.eject(h, w.x, w.z, dx / dl, dz / dl, cause);
    }
  }
}

function updateBlobs(W, T, E) {
  const R = W.raft, cur = W.tr.L.current;
  const loc = locate(W.tr, R.x, R.z, R.hint);
  const k = Math.exp(-1.6 * DT);
  for (const b of W.blobs) {
    b.age += DT;
    b.vx = b.vx * k + loc.fx * cur * 0.6 * (1 - k); b.vz = b.vz * k + loc.fz * cur * 0.6 * (1 - k);
    b.x += b.vx * DT; b.z += b.vz * DT;
    b.r = PHYS.blobR0 + (PHYS.blobR1 - PHYS.blobR0) * Math.min(1, b.age / PHYS.blobLife);
  }
  W.blobs = W.blobs.filter(b => b.age < PHYS.blobLife);
  if (!W.rules.faint) return;
  const victims = new Map();
  for (const h of W.hippos) {
    if (h.offUntil > T || T < h.faintUntil || T < h.faintCd || T < R.shieldUntil) continue;
    const K = h.pk || NOMODS;
    const th = R.a + h.pos, fr = isCenter(h.seat) ? -0.45 : rimR(shapeW(W), h.pos) - 0.5;          // лицо смотрит в центр плота (центральный — от попы)
    const fx = R.x + Math.sin(th) * fr, fz = R.z + Math.cos(th) * fr;
    for (const b of W.blobs) {
      if (b.str < 0.35 * K.stinkRes) continue;
      if (b.owner === h.id && b.age < 0.6) continue;
      if (Math.hypot(fx - b.x, fz - b.z) < b.r * 0.85) {
        h.faintUntil = T + W.rules.faintTime * K.faint; h.faintCd = T + W.rules.faintTime * K.faint + PHYS.faintCooldown; h.fartOn = false;
        h.dirt = Math.min(1, h.dirt + 0.1);
        E.faint(h, b.owner);
        victims.set(b.owner, (victims.get(b.owner) || 0) + 1);
        break;
      }
    }
  }
  for (const [owner, cnt] of victims) if (cnt >= 2) E.gasCombo(owner, cnt);
}

// Бонусы на трассе: боб (полный газ), перец (тяга сильнее), прищепка (вонь не страшна)
const PK_DUR = { pepper: 6, clip: 8 };
function updatePickups(W, T, E) {
  const R = W.raft, tr = W.tr;
  W.pickups = W.pickups.filter(pk => pk.s > R.s - 25);
  if (W.pickups.length < 2 && T >= W.pkNext && R.s + 70 < tr.length - 10) {
    W.pkNext = T + 7 + Math.random() * 6;
    const s = R.s + 40 + Math.random() * 30, f = frame(tr, s, 0), half = Math.max(0, f.w / 2 - 2.6);
    const near = tr.L.obstacles.some(o => Math.abs(o.s - s) < 5);
    if (!near && !(tr.gapL[Math.round(s)] || tr.gapR[Math.round(s)])) {
      const d = (Math.random() * 2 - 1) * half, p = frame(tr, s, d), r = Math.random();
      W.pickups.push({ id: W.pkId++, kind: r < 0.45 ? 'bean' : r < 0.75 ? 'pepper' : 'clip', x: p.x, z: p.z, y: p.y, s });
    }
  }
  for (const pk of W.pickups) {
    if (pk.taken || Math.hypot(pk.x - R.x, pk.z - R.z) > RAFT_R + 0.8) continue;
    pk.taken = true;
    if (pk.kind === 'bean') for (const h of W.hippos) { h.gas = 1; h.needRelease = false; }
    const pm = Math.max(1, ...W.hippos.map(h => (h.pk || NOMODS).pickup));
    if (pk.kind === 'pepper') R.boostUntil = T + PK_DUR.pepper * pm;
    if (pk.kind === 'clip') R.shieldUntil = T + PK_DUR.clip * pm;
    E.pickup(pk);
  }
  if (W.pickups.some(pk => pk.taken)) W.pickups = W.pickups.filter(pk => !pk.taken);
}

// Мега-пук в сплаве («турбо»): мощный толчок от попы и 3 секунды усиленной тяги
export function raceMega(W, h, T) {
  const R = W.raft, S = shapeW(W), th = R.a + h.pos;
  kickRaft(R, S, h, T, 6, isCenter(h.seat));
  R.boostUntil = Math.max(R.boostUntil, T + 3);
  h.gas = 1; h.heat = Math.max(0, h.heat - 0.3);
  const rr = rimR(S, h.pos);
  return { x: R.x + Math.sin(th) * (rr + 0.8), z: R.z + Math.cos(th) * (rr + 0.8), dx: Math.sin(th), dz: Math.cos(th) };
}
