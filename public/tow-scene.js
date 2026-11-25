import * as THREE from 'three';
import { RIM_R } from './shared.js';
import { TOW_DOCK_X, TOW_DOCK_HALF, TOW_DUCK_R, TOW_REST, towDockSide } from './tow.js';

const TAU = Math.PI * 2, CREAM = 0xffebbc, INK = 0x174654;
const TEAMS = [
  { color: 0xf37232, dark: 0x92452a, css: '#ec662c' },
  { color: 0x258ca7, dark: 0x195571, css: '#157d99' },
];

// Неподвижные детали причала и части корпуса утки рисуются одним мешем на модель.
class PaintedMesh {
  constructor() {
    this.positions = []; this.normals = []; this.colors = []; this.indices = [];
    this.transform = new THREE.Object3D(); this.normal = new THREE.Matrix3();
    this.vertex = new THREE.Vector3(); this.color = new THREE.Color();
  }
  part(geometry, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    const obj = this.transform;
    obj.position.set(x, y, z); obj.rotation.set(rx, ry, rz); obj.scale.set(sx, sy, sz); obj.updateMatrix();
    this.normal.getNormalMatrix(obj.matrix); this.color.setHex(color);
    const { position, normal } = geometry.attributes, base = this.positions.length / 3;
    for (let i = 0; i < position.count; i++) {
      const p = this.vertex.fromBufferAttribute(position, i).applyMatrix4(obj.matrix);
      this.positions.push(p.x, p.y, p.z);
      p.fromBufferAttribute(normal, i).applyNormalMatrix(this.normal); this.normals.push(p.x, p.y, p.z);
      this.colors.push(this.color.r, this.color.g, this.color.b);
    }
    const index = geometry.index;
    for (let i = 0; i < (index ? index.count : position.count); i++) this.indices.push(base + (index ? index.getX(i) : i));
  }
  finish(material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
}

function paintedMap(w, h, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  paint(c.getContext('2d'));
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; return map;
}

function emblem(ctx, team, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.strokeStyle = ctx.fillStyle = '#fff1c8'; ctx.lineWidth = 0.14; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (team === 0) {
    ctx.beginPath(); ctx.arc(0, 0, 0.46, 0, TAU); ctx.fill();
    for (let i = 0; i < 8; i++) {
      ctx.rotate(TAU / 8); ctx.beginPath(); ctx.moveTo(0, -0.64); ctx.lineTo(0, -0.94); ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.arc(0, -0.65, 0.18, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -0.45); ctx.lineTo(0, 0.78);
    ctx.moveTo(-0.30, -0.22); ctx.lineTo(0.30, -0.22);
    ctx.moveTo(-0.77, 0.18); ctx.quadraticCurveTo(-0.68, 0.73, 0, 0.82); ctx.quadraticCurveTo(0.68, 0.73, 0.77, 0.18);
    ctx.moveTo(-0.82, 0.47); ctx.lineTo(-0.77, 0.15); ctx.lineTo(-0.49, 0.34);
    ctx.moveTo(0.82, 0.47); ctx.lineTo(0.77, 0.15); ctx.lineTo(0.49, 0.34); ctx.stroke();
  }
  ctx.restore();
}

function flag(team) {
  const map = paintedMap(256, 128, ctx => {
    ctx.fillStyle = TEAMS[team].css; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#fff1c8'; ctx.fillRect(0, 0, 9, 128); ctx.fillRect(0, 6, 256, 4); ctx.fillRect(0, 118, 256, 4);
    emblem(ctx, team, 113, 64, 47);
  });
  const geometry = new THREE.PlaneGeometry(3, 1.65, 8, 4), p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + 1.5, y = p.getY(i), t = x / 3;
    p.setXYZ(i, x - 0.55 * t ** 5 * (1 - Math.abs(y) / 0.825), y - t * 0.16, Math.sin(t * 7) * t * 0.20);
  }
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map, roughness: 0.85, side: THREE.DoubleSide }));
}

