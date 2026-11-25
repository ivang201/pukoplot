// ============================================================
//  АРЕНА: несколько плотов в круглом пруду (общая физика сервера и браузера)
//  Режимы: Голодные игры, Царь горы, Пукобол, Щелчок (стрельба калом),
//  Последний на плаву (пруд сужается), Бобовая охота. Отравить может только коричневый дым.
//  Сервер считает очки по событиям; браузер в режиме predict прокручивает
//  мир вперёд со своими нажатиями (события и случайности выключены).
// ============================================================
import { PHYS, DT, moveRaft, addRaftJet, bounceRaft, kickRaft, limitRaftSpeed, RAFT_R, RIM_R, DEFAULT_RULES, wrapAngle, sectorCenter, sectorHalf, closestOnSeg, mulberry32, shapeOf, rimR, supportDir } from './shared.js';
import { NOMODS } from './cosmetics.js';
import { resetTowDuck, stepTow, towDockSide } from './tow.js';

export const ARENA_R = 24;
export const ARENA_MODES = {
  tow: { name: 'Утка на буксире', sub: 'доставка в свою гавань', teams: 2, goal: 2, time: 90, theme: 'day', icon: '🦆',
    desc: 'Подплыви к утке на малой скорости, и трос зацепится сам. Затащи утку между буйками своего причала. Соперник может перехватить её, если подойдёт ближе буксира. Две доставки за 90 секунд.' },
  hunger1: { name: 'Голодные игры', sub: 'каждый сам за себя', per: 1, goal: 3, time: 180, theme: 'sunset', icon: '☠️', pickups: true, ko: true,
    desc: 'Каждый на своём плоту. Травит только коричневый дым: сначала пропукайся до коричневого, потом целься попой в чужое лицо — соперник отключится. Трижды вырубил — победил. Шипы на стенах лопают плот.' },
  hunger2: { name: 'Голодные игры', sub: 'пары', per: 2, goal: 3, time: 180, theme: 'lava', icon: '🤝', pickups: true, ko: true,
    desc: 'По двое на плоту. Напарника своей вонью не вырубить. Команда, первой трижды распердевшая соперников коричневым дымом, побеждает.' },
  shot: { name: 'Щелчок', sub: 'стрельба калом', per: 1, goal: 5, time: 180, theme: 'swamp', icon: '💩', shoot: true, pickups: true, ko: true,
    desc: 'Пробел — газ, E или правая кнопка мыши — выстрел калом из попы. Попал в чужого бегемота — он отключился, тебе очко. Выстрел тратит газ, греет попу и толкает плот, а за снарядом до конца раунда остаётся коричневый след. 5 попаданий — победа.' },
  shot2: { name: 'Щелчок', sub: 'пары', per: 2, goal: 6, time: 180, theme: 'sewer', icon: '🎯', shoot: true, pickups: true, ko: true,
    desc: 'Стрельба калом по двое на плоту: один рулит газом, другой стреляет — или оба сразу. В напарника не попасть. 6 попаданий команды — победа.' },
  king: { name: 'Царь горы', sub: 'удержи круг', per: 1, goal: 25, time: 180, theme: 'jungle', icon: '👑', pickups: true,
    desc: 'В центре пруда золотой круг. Кто стоит в нём один, получает очко каждую секунду. Выталкивайте соперников и травите их коричневым дымом. 25 очков — победа.' },
  royale: { name: 'Последний на плаву', sub: 'пруд сужается', per: 1, lives: 3, time: 150, theme: 'ice', icon: '🌀', shrink: true, pickups: true,
    desc: 'Весь бортик в шипах, и он сжимается. У каждого 3 жизни: лопнул — минус жизнь. Толкайтесь, травите вонью, выбивайте за борт. Последний на плаву — победитель.' },
  beans: { name: 'Бобовая охота', sub: 'собери бобы', per: 1, goal: 12, time: 150, theme: 'day', icon: '🫘', beans: true, pickups: true,
    desc: 'По пруду рассыпаны бобы. Подплыл — забрал: обычный боб — очко и полный газ, золотой — три очка. Перец разгоняет, прищепка спасает от вони. 12 очков — победа.' },
  bomb: { name: 'Вонючая бомба', sub: 'горячая картошка', per: 1, lives: 3, time: 180, theme: 'sewer', icon: '💣', bomb: true, pickups: true,
    desc: 'На одном плоту — вонючая бомба с горящим фитилём. Врежься в соперника, и бомба перескочит к нему. С бомбой плот плывёт чуть быстрее, чтобы было чем догонять. Не успел сбагрить — взрыв, плот лопается, минус жизнь. У каждого 3 жизни, последний на плаву побеждает.' },
  laps: { name: 'Кольцевая гонка', sub: '3 круга', per: 1, goal: 3, time: 240, theme: 'jungle', icon: '🏁', laps: true, pickups: true,
    desc: 'Гонка по кругу вокруг острова посреди пруда. Ворота — линии буйков от острова до берега, проплывайте их по порядку — ваши следующие ворота подсвечены. Толкаться и травить вонью можно. Кто первым проплывёт 3 круга — победил.' },
  zombie: { name: 'Зомби-пук', sub: 'заражение', per: 1, time: 150, theme: 'night', icon: '🧟', zombie: true, pickups: true,
    desc: 'Через несколько секунд после старта один плот заражается. Зомби врезается в здорового — тот тоже становится зомби. Здоровые получают очко за каждые 2 секунды жизни, зомби — 5 очков за каждого заражённого. Зомби плывут чуть быстрее. Когда время выйдет, побеждает тот, у кого больше очков.' },
  ball: { name: 'Пукобол', sub: 'две команды', teams: 2, goal: 3, time: 240, theme: 'day', icon: '⚽',
    desc: 'Две команды, два плота, один мяч. Пуками закатите мяч в чужие ворота. Вонь по-прежнему вырубает соперников. Три гола — победа.' },
};
export const MODE_KEYS = Object.keys(ARENA_MODES);
export const isArenaMode = (m) => !!ARENA_MODES[m];
export const KING_R = 4.5, BALL_R = 1.3, GOAL_HALF = 0.2;          // полуугол ворот (рад)
export const ROYALE_MIN_R = 9;
// Бонусы на воде (арена и сплав)
export const PICKUPS = {
  bean: { name: 'Боб', icon: '🫘', desc: 'полный газ' },
  gold: { name: 'Золотой боб', icon: '🌟', desc: 'полный газ и 3 очка' },
  pepper: { name: 'Острый перец', icon: '🌶️', desc: 'тяга в полтора раза сильнее 6 с', dur: 6 },
  clip: { name: 'Прищепка', icon: '📎', desc: 'не травишься вонью и не отключаешься 8 с', dur: 8 },
  stink: { name: 'Вонючка', icon: '🦨', desc: 'вокруг плота вспыхивает кольцо коричневой вони (своих не травит)' },
  magnet: { name: 'Магнит', icon: '🧲', desc: 'бонусы сами плывут к плоту 8 с', dur: 8 },
};
// События на арене (раз в полминуты, хост может выключить)
export const ARENA_EVENTS = {
  whirl: { name: 'Водоворот', icon: '🌀', desc: 'пруд закручивает к центру', dur: 10 },
  wind: { name: 'Ураганный ветер', icon: '🌬️', desc: 'всех сдувает в одну сторону', dur: 10 },
  rain: { name: 'Бобовый дождь', icon: '🫘', desc: 'с неба сыплются бобы', dur: 4 },
};
export const LAP_GATES = 6, LAP_R = 14.5, ISLAND_R = 5;
export const lapGateAng = (i) => (i / LAP_GATES) * Math.PI * 2;
export const BOOST_MULT = 1.5;
// Радиус пруда: в «Последнем на плаву» забор сжимается
export function arenaRadius(A, T) {
  if (A.radFixed != null) return A.radFixed;
  if (!A.M.shrink || !A.startT) return ARENA_R;
  const k = Math.max(0, Math.min(1, (T - A.startT - 12) / Math.max(10, A.M.time - 45)));
  return ARENA_R - k * (ARENA_R - ROYALE_MIN_R);
}

