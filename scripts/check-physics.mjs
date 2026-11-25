// node scripts/check-physics.mjs
import assert from 'node:assert/strict';
import { DT, createWorld, newHippo, resetRaft, simStep, raceMega } from '../public/sim.js';
import { ARENA_R, createArena, arenaStep, megaFart } from '../public/arena.js';
import { PHYS, shapeOf, supportDir } from '../public/shared.js';
import { Predictor } from '../public/predict.js';

const RULES = { misfire: 0, burps: false, pickups: false, faint: false };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

// A straight river avoids bends, incidental contacts and level modifiers.
function fixture(kind, crew = 1, shape = 'round', predict = false, current = 0) {
  let world, raft, step;
  if (kind === 'river') {
    const N = 101, zeros = Array(N).fill(0);
    const track = {
      N, length: N - 1, X: zeros, H: zeros, W: Array(N).fill(48), Z: Array.from(zeros.keys()),
      spikeL: zeros, spikeR: zeros, gapL: zeros, gapR: zeros,
      L: { current, obstacles: [], checkpoints: [] },
    };
    world = createWorld(track);
    Object.assign(world.rules, RULES, { raft: shape });
    for (let i = 0; i < crew; i++) world.hippos.push(Object.assign(newHippo(i + 1), { seat: i }));
    resetRaft(world, 30); raft = world.raft; step = simStep;
  } else {
    const members = Array.from({length: crew}, (_, i) => i + 1);
    world = createArena('king', [{id: 0, members, shape}], 42);
    Object.assign(world.rules, RULES);
    world.L.obstacles = []; world.L.spikes = []; world.pkNext = Infinity;
    raft = world.rafts[0]; step = arenaStep;
    Object.assign(raft, {x: 0, z: 0, a: 0});
  }
  let tick = 0;
  const mode = { physics: true, canFart: true, crawl: true, predict };
  function advance(count) {
    for (let i = 0; i < count; i++) step(world, ++tick * DT, mode);
  }
  return { world, raft, crew: world.hippos, advance };
}

function measure(kind, predict = false, shape = 'round') {
  const make = (crew = 1) => fixture(kind, crew, shape, predict);
  const burst = make(), h = burst.crew[0], start = burst.raft.z;
  h.inFart = true; burst.advance(12);
  const tapSpeed = burst.raft.vz;
  h.inFart = false; burst.advance(48);

  const skid = make();
  skid.raft.vx = 6; skid.crew[0].inFart = true; skid.advance(45);
  const turn = make();
  turn.crew[0].inFart = true; turn.crew[0].inCrawl = 1; turn.advance(45);
  const twist = make(2);
  twist.crew[0].inFart = true; twist.advance(12); twist.crew[1].inFart = true;
  let opposedPeak = 0;
  for (let i = 0; i < 60; i++) {
    twist.advance(1); opposedPeak = Math.max(opposedPeak, Math.abs(twist.raft.w));
  }
  const wall = make();
  const wallX = ARENA_R - supportDir(shapeOf(shape), 0, 1, 0);
  Object.assign(wall.raft, {x: wallX - 0.02, vx: 6, vz: 4});
  wall.advance(1);
  const rebound = wall.raft.vx, impactSpin = wall.raft.w;
  wall.advance(29);
  assert.ok(rebound < 0 && wall.raft.x < wallX - 0.3 && wall.raft.status === 0);
  const fast = make();
  fast.raft.vx = 90; fast.raft.vz = 30; fast.advance(1);
  close(Math.hypot(fast.raft.vx, fast.raft.vz), PHYS.maxSpeed);
  return {
    tapSpeed, tapAndCoastMetres: burst.raft.z - start,
    crossingDriftMetres: skid.raft.x, crossingYawRad: skid.raft.a,
    steeringYawRad: turn.raft.a, opposedPeakRadSec: opposedPeak,
    wallReboundMps: rebound, wallSpinRadSec: impactSpin,
  };
}