function landing(team, depth) {
  // PlaneGeometry после поворота -π/2 направляет нижний край рисунка к берегу.
  const map = paintedMap(256, 256, ctx => {
    ctx.fillStyle = TEAMS[team].css; ctx.globalAlpha = 0.27; ctx.fillRect(0, 0, 256, 256);
    ctx.globalAlpha = 0.97; ctx.fillStyle = '#fff1c8';
    for (let x = 0; x < 256; x += 32) ctx.fillRect(x + 3, 1, 23, 6);
    ctx.fillRect(2, 0, 5, 256); ctx.fillRect(249, 0, 5, 256);
    for (const x of [67, 128, 189]) {
      ctx.strokeStyle = '#fff1c8'; ctx.lineWidth = 7; ctx.beginPath();
      ctx.moveTo(x - 15, 39); ctx.lineTo(x, 54); ctx.lineTo(x + 15, 39); ctx.stroke();
    }
    ctx.fillStyle = TEAMS[team].css; ctx.beginPath(); ctx.arc(128, 137, 62, 0, TAU); ctx.fill();
    emblem(ctx, team, 128, 137, 47);
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * TOW_DOCK_HALF, depth), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, 0.037, depth / 2); mesh.renderOrder = 2;
  return mesh;
}

function makeBerth(team, arenaRadius, g, material) {
  const group = new THREE.Group(), batch = new PaintedMesh(), paint = TEAMS[team], shore = arenaRadius - TOW_DOCK_X;
  const box = (c, x, y, z, w, h, d, rx = 0, rz = 0) => batch.part(g.box, c, x, y, z, w, h, d, rx, 0, rz);
  const post = (c, x, y, z, r, h) => batch.part(g.cylinder, c, x, y, z, r, h, r);
  for (const side of [-1, 1]) {
    // Две низкие марки по краям линии приёма оставляют вход свободным.
    const x = side * (TOW_DOCK_HALF + 0.25);
    batch.part(g.ball, INK, x, 0.12, 0, 0.44, 0.23, 0.44);
    post(CREAM, x, 0.45, 0, 0.22, 0.61);
    for (let j = 0; j <= team; j++) post(paint.color, x, 0.38 + j * 0.22, 0, 0.227, team ? 0.11 : 0.23);
    batch.part(g.ball, paint.color, x, 0.78, 0, 0.25, 0.20, 0.25);
  }
  // Деревянный настил находится у физической стенки, вода до настила судоходна.
  const timber = [0xc08450, 0xe0aa70, 0xd6985e, 0xdca06a];
  box(0x754b3c, 0, 0.71, shore + 1.3, 9.9, 0.49, 3.5);
  for (let i = 0; i < 22; i++) box(timber[i % 4], (i - 10.5) * 0.45, 1.02, shore + 1.3, 0.431, 0.22, 3.55);
  for (const x of [-4.6, 0, 4.6]) {
    post(0x825b40, x, 0.40, shore - 0.18, 0.24, 2.45);
    post(CREAM, x, 1.48, shore - 0.18, 0.251, 0.18);
    if (x !== 0) {
      batch.part(g.torus, INK, x * 0.69, 0.69, shore - 0.57, 0.44, 0.44, 0.73);
      box(CREAM, x * 0.69, 0.96, shore - 0.59, 0.075, 0.44, 0.08);
    }
  }
  const mastX = -3.75;
  post(0x79543c, mastX, 3.43, shore + 0.45, 0.105, 5.61);
  batch.part(g.ball, 0xeeba5e, mastX, 6.29, shore + 0.45, 0.17, 0.19, 0.17);
  // Полосатый навес над билетной будкой и открытая веранда.
  const cabinX = 1.9, cabinZ = shore + 2.1;
  box(CREAM, cabinX, 2.22, cabinZ, 3.3, 2.18, 1.75);
  box(paint.dark, cabinX, 2.37, cabinZ - 0.90, 2.30, 1.11, 0.08);
  box(0x89b5ac, cabinX - 0.56, 2.43, cabinZ - 0.95, 0.87, 0.75, 0.06);
  box(0x8dc2c2, cabinX + 0.56, 2.43, cabinZ - 0.95, 0.87, 0.75, 0.06);
  box(0x865849, cabinX, 1.84, cabinZ - 1.04, 2.66, 0.13, 0.46);
  box(paint.dark, cabinX, 3.43, cabinZ, 3.75, 0.23, 2.1);
  for (let i = 0; i < 9; i++) {
    const x = cabinX + (i - 4) * 0.43, col = i % 2 ? CREAM : paint.color;
    box(col, x, 3.20, cabinZ - 1.42, 0.434, 0.12, 1.35, -0.22);
    box(col, x, 2.98, cabinZ - 2.06, 0.434, 0.22, 0.10);
  }
  for (const x of [cabinX - 1.82, cabinX + 1.82]) post(paint.dark, x, 2.00, cabinZ - 1.97, 0.064, 1.80);
  const banner = flag(team); banner.position.set(mastX + 0.09, 5.27, shore + 0.45);
  group.add(batch.finish(material), banner, landing(team, shore - 0.5)); return group;
}

