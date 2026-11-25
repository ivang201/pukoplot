import { DT, limitRaftSpeed, supportDir } from './shared.js';

// X/Z и длины — в метрах, скорости — м/с, lockUntil — абсолютное время симуляции.
export const TOW_DOCK_X = 16, TOW_DOCK_HALF = 3.6, TOW_DUCK_R = 0.9;
export const TOW_REST = 3.25, TOW_PICKUP = 3.2, TOW_CATCH_SPEED = 3.2;
export const towDockSide = side => side === 0 ? -1 : 1;
const MASS = 0.32, BREAK_DISTANCE = 7, CLAIM_LEAD = 0.45;

export function resetTowDuck(duck, T = 0, delay = 0) {
  return Object.assign(duck, { x: 0, z: 0, vx: 0, vz: 0, owner: -1, lockUntil: T + delay });
}

export function towSnapshot(duck) {
  const round = value => Math.round(value * 1000) / 1000;
  return [round(duck.x), round(duck.z), round(duck.vx), round(duck.vz), duck.owner, round(duck.lockUntil)];
}

export function loadTowSnapshot(duck, packet) {
  [duck.x, duck.z, duck.vx, duck.vz, duck.owner, duck.lockUntil] = packet;
}

function canTow(raft, T) {
  return raft.status === 0 && !raft.out && raft.hippos.some(h => h.offUntil <= T && h.faintUntil <= T);
}

function chooseOwner(A, owner, T) {
  const duck = A.duck;
  let closest = null, first = Infinity, second = Infinity;
  for (const raft of A.rafts) {
    if (raft === owner || !canTow(raft, T)) continue;
    const distance = Math.hypot(raft.x - duck.x, raft.z - duck.z);
    if (distance > TOW_PICKUP || Math.hypot(raft.vx - duck.vx, raft.vz - duck.vz) > TOW_CATCH_SPEED) continue;
    if (distance < first) { second = first; first = distance; closest = raft; }
    else second = Math.min(second, distance);
  }
  // Одинаково близкие плоты оставляют утку свободной. Для перехвата надо оказаться ближе буксира.
  if (!closest || second - first < CLAIM_LEAD) return owner;
  if (owner && first + CLAIM_LEAD >= Math.hypot(owner.x - duck.x, owner.z - duck.z)) return owner;
  return closest;
}

function tension(duck, raft) {
  const dx = raft.x - duck.x, dz = raft.z - duck.z, distance = Math.hypot(dx, dz);
  if (distance <= TOW_REST) return;
  const nx = dx / distance, nz = dz / distance;
  const separation = (raft.vx - duck.vx) * nx + (raft.vz - duck.vz) * nz;
  const change = Math.max(0, Math.min(22, 12 * (distance - TOW_REST) + 3.4 * separation)) * DT;
  duck.vx += change * nx; duck.vz += change * nz;
  raft.vx -= MASS * change * nx; raft.vz -= MASS * change * nz;
  limitRaftSpeed(raft);
}

function raftContacts(A, T) {
  const duck = A.duck;
  let correctionX = 0, correctionZ = 0, dvx = 0, dvz = 0;
  for (const raft of A.rafts) {
    if (raft.status !== 0 || raft.out) continue;
    const dx = duck.x - raft.x, dz = duck.z - raft.z, distance = Math.hypot(dx, dz);
    const nx = distance > 1e-6 ? dx / distance : -towDockSide(raft.side), nz = distance > 1e-6 ? dz / distance : 0;
    const penetration = supportDir(raft.S, raft.a, nx, nz) + TOW_DUCK_R - distance;
    if (penetration <= 0) continue;
    correctionX += nx * penetration; correctionZ += nz * penetration;
    const vn = (duck.vx - raft.vx) * nx + (duck.vz - raft.vz) * nz;
    if (vn >= 0) continue;
    const impulse = -1.35 * vn / (1 + MASS);
    dvx += impulse * nx; dvz += impulse * nz;
    raft.vx -= MASS * impulse * nx; raft.vz -= MASS * impulse * nz;
    limitRaftSpeed(raft);
    if (-vn > 6 && duck.owner !== raft.id) {
      duck.owner = -1; duck.lockUntil = Math.max(duck.lockUntil, T + 0.45);
    }
  }
  // Все контакты одного такта используют одну исходную позицию, в том числе при встречной атаке.
  duck.x += correctionX; duck.z += correctionZ; duck.vx += dvx; duck.vz += dvz;
}

function staticContact(duck, nx, nz, penetration) {
  duck.x += penetration * nx; duck.z += penetration * nz;
  const vn = duck.vx * nx + duck.vz * nz;
  if (vn < 0) { duck.vx -= 1.35 * vn * nx; duck.vz -= 1.35 * vn * nz; }
}

export function stepTow(A, T, arenaRadius) {
  const duck = A.duck;
  let owner = duck.owner < 0 ? null : A.rafts.find(r => r.id === duck.owner);
  if (duck.owner >= 0 && (!owner || !canTow(owner, T) || Math.hypot(duck.x - owner.x, duck.z - owner.z) > BREAK_DISTANCE)) {
    owner = null; duck.owner = -1; duck.lockUntil = T + 0.45;
  }
  if (T >= duck.lockUntil) {
    const next = chooseOwner(A, owner, T);
    if (next !== owner) { owner = next; duck.owner = next.id; duck.lockUntil = T + 0.9; }
  }
  if (owner) tension(duck, owner);
  const drag = Math.exp(-0.65 * DT);
  duck.vx *= drag; duck.vz *= drag;
  duck.x += duck.vx * DT; duck.z += duck.vz * DT;
  raftContacts(A, T);
  for (const buoy of A.L.obstacles) {
    const dx = duck.x - buoy.x, dz = duck.z - buoy.z, d = Math.hypot(dx, dz);
    const overlap = TOW_DUCK_R + buoy.r - d;
    if (overlap > 0) staticContact(duck, d > 1e-6 ? dx / d : 0, d > 1e-6 ? dz / d : 1, overlap);
  }
  const d = Math.hypot(duck.x, duck.z), wall = arenaRadius - TOW_DUCK_R;
  if (d > wall) staticContact(duck, -duck.x / d, -duck.z / d, d - wall);
  if (owner && duck.owner === owner.id && towDockSide(owner.side) * duck.x >= TOW_DOCK_X && Math.abs(duck.z) <= TOW_DOCK_HALF) {
    resetTowDuck(duck, T, 1.25);
    return owner.team;
  }
  return -1;
}