const NOOP = new Proxy({}, { get: () => () => {} });

// Раскладка арены: шипы на стенах и препятствия (одинаково на сервере и в браузере)
export function arenaLayout(mode, seed) {
  const rng = mulberry32((seed * 9301 + 49297) | 0);
  const spikes = [], obstacles = [];
  if (mode === 'tow') {
    const x = 6 + rng() * 2, z = 7 + rng() * 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) obstacles.push({ kind: 'buoy', x: sx * x, z: sz * z, r: 1.1 });
    return { spikes, obstacles, allSpikes: false };
  }
  if (mode === 'laps') {           // остров посередине, шипы на внешней стене, пара грибов на трассе
    const k = 4, off = rng() * Math.PI * 2;
    for (let i = 0; i < k; i++) { const c = off + i * Math.PI * 2 / k; spikes.push({ a0: c - 0.14, a1: c + 0.14 }); }
    obstacles.push({ kind: 'rock', x: 0, z: 0, r: ISLAND_R, island: true });
    for (let i = 0; i < 3; i++) { const a = lapGateAng(i * 2 + 1) + (rng() - 0.5) * 0.3, r = 12 + rng() * 6; obstacles.push({ kind: rng() < 0.5 ? 'mush' : 'buoy', x: Math.sin(a) * r, z: Math.cos(a) * r, r: 1.0 }); }
    return { spikes, obstacles, allSpikes: false };
  }
  if (mode !== 'ball') {
    const k = 4 + Math.floor(rng() * 2), off = rng() * Math.PI * 2;
    for (let i = 0; i < k; i++) { const c = off + i * Math.PI * 2 / k + (rng() - 0.5) * 0.3; spikes.push({ a0: c - 0.17, a1: c + 0.17 }); }
  }
  const sym = mode === 'ball' ? 2 : 3 + Math.floor(rng() * 2), off = rng() * Math.PI * 2;
  for (let i = 0; i < sym; i++) {
    const a = off + i * Math.PI * 2 / sym;
    const r1 = mode === 'king' ? 9.5 : 10 + rng() * 3;
    obstacles.push({ kind: rng() < 0.6 ? 'rock' : 'buoy', x: Math.sin(a) * r1, z: Math.cos(a) * r1, r: 1.0 + rng() * 0.5 });
    if (mode !== 'ball') { const a2 = a + Math.PI / sym; const r2 = 17 + rng() * 2; obstacles.push({ kind: 'mush', x: Math.sin(a2) * r2, z: Math.cos(a2) * r2, r: 1.1 }); }
  }
  if (mode === 'ball') for (const sx of [-1, 1]) obstacles.push({ kind: 'buoy', x: 0, z: sx * 13, r: 1.1 });
  const allSpikes = !!(ARENA_MODES[mode] && ARENA_MODES[mode].shrink);
  if (allSpikes) { spikes.length = 0; for (let i = obstacles.length - 1; i >= 0; i--) if (Math.hypot(obstacles[i].x, obstacles[i].z) > 8.5) obstacles.splice(i, 1); }
  return { spikes, obstacles, allSpikes };
}
export function spikeAt(L, ang) {
  if (L.allSpikes) return true;
  for (const s of L.spikes) { const d = wrapAngle(ang - (s.a0 + s.a1) / 2); if (Math.abs(d) < (s.a1 - s.a0) / 2) return true; }
  return false;
}