function makeDuck(g, material, quality) {
  const b = new PaintedMesh(), gold = 0xffc332, shadow = 0xe89a19, orange = 0xff7b21;
  const sphere = quality ? g.smooth : g.ball;
  const ell = (c, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => b.part(sphere, c, x, y, z, sx, sy, sz, rx, ry, rz);
  const hull = sphere.clone(), p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const tail = Math.max(0, -p.getZ(i));
    p.setXYZ(i, p.getX(i) * (1 - tail * 0.19), p.getY(i) + 1.30 * tail ** 3, p.getZ(i));
  }
  hull.computeVertexNormals(); b.part(hull, gold, 0, 0.40, -0.12, 0.86, 0.53, 1.04); hull.dispose();
  for (const side of [-1, 1]) {
    ell(shadow, side * 0.67, 0.46, -0.16, 0.23, 0.30, 0.65, -0.20);
    ell(0xffcc42, side * 0.70, 0.50, -0.18, 0.23, 0.27, 0.64, -0.21);
  }
  ell(0xffcb39, 0, 1.13, 0.34, 0.57, 0.60, 0.56);
  // Приоткрытый плоский клюв с тёмным срезом читается и сбоку, и сверху.
  ell(0xe56620, 0, 0.99, 0.87, 0.367, 0.107, 0.338, 0.15);
  ell(0x813820, 0, 1.045, 0.92, 0.335, 0.060, 0.32, 0.11);
  ell(orange, 0, 1.105, 0.90, 0.37, 0.106, 0.354, -0.035);
  for (const side of [-1, 1]) {
    ell(0x9b4722, side * 0.148, 1.198, 0.89, 0.037, 0.014, 0.054);
    const angle = side * 0.94;
    ell(0xffefc0, side * 0.431, 1.345, 0.625, 0.159, 0.172, 0.055, 0, angle);
    ell(0x203e45, side * 0.459, 1.351, 0.656, 0.123, 0.139, 0.045, 0, angle);
    ell(0xfffdf0, side * 0.470, 1.396, 0.702, 0.041, 0.046, 0.025, 0, angle);
  }
  b.part(g.torus, 0x935a31, 0, 0.815, 0.285, 0.51, 0.49, 0.48, Math.PI / 2 + 0.08);
  b.part(g.torus, 0xffda87, 0, 0.836, 0.285, 0.512, 0.49, 0.32, Math.PI / 2 + 0.08);
  b.part(g.torus, INK, 0, 0.63, 0.813, 0.148, 0.15, 0.26);
  const mesh = b.finish(material); mesh.scale.setScalar(TOW_DUCK_R); return mesh;
}

const RINGS = 15, SIDES = 7;
const ropeCos = [], ropeSin = [];
for (let i = 0; i <= SIDES; i++) { ropeCos.push(Math.cos(i * TAU / SIDES)); ropeSin.push(Math.sin(i * TAU / SIDES)); }
function makeRope() {
  const geo = new THREE.BufferGeometry(), count = RINGS * (SIDES + 1), uv = [], ids = [];
  for (const name of ['position', 'normal']) geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  for (let j = 0; j < RINGS; j++) for (let k = 0; k <= SIDES; k++) {
    uv.push(j / (RINGS - 1), k / SIDES);
    if (k === SIDES || j === RINGS - 1) continue;
    const i = j * (SIDES + 1) + k, n = i + SIDES + 1;
    ids.push(i, n, i + 1, n, n + 1, i + 1);
  }
  geo.setIndex(ids); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const map = paintedMap(256, 32, ctx => {
    ctx.fillStyle = '#f9d78e'; ctx.fillRect(0, 0, 256, 32);
    for (let x = -32; x < 288; x += 16) {
      ctx.beginPath(); ctx.moveTo(x, 32); ctx.lineTo(x + 16, 0); ctx.lineWidth = 5; ctx.strokeStyle = '#604839'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 5, 32); ctx.lineTo(x + 21, 0); ctx.lineWidth = 2; ctx.strokeStyle = '#fff1c8'; ctx.stroke();
    }
  });
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.37 }));
  mesh.frustumCulled = false; mesh.visible = false;
  return mesh;
}

