// node scripts/check-tow.mjs
import assert from 'node:assert/strict';
import { DT, wrapAngle } from '../public/shared.js';
import { ARENA_MODES, ARENA_R, arenaLayout, createArena, arenaStep, resetArenaRaft } from '../public/arena.js';
import { Predictor } from '../public/predict.js';
import { TOW_DOCK_X, TOW_DOCK_HALF, TOW_DUCK_R, resetTowDuck, towSnapshot, stepTow } from '../public/tow.js';

const teams = [{ id: 0, members: [11], side: 0 }, { id: 1, members: [22], side: 1 }];
const play = { canFart: true, physics: true, crawl: true, predict: false };
function world(roster = teams) {
  const A = createArena('tow', roster, 22);
  Object.assign(A.rules, { misfire: 0, burps: false, faint: false });
  return A;
}
function place(raft, x, z = 0, vx = 0) { Object.assign(raft, { x, z, vx, vz: 0, w: 0 }); }
function events(onDelivery) { return new Proxy({ delivery: onDelivery }, { get: (o, key) => o[key] ?? (() => {}) }); }
function close(a, b, tol = 1e-8) { assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`); }

const layout = arenaLayout('tow', 22);
assert.deepEqual(layout, arenaLayout('tow', 22));
assert.ok(!layout.spikes.length && !layout.allSpikes);
for (const o of layout.obstacles) {
  assert.ok(layout.obstacles.some(p => p.x === -o.x && p.z === o.z));
  assert.ok(Math.abs(o.z) - o.r > TOW_DOCK_HALF + 1.9, 'Fair central approach');
}

for (const reverse of [false, true]) {
  const A = world(), [left, right] = A.rafts;
  place(left, -3); place(right, 3);
  if (reverse) A.rafts.reverse();
  stepTow(A, 1, ARENA_R); assert.equal(A.duck.owner, -1, 'A tied contest stays neutral');
  place(right, 4); stepTow(A, 1 + DT, ARENA_R); assert.equal(A.duck.owner, left.id);
  place(left, -4); place(right, 2.95);
  stepTow(A, 1.1, ARENA_R); assert.equal(A.duck.owner, left.id, 'Fresh tow has a short grace period');
  stepTow(A, 2.1, ARENA_R); assert.equal(A.duck.owner, right.id, 'A closer opponent steals');
  right.hippos[0].faintUntil = 5;
  stepTow(A, 2.2, ARENA_R); assert.equal(A.duck.owner, -1, 'Unconscious crew releases the line');
}
{
  const A = world(), [left,right] = A.rafts;
  place(right, 13); place(left, -3, 0, 8);
  stepTow(A, 1, ARENA_R); assert.equal(A.duck.owner, -1, 'A fast approach cannot hook');
  Object.assign(A.duck, { owner: left.id, lockUntil: 5 });
  place(left, -4.8); place(right, 12);
  stepTow(A, 2, ARENA_R); assert.ok(A.duck.vx < 0 && left.vx > 0, 'The tether pulls both bodies');
  const forceChange = -A.duck.vx / Math.exp(-.65 * DT);
  close(left.vx, .32 * forceChange);
  place(left, -10); stepTow(A, 2.1, ARENA_R); assert.equal(A.duck.owner, -1, 'Overstretched tow releases');
  place(left, -4); place(right, 2.6, 0, -8);
  Object.assign(A.duck, { owner: left.id, lockUntil: 5, x: 0, z: 0, vx: 0, vz: 0 });
  stepTow(A, 3, ARENA_R); assert.equal(A.duck.owner, -1, 'Hard opposing impact releases');
  resetTowDuck(A.duck); Object.assign(A.duck, { x: 24, vx: 8 });
  stepTow(A, 4, ARENA_R); close(A.duck.x, ARENA_R - TOW_DUCK_R); assert.ok(A.duck.vx < 0);
}

for (const side of [0, 1]) {
  const A = world([{id: 0, members: [1], side}]), R = A.rafts[0], sign = side === 0 ? -1 : 1;
  close(R.x, sign * 13);
  resetArenaRaft(A, R, 2); close(R.x, sign * 13);
  const scored = [], E = events(team => scored.push(team));
  for (const [raftX, duckX, z, owner] of [[19,15,0,0],[-20,-17,0,0],[20,17,5,0],[20,17,0,-1]]) {
    place(R, sign * raftX, z);
    Object.assign(A.duck, { x: sign * duckX, z, vx: 0, vz: 0, owner, lockUntil: 10 });
    arenaStep(A, 3, play, E); assert.deepEqual(scored, [], 'Only the attached duck in its own gate counts');
  }
  place(R, sign * 20); Object.assign(A.duck, { x: sign * (TOW_DOCK_X+.3), owner: 0, lockUntil: 10 });
  arenaStep(A, 3.1, { ...play, predict: true }, E);
  assert.deepEqual(scored, [], 'Prediction resets the duck without publishing the score');
  Object.assign(A.duck, { x: sign * (TOW_DOCK_X+.3), owner: 0, lockUntil: 10 });
  arenaStep(A, 3.2, play, E); assert.deepEqual(scored, [0], 'Score follows logical team after a rematch');
  assert.deepEqual(towSnapshot(A.duck), [0,0,0,0,-1,4.45]);
  for (let i=1; i<=120; i++) arenaStep(A, 3.2+i*DT, play, E);
  assert.deepEqual(scored, [0], 'The same delivery only counts once');
}

// Восстановление пакета в настоящий Predictor и повтор прогноза по тому же снимку.
{
  const A = world(), P = new Predictor(), B = world();
  place(A.rafts[0], -4.6, 0, -1);
  Object.assign(A.duck, { x: -.1, vx: -.17, owner: 0, lockUntil: 11.75 });
  const packet = { t:'a', mode:'tow', T:10, ph:'race', rad:ARENA_R, duck:towSnapshot(A.duck),
    r:A.rafts.map(r=>[r.id,r.x,r.z,r.a,r.w,r.vx,r.vz,0,0,0,0]),
    hp:A.hippos.map(h=>[h.id,h.raft,h.seat,h.pos,h.vel,0,1,0,0,0]) };
  P.setArena(B); P.onSnap(packet,10);
  P.run(10.1);
  const steps = P.steps;
  assert.ok(steps >= 5);
  for (let i=1; i<=steps; i++) arenaStep(A,10+i*DT,play);
  const expected = towSnapshot(A.duck);
  assert.deepEqual(towSnapshot(B.duck), expected);
  Object.assign(B.duck,{x:100,owner:-1,lockUntil:99});
  P.run(10.1); assert.deepEqual(towSnapshot(B.duck), expected, 'Snapshot rewinds every persistent tow field');
  assert.ok(P.onSnap({ ...packet, T: 10.1, waiting: true }, 10.11));
  P.run(10.35);
  assert.deepEqual(towSnapshot(B.duck), packet.duck, 'Waiting for a crew freezes the tow on the client');
  assert.equal(P.rem, 0, 'Do not extrapolate a paused raft between ticks');
  P.setArena(world([{id:0,side:1,members:[11]}])); assert.equal(P.snap,null);
}

// Полные две доставки без телепортов: бот использует только поворот бегемота и газ.
const A = world([teams[0]]), R = A.rafts[0], h = R.hippos[0], times = [];
let tick = 0;
const E = events(team => { assert.equal(team, 0); times.push(tick * DT); });
for (tick = 1; tick * DT <= ARENA_MODES.tow.time && times.length < ARENA_MODES.tow.goal; tick++) {
  const towing = A.duck.owner === R.id;
  const dx = (towing ? -21 : A.duck.x) - R.x, dz = (towing ? 0 : A.duck.z) - R.z;
  const error = wrapAngle(Math.atan2(dx,dz) - (R.a + h.pos + Math.PI));
  h.inCrawl = Math.abs(error) > .07 ? Math.sign(error) : 0;
  h.inFart = Math.abs(error) < .35 && Math.hypot(R.vx,R.vz) < (towing ? 4.4 : 2.4) && h.gas > .15;
  arenaStep(A, tick*DT, play, E);
}
assert.equal(times.length, 2, `Solo trainer only made ${times.length} deliveries`);
console.log(`Tow passes: mirrors, contact, release, steal, gate, snapshot. Solo deliveries: ${times.map(t=>t.toFixed(2)).join(', ')} s.`);