// Check the actual browser predictor against six authoritative ticks from
// a rounded wire snapshot during a held turn. 5 mm includes the 0.001 m
// pose and 0.01 m/s velocity quantisation propagated for 100 ms.
function checkSnapshot(kind) {
  const server = fixture(kind), client = fixture(kind);
  const h = server.crew[0], r = server.raft;
  h.inFart = true; h.inCrawl = 1; server.advance(30);
  const q = (v, n) => Number(v.toFixed(n));
  const motion = [q(h.pos, 3), q(h.vel, 2), 1, q(h.gas, 2), q(h.heat, 2), 0, 0];
  const sn = { T: 0.5, ph: 'race' }, p = new Predictor();
  if (kind === 'river') {
    p.setTrack(client.world.tr);
    Object.assign(sn, {t: 's', x:q(r.x,3), z:q(r.z,3), vx:q(r.vx,2), vz:q(r.vz,2), a:q(r.a,3), w:q(r.w,3),
      s:q(r.s,2), st:0, hp:[[h.id, h.seat, ...motion]]});
  } else {
    p.setArena(client.world);
    Object.assign(sn, {t:'a', r:[[0,q(r.x,3),q(r.z,3),q(r.a,3),q(r.w,3),q(r.vx,2),q(r.vz,2),0,0,0,0]],
      hp:[[h.id, 0, h.seat, ...motion]]});
  }
  p.myId = h.id; p.rules = server.world.rules;
  p.onSnap(sn, sn.T); p.record(sn.T - p.lead(), {f:1, c:1});
  p.run(sn.T + 6 * DT + 1e-8 - p.lead()); server.advance(6);
  assert.equal(p.steps, 6);
  const predicted = kind === 'river' ? p.W.raft : p.A.rafts[0];
  const metres = Math.hypot(r.x - predicted.x, r.z - predicted.z), rad = Math.abs(r.a - predicted.a);
  assert.ok(metres < 0.005 && rad < 0.004, `snapshot ${kind}: ${metres} m, ${rad} rad`);
  console.log(`100 ms snapshot replay ${kind}: ${(metres * 1000).toFixed(2)} mm / ${rad.toFixed(4)} rad`);
}

function checkRaftCollision() {
  function pair(separation) {
    const world = createArena('king', [{id:0, members:[]}, {id:1, members:[]}], 42);
    world.L.spikes = []; world.L.obstacles = [];
    for (const [i, r] of world.rafts.entries()) {
      const sign = i === 0 ? 1 : -1;
      Object.assign(r, {x: -sign * separation / 2, z: 0, a: 0, vx: sign * 4, vz: sign * 2});
    }
    arenaStep(world, DT, {physics:true, predict:true});
    return world;
  }
  const near = pair(3.6), far = pair(12);
  const [p, q] = near.rafts, [beforeP, beforeQ] = far.rafts;
  close(p.vx + q.vx, beforeP.vx + beforeQ.vx);
  close(p.vz + q.vz, beforeP.vz + beforeQ.vz);
  assert.ok(p.vx < 0 && q.vx > 0 && p.w * q.w > 0.1);
  Object.assign(q, {x:p.x + 3, z:p.z, vx:PHYS.maxSpeed, vz:0});
  const h = {pos: Math.PI, vel:0.3, seat:0, heat:0.2};
  const other = structuredClone(near);
  megaFart(near, p, h, 1); megaFart(other, other.rafts[0], {...h}, 1);
  for (const [i,r] of near.rafts.entries()) {
    assert.ok(Math.hypot(r.vx, r.vz) <= PHYS.maxSpeed + 1e-9 && Math.abs(r.w) <= PHYS.maxSpin);
    close(r.w, other.rafts[i].w);
  }
}

close(DT, 1 / 60);
const rows = {};
for (const kind of ['river', 'arena']) {
  for (const shape of ['round', 'square', 'tri']) {
    const result = measure(kind, false, shape), predicted = measure(kind, true, shape);
    for (const k of Object.keys(result)) close(result[k], predicted[k]);
    rows[`${kind}/${shape}`] = Object.fromEntries(Object.entries(result).map(([k,v]) => [k,+v.toFixed(3)]));
  }
  const round = rows[kind + '/round'];
  assert.ok(round.tapSpeed > 2.5 && round.crossingYawRad < -0.5 && round.opposedPeakRadSec > 1);
  assert.ok(round.steeringYawRad > rows[kind + '/square'].steeringYawRad);
  assert.ok(round.steeringYawRad < rows[kind + '/tri'].steeringYawRad);
  const solo = fixture(kind);
  const start = solo.raft.z;
  solo.crew[0].inFart = true; solo.advance(120);
  assert.ok(solo.raft.z - start > 7 && Math.abs(solo.raft.x) < 2, 'solo can travel along a 4 m lane');
  checkSnapshot(kind);
}
const flow = fixture('river', 1, 'round', false, 2);
flow.raft.vz = 2; flow.advance(60);
close(flow.raft.vx, 0); close(flow.raft.vz, 2); close(flow.raft.z, 32);
const full = fixture('river', 5), center = full.crew[4];
center.inFart = true; full.advance(30);
assert.ok(full.raft.vz > 3); close(full.raft.x, 0); close(full.raft.w, 0);
raceMega(full.world, center, 0.5);
close(full.raft.w, 0); assert.ok(full.raft.vz > 9);
const carousel = fixture('river', 4);
for (const h of carousel.crew) { h.inFart = true; h.inCrawl = 1; }
let peakSpin = 0;
for (let i = 0; i < 90; i++) { carousel.advance(1); peakSpin = Math.max(peakSpin, Math.abs(carousel.raft.w)); }
assert.ok(peakSpin >= 6 && peakSpin <= PHYS.maxSpin, 'Карусель is attainable with the shared angular speed limit');
checkRaftCollision();
console.table(rows);
console.log('60 Hz • river current • release • crossing • steering • opposed jets • wall recovery • speed limit • server/predict');