function setRope(mesh, x0, y0, z0, x1, y1, z1, distance) {
  const dx = x1 - x0, dz = z1 - z0, span = Math.hypot(dx, dz);
  mesh.visible = span > 0.03;
  if (!mesh.visible) return;
  const slack = THREE.MathUtils.clamp((TOW_REST - distance) / 1.15, 0, 1);
  const bend = 0.81 * Math.sqrt(slack), drop = 0.26 * slack;
  const sx = -dz / span, sz = dx / span;
  const pos = mesh.geometry.attributes.position, normal = mesh.geometry.attributes.normal;
  for (let j = 0; j < RINGS; j++) {
    const t = j / (RINGS - 1), arch = 4 * t * (1 - t), slope = 4 - 8 * t;
    const x = x0 + dx * t + sx * arch * bend, z = z0 + dz * t + sz * arch * bend, y = y0 + (y1 - y0) * t - drop * arch;
    const tx = dx + sx * bend * slope, tz = dz + sz * bend * slope, ty = y1 - y0 - drop * slope;
    const ground = Math.hypot(tx, tz), length = Math.hypot(ground, ty);
    const sideX = -tz / ground, sideZ = tx / ground;
    const upX = -tx * ty / (ground * length), upY = ground / length, upZ = -tz * ty / (ground * length);
    for (let k = 0; k <= SIDES; k++) {
      const c = ropeCos[k], s = ropeSin[k], i = j * (SIDES + 1) + k;
      const nx = sideX * c + upX * s, ny = upY * s, nz = sideZ * c + upZ * s;
      pos.setXYZ(i, x + 0.095 * nx, y + 0.095 * ny, z + 0.095 * nz);
      normal.setXYZ(i, nx, ny, nz);
    }
  }
  pos.needsUpdate = normal.needsUpdate = true;
  mesh.material.color.setHex(distance > TOW_REST + 1.45 ? 0xff9455 : 0xffffff);
}

// Домики стоят по обеим сторонам гавани, за физической границей арены.
const BOATHOUSES = [
  [-28, -9, Math.PI / 2, 0xeab978, 0x528b85], [28, 10, -Math.PI / 2, 0xdb9e7b, 0x557e89],
  [1, 30, Math.PI, 0xf3cba1, 0xaf6550], [8.5, 30, Math.PI, 0xd99e78, 0x668b84],
  [-4, -31, 0, 0xe7c092, 0x627d89],
];

function waterfront(g, material, arenaRadius) {
  const b = new PaintedMesh(), x = -6, z = arenaRadius + 8;
  b.part(g.cylinder, CREAM, x, 4.25, z, 1.21, 6.4, 1.21);
  b.part(g.cylinder, 0xcd593c, x, 5.63, z, 1.23, 0.95, 1.23);
  b.part(g.cylinder, INK, x, 7.4, z, 1.54, 0.27, 1.54);
  b.part(g.cylinder, 0xffda83, x, 8.03, z, 0.78, 1.15, 0.78);
  for (let k = 0; k < 8; k++) {
    const angle = k * TAU / 8;
    b.part(g.cylinder, INK, x + 0.82 * Math.sin(angle), 8.0, z + 0.82 * Math.cos(angle), 0.063, 1.16, 0.063);
  }
  b.part(g.cone, 0xd86842, x, 9.03, z, 1.34, 1.08, 1.34);
  b.part(g.ball, INK, x, 9.61, z, 0.14, 0.18, 0.14);
  const triangle = new THREE.Shape();
  triangle.moveTo(-0.5, 0); triangle.lineTo(0.5, 0); triangle.lineTo(0, 1); triangle.closePath();
  const gable = new THREE.ExtrudeGeometry(triangle, { depth: 1, bevelEnabled: false }); gable.translate(0, 0, -0.5);
  for (const [bx, bz, angle, body, roof] of BOATHOUSES) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const part = (geom, color, x, y, z, w, h, d) =>
      b.part(geom, color, bx + c * x + s * z, y, bz - s * x + c * z, w, h, d, 0, angle);
    part(g.box, body, 0, 3.1, 0, 4.6, 3.4, 3.8);
    part(gable, roof, 0, 4.8, 0, 5.25, 1.55, 4.3);
    part(gable, CREAM, 0, 4.82, 2.16, 4.3, 1.27, 0.06);
    part(g.box, INK, 0, 2.64, 1.94, 1.75, 2.47, 0.12);
    for (const dx of [-1.55, 1.55]) {
      part(g.box, CREAM, dx, 3.35, 1.95, 0.85, 1.10, 0.13);
      part(g.box, 0x648c91, dx, 3.36, 2.03, 0.64, 0.83, 0.04);
    }
    part(g.box, body, 1.20, 5.80, -0.88, 0.46, 1.25, 0.55);
    part(g.box, CREAM, 1.20, 6.41, -0.88, 0.58, 0.17, 0.68);
  }
  gable.dispose();
  return b.finish(material);
}