export function newArenaHippo(id) {
  return { id, raft: 0, seat: 0, team: 0, pos: 0, vel: 0, gas: 1, heat: 0, fartOn: false, fartStart: 0, lastFart: -99, idleSince: 0, overUntil: 0, stunUntil: 0, offUntil: 0, faintUntil: 0, faintCd: 0, needRelease: false, inAim: null, inCrawl: 0, inFart: false, dirt: 0, blobAcc: 0, sprayed: false };
}

// teams: [{ id, members: [playerId, ...] }]  — у каждой команды свой плот
export function createArena(mode, teams, seed = 1) {
  const M = ARENA_MODES[mode], L = arenaLayout(mode, seed);
  const A = { mode, M, L, seed, rafts: [], hippos: [], blobs: [], shots: [], pickups: [], pid: 1, pkId: 1, pkNext: 0, rules: { ...DEFAULT_RULES }, king: [], ball: null, ballFreeze: 0, startT: 0, radFixed: null, bomb: { raft: -1, until: 0, cd: 0, next: 0 }, event: null };
  const n = teams.length;
  teams.forEach((t, i) => {
    let ang = n > 0 ? i * Math.PI * 2 / n : 0;
    if (mode === 'ball') ang = i === 0 ? -Math.PI / 2 : Math.PI / 2;
    let sr = mode === 'ball' ? 12 : 15;
    const side = t.side ?? t.id;
    if (mode === 'tow') { ang = towDockSide(side) * Math.PI / 2; sr = 13; }
    if (mode === 'laps') { ang = -0.45; sr = 8 + i * 3.4; }
    const R = { id: i, team: t.id, shape: shapeOf(t.shape).id, S: shapeOf(t.shape), x: Math.sin(ang) * sr, z: Math.cos(ang) * sr, vx: 0, vz: 0, a: 0, w: 0, status: 0, statusT: 0, invulnUntil: 0, lastEject: -9, lastHitTeam: -1, lastHitT: -99, dirt: 0, spawnAng: ang, spawnR: sr, boostUntil: 0, shieldUntil: 0, magnetUntil: 0, out: false, inf: false, gate: 0, lap: 0, lastAng: ang, hippos: [] };
    if (mode === 'tow') R.side = side;
    t.members.forEach((pid, k) => { const h = newArenaHippo(pid); h.raft = i; h.seat = k; h.team = t.id; R.hippos.push(h); A.hippos.push(h); });
    A.rafts.push(R); A.king.push(0);
    resetArenaRaft(A, R, 0, false);
  });
  if (mode === 'ball') A.ball = { x: 0, z: 0, vx: 0, vz: 0, lastTeam: -1, lastT: -99 };
  if (mode === 'tow') A.duck = resetTowDuck({});
  return A;
}
const homePos = (k, n) => wrapAngle(sectorCenter(k, n));
// Плот на своё место: попой бегемоты смотрят наружу, чтобы пук вёз к центру
export function resetArenaRaft(A, R, T, invuln = true) {
  let ang = R.spawnAng, sr = A.mode === 'ball' ? 12 : Math.min(15, arenaRadius(A, T) - 4.5);
  if (A.mode === 'tow') sr = R.spawnR;
  if (A.mode === 'laps') {        // старт или последние пройденные ворота
    if (!R.started) { sr = R.spawnR; } else { ang = lapGateAng((R.gate + LAP_GATES - 1) % LAP_GATES) + 0.12; sr = LAP_R; }
    R.lastAng = ang;
  }
  R.x = Math.sin(ang) * sr; R.z = Math.cos(ang) * sr; R.vx = R.vz = R.w = 0; R.a = A.mode === 'laps' ? wrapAngle(ang - Math.PI / 2) : wrapAngle(ang - Math.PI);
  R.status = 0; R.invulnUntil = invuln ? T + 2 : 0; R.dirt = 0;
  const n = R.hippos.length;
  R.boostUntil = 0; R.shieldUntil = invuln ? T + 2 : 0;
  for (const h of R.hippos) { h.pos = homePos(h.seat, n); h.vel = 0; h.gas = 1; h.heat = 0; h.fartOn = false; h.overUntil = h.stunUntil = h.offUntil = h.faintUntil = 0; h.needRelease = false; h.dirt = 0; h.sprayed = false; h.shotCd = 0; }
}
export function arenaHippoWorld(A, h) {
  const R = A.rafts[h.raft], th = R.a + h.pos;
  const r = rimR(R.S, h.pos);
  return { th, x: R.x + Math.sin(th) * r, z: R.z + Math.cos(th) * r };
}