export class TowHarbor {
  constructor(quality, arenaRadius) {
    this.root = new THREE.Group();
    this.lighthouseZ = arenaRadius + 8;
    const g = {
      box: new THREE.BoxGeometry(), ball: new THREE.SphereGeometry(1, 14, 10), smooth: new THREE.SphereGeometry(1, 24, 16),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 12), cone: new THREE.ConeGeometry(1, 1, 12),
      torus: new THREE.TorusGeometry(1, 0.19, 6, 24),
    };
    const dockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
    const duckMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
    this.berths = [makeBerth(0, arenaRadius, g, dockMat), makeBerth(1, arenaRadius, g, dockMat)];
    this.setSide(0, 0); this.setSide(1, 1);
    this.duck = makeDuck(g, duckMat, quality); this.duck.rotation.set(0, -0.68, 0, 'YXZ'); this.duck.visible = false;
    this.eyelet = new THREE.Vector3();
    this.rope = makeRope();
    this.root.add(...this.berths, waterfront(g, dockMat, arenaRadius), this.duck, this.rope);
    for (const primitive of Object.values(g)) primitive.dispose();
    const boomMap = paintedMap(64, 8, ctx => {
      ctx.fillStyle = '#eecc94'; ctx.fillRect(0, 0, 64, 8); ctx.fillStyle = '#438b87'; ctx.fillRect(4, 0, 10, 8);
      ctx.fillStyle = '#fbecd0'; ctx.fillRect(15, 0, 3, 8);
    });
    boomMap.wrapS = THREE.RepeatWrapping; boomMap.repeat.x = 36;
    this.bumperMaterial = new THREE.MeshStandardMaterial({ map: boomMap, roughness: 0.68 });
    this.bluffMaterial = new THREE.MeshStandardMaterial({ color: 0xa9ad90, roughness: 0.94, flatShading: true });
  }
  hasBuilding(x, z) {
    return BOATHOUSES.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 4.1) || Math.hypot(x + 6, z - this.lighthouseZ) < 3.4;
  }
  setSide(team, side) {
    const g = this.berths[team];
    if (g.userData.side === side) return;
    g.userData.side = side;
    const sign = towDockSide(side);
    g.position.x = sign * TOW_DOCK_X; g.rotation.y = sign * Math.PI / 2;
  }
  placeDuck(state, rafts, t, dt) {
    const duck = this.duck;
    duck.visible = !!state;
    if (!state) { this.rope.visible = false; return; }
    let owner, orangeSide;
    for (const r of rafts) {
      if (r.team === 0) orangeSide = r.side ?? 0;
      else if (r.team === 1) orangeSide = 1 - (r.side ?? 1);
      if (r.id === state.owner) owner = r;
    }
    // В тренировке приходит один плот; второй причал всё равно занимает противоположный берег.
    if (orangeSide !== undefined) { this.setSide(0, orangeSide); this.setSide(1, 1 - orangeSide); }
    const speed = Math.hypot(state.vx, state.vz);
    const ox = owner ? owner.x - state.x : 0, oz = owner ? owner.z - state.z : 0, distance = Math.hypot(ox, oz);
    if (distance > 0.12 || speed > 0.18) {
      const target = distance > 0.12 ? Math.atan2(ox, oz) : Math.atan2(state.vx, state.vz);
      const diff = target - duck.rotation.y;
      duck.rotation.y += Math.atan2(Math.sin(diff), Math.cos(diff)) * (1 - Math.exp(-dt * 6));
    }
    duck.rotation.z = 0.043 * Math.sin(t * 2.1);
    duck.rotation.x = 0.038 * Math.sin(t * 2.7) - Math.min(0.085, speed * 0.008);
    duck.position.set(state.x, 0.038 + 0.042 * Math.sin(t * 2.7 + 0.3), state.z);
    if (!owner || distance < 0.1) { this.rope.visible = false; return; }
    const arm = Math.min(RIM_R, distance * 0.50);
    // Ушко остаётся привязанным к позе утки даже в момент перехвата.
    const end = this.eyelet;
    duck.localToWorld(end.set(0, 0.63, 0.813));
    setRope(this.rope, owner.x - ox / distance * arm, 0.49, owner.z - oz / distance * arm, end.x, end.y, end.z, distance);
  }
  dispose() {
    const materials = new Set([this.bumperMaterial, this.bluffMaterial]);
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) materials.add(o.material); });
    for (const mat of materials) { mat.map?.dispose(); mat.dispose(); }
  }
}