// mode: { canFart, physics, crawl, predict }
export function arenaStep(A, T, mode, ev) {
  const E = ev || NOOP, predict = !!mode.predict, rules = A.rules;
  for (const R of A.rafts) stepRaftHippos(A, R, T, mode, E, predict, rules);
  if (!mode.physics) return;
  const RAD = arenaRadius(A, T);
  for (const R of A.rafts) {
    if (R.status !== 0) {
      if (predict || R.out) continue;
      if (T - R.statusT > 2.2) { resetArenaRaft(A, R, T); E.respawn(R); }
      continue;
    }
    let ex = 0, ez = 0;
    const EVT = A.event;
    if (EVT && T < EVT.until) {
      if (EVT.k === 'wind') { ex = Math.sin(EVT.ang) * 2.8; ez = Math.cos(EVT.ang) * 2.8; }
      else if (EVT.k === 'whirl') { const d = Math.hypot(R.x, R.z) || 1, nx = -R.x / d, nz = -R.z / d; ex = nx * 1.8 + nz * 3.4; ez = nz * 1.8 - nx * 3.4; }
    }
    R.vx += ex * DT; R.vz += ez * DT;
    moveRaft(R, R.S, T, 0.9);
  }
  // плот о плот
  const live = A.rafts.filter(R => R.status === 0);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const P = live[i], Q = live[j], dx = Q.x - P.x, dz = Q.z - P.z, d = Math.hypot(dx, dz);
    const armP = supportDir(P.S, P.a, dx, dz), armQ = supportDir(Q.S, Q.a, -dx, -dz), minD = armP + armQ;
    if (d >= minD || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d, pen = (minD - d) / 2;
    P.x -= nx * pen; P.z -= nz * pen; Q.x += nx * pen; Q.z += nz * pen;
    if (!predict) onTouch(A, P, Q, T, E);
    const vrel = (Q.vx - P.vx) * nx + (Q.vz - P.vz) * nz;
    if (vrel >= 0) continue;
    const J = -(1 + PHYS.wallBounce) * vrel / 2;
    const inertiaP = PHYS.inertia * P.S.inertia, inertiaQ = PHYS.inertia * Q.S.inertia;
    const slip = (Q.vx - P.vx) * nz - (Q.vz - P.vz) * nx - P.w * armP - Q.w * armQ;
    const friction = 0.76 * slip / (2 + armP * armP / inertiaP + armQ * armQ / inertiaQ);
    const ix = J * nx - friction * nz, iz = J * nz + friction * nx;
    P.vx -= ix; P.vz -= iz; Q.vx += ix; Q.vz += iz;
    P.w += armP * friction / inertiaP; Q.w += armQ * friction / inertiaQ;
    limitRaftSpeed(P); limitRaftSpeed(Q);
    if (P.team !== Q.team) { P.lastHitTeam = Q.team; P.lastHitT = T; Q.lastHitTeam = P.team; Q.lastHitT = T; }
    if (!predict) { ejectCheck(A, P, T, -vrel, -nx, -nz, false, E); ejectCheck(A, Q, T, -vrel, nx, nz, false, E); if (-vrel > 3) E.bump(P, Q, -vrel); }
  }
  // стены, шипы, препятствия
  for (const R of live) {
    if (R.status !== 0) continue;
    const invuln = T < R.invulnUntil;
    const d = Math.hypot(R.x, R.z);
    const ext = supportDir(R.S, R.a, R.x, R.z);
    if (d + ext > RAD - (A.L.allSpikes ? PHYS.spikeReach * 0.6 : 0)) {
      const ang = Math.atan2(R.x, R.z);
      if (spikeAt(A.L, ang) && !invuln && !predict) { popRaft(A, R, T, E, 'spike'); continue; }
    }
    if (d + ext > RAD) {
      const nx = -R.x / d, nz = -R.z / d, pen = d + ext - RAD;
      R.x += nx * pen; R.z += nz * pen;
      contact(A, R, nx, nz, PHYS.wallBounce, false, T, E, predict);
    }
    for (const o of A.L.obstacles) {
      const dx = R.x - o.x, dz = R.z - o.z, dist = Math.hypot(dx, dz), minD = supportDir(R.S, R.a, -dx, -dz) + o.r + (o.kind === 'mush' ? PHYS.spikePad : 0);
      if (dist >= minD) continue;
      if (o.kind === 'mush' && !invuln && !predict) { popRaft(A, R, T, E, 'mush'); break; }
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      R.x += nx * (minD - dist); R.z += nz * (minD - dist);
      contact(A, R, nx, nz, o.kind === 'buoy' ? 1.25 : 0.3, o.kind === 'rock', T, E, predict);
    }
  }
  if (A.ball) stepBall(A, T, E, predict);
  if (A.duck) {
    const team = stepTow(A, T, RAD);
    if (team >= 0 && !predict) E.delivery(team);
  }
  if (predict) return;
  updateBlobs(A, T, E);
  updateShots(A, T, E, RAD);
  if (A.startT) { if (A.M.bomb) updateBomb(A, T, E); if (A.M.zombie) updateZombie(A, T, E); if (A.M.laps) updateLaps(A, T, E); }
  if (A.M.pickups) updatePickups(A, T, E, RAD);
  if (A.mode === 'king') {
    const inside = new Set();
    for (const R of A.rafts) if (R.status === 0 && Math.hypot(R.x, R.z) < KING_R && R.hippos.some(h => h.offUntil <= T && T >= h.faintUntil)) inside.add(R.team);
    A.kingTeam = inside.size === 1 ? [...inside][0] : inside.size > 1 ? -2 : -1;
    if (inside.size === 1) {
      const t = A.kingTeam, R = A.rafts.find(q => q.team === t);
      A.king[R.id] += DT;
      if (A.king[R.id] >= 1) { A.king[R.id] -= 1; E.kingPoint(t); }
    }
  }
}

function stepRaftHippos(A, R, T, mode, E, predict, rules) {
  R.fx = R.fz = R.tq = R.totalThrust = 0;
  const n = R.hippos.length, half = sectorHalf(n);
  for (const h of R.hippos) {
    const K = h.pk || NOMODS;
    if (h.offUntil > 0 && T >= h.offUntil) { h.offUntil = 0; h.pos = homePos(h.seat, n); h.vel = 0; E.back(h); }
    const off = h.offUntil > T, fainted = T < h.faintUntil;
    if (!off && !fainted && mode.crawl) {
      const c = sectorCenter(h.seat, n);
      let lp = wrapAngle(h.pos - c), lt = lp;
      if (h.inCrawl) lt = lp + h.inCrawl * 0.6;
      let diff;
      if (n <= 1) diff = wrapAngle(lt - lp); else { lt = Math.max(-half, Math.min(half, lt)); diff = lt - lp; }
      const cs = PHYS.crawlSpeed * K.crawl, want = Math.max(-cs, Math.min(cs, diff * 7));
      h.vel += (want - h.vel) * Math.min(1, DT * 12);
      let move = h.vel * DT;
      if (n > 1) { const nlp = Math.max(-half, Math.min(half, lp + move)); move = nlp - lp; if (nlp === half || nlp === -half) h.vel = 0; }
      h.pos = wrapAngle(h.pos + move);
      R.a = wrapAngle(R.a - move * PHYS.crawlReact);
    } else if (fainted) h.vel *= 0.9;
    if (!h.inFart) { h.needRelease = false; h.sprayed = false; }
    const blocked = off || fainted || T < h.overUntil || T < h.stunUntil || !mode.canFart || R.status !== 0;
    const wants = h.inFart && !blocked && !h.needRelease;
    if (wants && h.gas <= 0.001) h.needRelease = true;
    if (wants && h.gas > 0) {
      if (!h.fartOn) {
        if (!predict && rules.misfire > 0 && Math.random() < rules.misfire * K.misfire * (1 + h.heat) * (h.gas < 0.4 ? 1.6 : 1)) {
          h.stunUntil = T + PHYS.misfireFaint; h.faintUntil = T + PHYS.misfireFaint * K.faint; h.needRelease = true;
          h.dirt = Math.min(1, h.dirt + 0.5); R.dirt = Math.min(1, R.dirt + 0.15);
          stinkBurst(A, R, h, 2.4, 1.2); E.misfire(h);
          continue;
        }
        h.fartStart = T; h.heat = Math.min(1, h.heat + PHYS.heatStart); E.fartStart(h);
      }
      h.fartOn = true;
      h.gas = Math.max(0, h.gas - PHYS.gasDrain * K.drain * DT);
      h.heat = Math.min(1, h.heat + PHYS.heatRise * K.heat * DT);
      h.lastFart = T; h.idleSince = T;
      E.fartTick(h);
      if (h.heat >= 1) { h.overUntil = T + PHYS.overheatTime; h.fartOn = false; E.overheat(h); }
      if (h.gas <= 0) {
        if (!predict) {
          h.stunUntil = T + PHYS.shitStun; h.fartOn = false; h.needRelease = true;
          h.dirt = Math.min(1, h.dirt + 0.4); R.dirt = Math.min(1, R.dirt + 0.12);
          stinkBurst(A, R, h, 3.4, 1.6); E.shit(h);
        } else h.fartOn = false;
        continue;
      }
      const th = R.a + h.pos;
      const F = PHYS.thrust * K.thrust * (T - h.fartStart < PHYS.burstTime ? PHYS.burstMult : 1) * (T < R.boostUntil ? BOOST_MULT : 1) * (A.bomb.raft === R.id ? 1.15 : 1) * (R.inf ? 1.12 : 1);
      const rr = rimR(R.S, h.pos);
      addRaftJet(R, h, T, F, th, rr);
      // оружие — только коричневый дым (когда газа осталось меньше половины)
      const brown = Math.max(0, Math.min(1, (0.5 - h.gas) / 0.35));
      if (!predict && brown > 0.25) {
        h.blobAcc += DT;
        if (h.blobAcc >= PHYS.blobEvery) {
          h.blobAcc = 0;
          const ox = Math.sin(th), oz = Math.cos(th);
          A.blobs.push({ x: R.x + ox * (rr + 0.7), z: R.z + oz * (rr + 0.7), vx: ox * 6.5 * K.stink + R.vx * 0.5, vz: oz * 6.5 * K.stink + R.vz * 0.5, r: PHYS.blobR0, r1: PHYS.blobR1 * K.stink, life: PHYS.blobLife, age: 0, str: brown, owner: h.id, team: h.team });
          if (A.blobs.length > 120) A.blobs.shift();
        }
      }
    } else {
      h.fartOn = false;
      h.heat = Math.max(0, h.heat - PHYS.heatCool * K.cool * DT);
      if (T - (h.idleSince || 0) > PHYS.gasRegenDelay) h.gas = Math.min(1, h.gas + PHYS.gasRegen * K.regen * DT);
    }
    // Щелчок: выстрел калом из попы (на отдельную кнопку)
    if (A.M.shoot && h.inShoot && !predict && !off && !fainted && T >= h.overUntil && T >= h.stunUntil && mode.canFart && R.status === 0 && T >= (h.shotCd || 0) && h.gas >= PHYS.shotCost) {
      h.shotCd = T + PHYS.shotEvery * K.shotCd; h.gas -= PHYS.shotCost; h.idleSince = T; h.heat = Math.min(1, h.heat + PHYS.shotHeat);
      const th = R.a + h.pos, ox = Math.sin(th), oz = Math.cos(th), rr = rimR(R.S, h.pos);
      R.vx -= ox * PHYS.shotKick; R.vz -= oz * PHYS.shotKick;              // отдача толкает плот
      const p = { id: A.pid++, owner: h.id, team: h.team, x: R.x + ox * (rr + 0.6), z: R.z + oz * (rr + 0.6), vx: ox * PHYS.shotSpeed * K.shotSpeed + R.vx * 0.5, vz: oz * PHYS.shotSpeed * K.shotSpeed + R.vz * 0.5, t0: T, life: PHYS.shotLife * Math.sqrt(K.shotSpeed) };
      A.shots.push(p); E.shot(h, p);
      if (h.heat >= 1) { h.overUntil = T + PHYS.overheatTime; h.fartOn = false; E.overheat(h); }
    }
    if (!predict && rules.burps && !off && Math.random() < PHYS.burpPerSec * DT) E.burp(h);
  }
}
// Снаряды: летят по прямой (дугой — только для глаз), бьют чужих бегемотов
function updateShots(A, T, E, RAD) {
  for (const p of A.shots) {
    const age = T - p.t0, x = p.x + p.vx * age, z = p.z + p.vz * age;
    if (age >= p.life || Math.hypot(x, z) > RAD) { p.dead = true; E.shotLand(p, x, z, age >= p.life ? 'water' : 'wall'); continue; }
    for (const o of A.L.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + 0.15) { p.dead = true; E.shotLand(p, x, z, 'obstacle'); break; }
    if (p.dead) continue;
    for (const R of A.rafts) {
      if (R.status !== 0 || R.team === p.team) continue;
      for (const h of R.hippos) {
        if (h.offUntil > T) continue;
        const w = arenaHippoWorld(A, h);
        if (Math.hypot(x - w.x, z - w.z) > PHYS.shotHitR) continue;
        p.dead = true;
        h.dirt = Math.min(1, h.dirt + 0.35); R.dirt = Math.min(1, R.dirt + 0.1);
        if (T < R.shieldUntil) E.shotLand(p, x, z, 'shield');
        else if (T >= h.faintUntil && T >= h.faintCd) { const fk = (h.pk || NOMODS).faint; h.faintUntil = T + PHYS.shotFaint * fk; h.faintCd = T + PHYS.shotFaint * fk + 1; h.fartOn = false; E.shotHit(p, h, x, z); }
        else E.shotLand(p, x, z, 'hippo');
        break;
      }
      if (p.dead) break;
      if (Math.hypot(x - R.x, z - R.z) < supportDir(R.S, R.a, x - R.x, z - R.z)) { p.dead = true; R.dirt = Math.min(1, R.dirt + 0.08); E.shotLand(p, x, z, 'raft'); break; }
    }
  }
  if (A.shots.some(p => p.dead)) A.shots = A.shots.filter(p => !p.dead);
}
// Бонусы: появляются на воде, их забирает плот
function updatePickups(A, T, E, RAD) {
  const beans = !!A.M.beans, max = beans ? 6 : 2;
  if (A.pickups.length < max && T >= A.pkNext) {
    A.pkNext = T + (beans ? 1.6 : 9) + Math.random() * (beans ? 1.5 : 5);
    const r = Math.random();
    const kind = beans ? (r < 0.12 ? 'gold' : r < 0.78 ? 'bean' : r < 0.86 ? 'pepper' : r < 0.93 ? 'magnet' : 'clip') : (r < 0.3 ? 'bean' : r < 0.52 ? 'pepper' : r < 0.7 ? 'clip' : r < 0.86 ? 'stink' : 'magnet');
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (RAD - 4);
      const x = Math.sin(a) * d, z = Math.cos(a) * d;
      if (A.L.obstacles.some(o => Math.hypot(x - o.x, z - o.z) < o.r + 2)) continue;
      if (A.rafts.some(R => R.status === 0 && Math.hypot(x - R.x, z - R.z) < 5)) continue;
      A.pickups.push({ id: A.pkId++, kind, x, z, t0: T }); break;
    }
  }
  A.pickups = A.pickups.filter(pk => Math.hypot(pk.x, pk.z) < RAD - 1);
  for (const R of A.rafts) {            // магнит: бонусы сами плывут к плоту
    if (R.status !== 0 || T >= R.magnetUntil) continue;
    for (const pk of A.pickups) { const dx = R.x - pk.x, dz = R.z - pk.z, d = Math.hypot(dx, dz); if (d < 14 && d > 0.1) { const sp = Math.min(d, 7 * DT); pk.x += dx / d * sp; pk.z += dz / d * sp; } }
  }
  for (const R of A.rafts) {
    if (R.status !== 0 || R.out) continue;
    for (const pk of A.pickups) {
      if (pk.taken || Math.hypot(pk.x - R.x, pk.z - R.z) > supportDir(R.S, R.a, pk.x - R.x, pk.z - R.z) + 0.7) continue;
      pk.taken = true;
      applyPickup(R, pk.kind, T);
      if (pk.kind === 'stink') stinkRing(A, R, R.hippos[0], 3.0, 1.8);
      E.pickup(R, pk);
    }
  }
  if (A.pickups.some(pk => pk.taken)) A.pickups = A.pickups.filter(pk => !pk.taken);
}
export function applyPickup(R, kind, T) {
  const pm = Math.max(1, ...R.hippos.map(h => (h.pk || NOMODS).pickup));
  if (kind === 'bean' || kind === 'gold') for (const h of R.hippos) { h.gas = 1; h.needRelease = false; }
  if (kind === 'pepper') R.boostUntil = T + PICKUPS.pepper.dur * pm;
  if (kind === 'clip') R.shieldUntil = T + PICKUPS.clip.dur * pm;
  if (kind === 'magnet') R.magnetUntil = T + PICKUPS.magnet.dur * pm;
}
// Щелчок или холостой — облако вони вокруг попы, бьёт сильнее обычного
function stinkBurst(A, R, h, r1, life) {
  const th = R.a + h.pos, ox = Math.sin(th), oz = Math.cos(th), rr = rimR(R.S, h.pos);
  A.blobs.push({ x: R.x + ox * (rr + 1.2), z: R.z + oz * (rr + 1.2), vx: ox * 2 + R.vx * 0.5, vz: oz * 2 + R.vz * 0.5, r: 1.2, r1, life, age: 0, str: 1, owner: h.id, team: h.team, big: true });
}
function popRaft(A, R, T, E, cause) {
  R.status = 1; R.statusT = T;
  for (const h of R.hippos) h.fartOn = false;
  const by = T - R.lastHitT < 5 ? R.lastHitTeam : -1;
  E.pop(R, cause, by);
}
function contact(A, R, nx, nz, e, hard, T, E, predict) {
  const vn = R.vx * nx + R.vz * nz;
  if (vn >= 0) return 0;
  if (!predict) ejectCheck(A, R, T, -vn, nx, nz, hard, E);
  bounceRaft(R, R.S, nx, nz, 0, 0, e, vn);
  return -vn;
}
function ejectCheck(A, R, T, speed, nx, nz, hard, E) {
  const thr = (hard ? PHYS.ejectHard : PHYS.ejectSoft * 0.85) * R.S.eject;
  if (speed < thr || T - R.lastEject < 0.5) return;
  R.lastEject = T;
  const base = Math.min(0.95, 0.35 + (speed - thr) / 5), contactAng = Math.atan2(-nx, -nz), sp = Math.hypot(R.vx, R.vz) || 1;
  for (const h of R.hippos) {
    if (h.offUntil > T || speed < thr * (h.pk || NOMODS).eject) continue;
    const da = Math.abs(wrapAngle(R.a + h.pos - contactAng));
    if (Math.random() < (da < 1.9 ? base : base * 0.3)) {
      h.offUntil = T + PHYS.offTime; h.fartOn = false;
      const w = arenaHippoWorld(A, h);
      const dx = -nx * 0.6 + (R.vx / sp) * 0.4 + (Math.random() - 0.5) * 0.5, dz = -nz * 0.6 + (R.vz / sp) * 0.4 + (Math.random() - 0.5) * 0.5, dl = Math.hypot(dx, dz) || 1;
      E.eject(h, w.x, w.z, dx / dl, dz / dl, R.lastHitT > T - 1 ? R.lastHitTeam : -1);
    }
  }
}
function stepBall(A, T, E, predict) {
  const B = A.ball;
  if (T < A.ballFreeze) return;
  const k = Math.exp(-0.55 * DT); B.vx *= k; B.vz *= k;
  B.x += B.vx * DT; B.z += B.vz * DT;
  for (const R of A.rafts) {
    if (R.status !== 0) continue;
    const dx = B.x - R.x, dz = B.z - R.z, d = Math.hypot(dx, dz), minD = supportDir(R.S, R.a, dx, dz) + BALL_R;
    if (d >= minD || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d;
    B.x += nx * (minD - d) * 0.8; B.z += nz * (minD - d) * 0.8; R.x -= nx * (minD - d) * 0.2; R.z -= nz * (minD - d) * 0.2;
    const vrel = (B.vx - R.vx) * nx + (B.vz - R.vz) * nz;
    if (vrel < 0) {
      const mb = 0.35, J = -(1 + 0.75) * vrel / (1 + 1 / mb);
      B.vx += (J / mb) * nx; B.vz += (J / mb) * nz; R.vx -= J * nx; R.vz -= J * nz;
      limitRaftSpeed(R);
    }
    B.lastTeam = R.team; B.lastT = T;
  }
  for (const o of A.L.obstacles) {
    const dx = B.x - o.x, dz = B.z - o.z, d = Math.hypot(dx, dz), minD = BALL_R + o.r;
    if (d >= minD) continue;
    const nx = dx / (d || 1), nz = dz / (d || 1); B.x += nx * (minD - d); B.z += nz * (minD - d);
    const vn = B.vx * nx + B.vz * nz; if (vn < 0) { B.vx -= 1.8 * vn * nx; B.vz -= 1.8 * vn * nz; }
  }
  const d = Math.hypot(B.x, B.z);
  if (d + BALL_R > ARENA_R) {
    const ang = Math.atan2(B.x, B.z);
    // ворота: на востоке (угол +π/2) защищает команда 1, на западе — команда 0
    const goalSide = Math.abs(wrapAngle(ang - Math.PI / 2)) < GOAL_HALF ? 1 : Math.abs(wrapAngle(ang + Math.PI / 2)) < GOAL_HALF ? 0 : -1;
    if (goalSide >= 0) {
      if (d > ARENA_R + 1.2 && !predict) { E.goal(goalSide === 1 ? 0 : 1, B.lastTeam); A.ballFreeze = T + 1.6; }
      if (d > ARENA_R + 2.5) { B.x *= (ARENA_R + 2.5) / d; B.z *= (ARENA_R + 2.5) / d; B.vx *= 0.3; B.vz *= 0.3; }
    } else {
      const nx = -B.x / d, nz = -B.z / d; B.x += nx * (d + BALL_R - ARENA_R); B.z += nz * (d + BALL_R - ARENA_R);
      const vn = B.vx * nx + B.vz * nz; if (vn < 0) { B.vx -= 1.6 * vn * nx; B.vz -= 1.6 * vn * nz; }
    }
  }
}
export function resetBall(A, T) {
  Object.assign(A.ball, { x: 0, z: 0, vx: 0, vz: 0, lastTeam: -1 });
  for (const R of A.rafts) resetArenaRaft(A, R, T);
  A.ballFreeze = T + 1.0;
}
function updateBlobs(A, T, E) {
  const k = Math.exp(-1.6 * DT);
  for (const b of A.blobs) { b.age += DT; b.vx *= k; b.vz *= k; b.x += b.vx * DT; b.z += b.vz * DT; b.r = (b.big ? 1.2 : PHYS.blobR0) + (b.r1 - (b.big ? 1.2 : PHYS.blobR0)) * Math.min(1, b.age / b.life); }
  A.blobs = A.blobs.filter(b => b.age < b.life);
  const ft = A.rules.faintTime || 3;
  for (const R of A.rafts) {
    if (R.status !== 0 || T < R.shieldUntil) continue;
    for (const h of R.hippos) {
      if (h.offUntil > T || T < h.faintUntil || T < h.faintCd) continue;
      const K = h.pk || NOMODS;
      const th = R.a + h.pos, fr = rimR(R.S, h.pos) - 0.5, fx = R.x + Math.sin(th) * fr, fz = R.z + Math.cos(th) * fr;
      for (const b of A.blobs) {
        if (b.team === h.team || b.str < 0.3 * K.stinkRes) continue;     // своих не травим, слабая вонь не валит
        if (Math.hypot(fx - b.x, fz - b.z) < b.r * 0.85) {
          h.faintUntil = T + ft * K.faint; h.faintCd = T + ft * K.faint + 2; h.fartOn = false; h.dirt = Math.min(1, h.dirt + 0.1);
          E.faint(h, b.owner, b.team, !!b.mega);
          break;
        }
      }
    }
  }
}

// Мега-пук: ударная волна расталкивает чужие плоты, вокруг — кольцо густого коричневого дыма
export const MEGA_R = 9;
export function megaFart(A, R, h, T) {
  const th = R.a + h.pos, ox = Math.sin(th), oz = Math.cos(th), rr = rimR(R.S, h.pos);
  kickRaft(R, R.S, h, T, 7);
  h.gas = 1; h.heat = Math.max(0, h.heat - 0.3); h.needRelease = true;
  const hit = [];
  for (const Q of A.rafts) {
    if (Q === R || Q.status !== 0 || Q.out) continue;
    const dx = Q.x - R.x, dz = Q.z - R.z, d = Math.hypot(dx, dz);
    if (d > MEGA_R || d < 1e-3) continue;
    const k = 1 - d / MEGA_R, push = 3 + 10 * k;
    Q.vx += dx / d * push; Q.vz += dz / d * push;
    Q.w += (dx * oz - dz * ox) / d * 3 * k / Q.S.inertia;
    limitRaftSpeed(Q);
    if (Q.team !== R.team) { Q.lastHitTeam = R.team; Q.lastHitT = T; hit.push(Q.id); }
  }
  for (let i = 0; i < 10; i++) {
    const a = th + (i / 10) * Math.PI * 2, bx = Math.sin(a), bz = Math.cos(a), br = rimR(R.S, a - R.a) + 1.1;
    A.blobs.push({ x: R.x + bx * br, z: R.z + bz * br, vx: bx * 7 + R.vx * 0.3, vz: bz * 7 + R.vz * 0.3, r: 1.2, r1: 3.2, life: 2.2, age: 0, str: 1, owner: h.id, team: h.team, big: true, mega: true });
  }
  if (A.blobs.length > 140) A.blobs.splice(0, A.blobs.length - 140);
  return { x: R.x + ox * (rr + 0.8), z: R.z + oz * (rr + 0.8), cx: R.x, cz: R.z, hit };
}

// Кольцо вони вокруг плота (бонус «вонючка», взрыв бомбы)
export function stinkRing(A, R, h, r1 = 3, life = 1.8, n = 9, sp = 6) {
  if (!h) return;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, bx = Math.sin(a), bz = Math.cos(a), br = rimR(R.S, a - R.a) + 1.0;
    A.blobs.push({ x: R.x + bx * br, z: R.z + bz * br, vx: bx * sp + R.vx * 0.3, vz: bz * sp + R.vz * 0.3, r: 1.1, r1, life, age: 0, str: 1, owner: h.id, team: h.team, big: true });
  }
  if (A.blobs.length > 140) A.blobs.splice(0, A.blobs.length - 140);
}
const alive = (R) => R.status === 0 && !R.out;
// Касание плотов: бомба перескакивает, зомби заражает
function onTouch(A, P, Q, T, E) {
  if (A.M.bomb && T >= A.bomb.cd && T > A.startT + 0.5) {
    const B = A.bomb;
    if (B.raft === P.id && alive(Q)) { B.raft = Q.id; B.cd = T + 0.8; E.bombPass(P, Q); }
    else if (B.raft === Q.id && alive(P)) { B.raft = P.id; B.cd = T + 0.8; E.bombPass(Q, P); }
  }
  if (A.M.zombie) {
    if (P.inf && !Q.inf && alive(Q) && T >= (Q.invulnUntil || 0)) { Q.inf = true; E.infect(Q, P); }
    else if (Q.inf && !P.inf && alive(P) && T >= (P.invulnUntil || 0)) { P.inf = true; E.infect(P, Q); }
  }
}
function updateBomb(A, T, E) {
  const B = A.bomb, live = A.rafts.filter(alive);
  if (B.raft >= 0) {
    const R = A.rafts[B.raft];
    if (!R || !alive(R)) { B.raft = -1; B.next = T + 2; return; }       // плот лопнул сам — бомба пропала
    if (T >= B.until) {
      stinkRing(A, R, R.hippos[0], 4.5, 2.2, 12, 8);
      E.bombBoom(R);
      popRaft(A, R, T, E, 'bomb');
      B.raft = -1; B.next = T + 3;
    }
    return;
  }
  if (T >= B.next && live.length >= 1 && T > A.startT + 2) {
    const pool = live.length > 1 ? live : live, R = pool[(Math.random() * pool.length) | 0];
    B.raft = R.id; B.until = T + 13 + Math.random() * 8; B.cd = T + 1.5;
    E.bombNew(R, B.until - T);
  }
}
function updateZombie(A, T, E) {
  if (A.rafts.some(R => R.inf) || T < A.startT + 4) return;
  const live = A.rafts.filter(alive); if (!live.length) return;
  const R = live[(Math.random() * live.length) | 0];
  R.inf = true; E.infect(R, null);
}
function updateLaps(A, T, E) {
  for (const R of A.rafts) {
    if (!alive(R)) continue;
    const ang = Math.atan2(R.x, R.z), g = lapGateAng(R.gate);
    const before = wrapAngle(R.lastAng - g), after = wrapAngle(ang - g);
    R.lastAng = ang;
    if (before < 0 && after >= 0 && after < 0.8 && Math.hypot(R.x, R.z) > ISLAND_R) {
      const c = R.gate; R.gate = (c + 1) % LAP_GATES;
      if (c === 0 && R.started) { R.lap++; E.lap(R); } else { R.started = true; E.gate(R); }
    }
  }
}
