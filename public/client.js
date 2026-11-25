// ============================================================
//  ПУКОПЛОТ — клиент
//  Сеть: сервер присылает снимки 30 раз в секунду. Браузер берёт последний снимок
//  и прокручивает ту же физику (sim.js) вперёд до «сейчас + полпинга» со своими
//  нажатиями — плот отзывается сразу, без ожидания сервера.
// ============================================================
import * as THREE from 'three';
import {
  LEVELS, SKINS, PHYS, RIM_R, EMOTES, MISFIRE_LEVELS, ENDLESS, ENDLESS_INFO, THEMES,
  buildTrack, extendTrack, frame, locate, yAt, wrapAngle, sectorCenter, sectorHalf, medalTimes, medalFor, obstacleState,
  RIM_SEATS, CENTER_SEAT, isCenter, rimCount, shapeOf, rimR, RAFT_SHAPES, RAFT_SHAPE_IDS, DAILY, DAILY_INFO, dailyMutator,
} from './shared.js';
import { ARENA_MODES, MODE_KEYS, createArena, ARENA_R, PICKUPS, ARENA_EVENTS, LAP_GATES } from './arena.js';
import { TOW_DOCK_X, TOW_DOCK_HALF, towDockSide } from './tow.js';
import { ArenaScene, makePickupMesh, animatePickup } from './arena-scene.js';
import { Predictor } from './predict.js';
import { Sfx } from './audio.js';
import { Particles, Rings, Puddles, Traces, Stains } from './fx.js';
import { makeHippo, makeRaft, setRaftSectors, setRaftDirt, setHippoDirt, makeLabel, loadShirtPrints, shirtImages } from './hippo.js';
import { LevelScene, makeSky, warmupKit } from './level.js';
import { ACHIEVEMENTS, ACH, TIERS, TIER, achProgress, LEVEL_NAMES } from './achievements.js';
import { SLOTS, SLOT, DEFAULT_LOOK, RAFTS, RARITY, ITEM, BOX_ITEMS, PERKS, perksOf, perkMods, owns, itemIcon, TRAILS, VOICES } from './cosmetics.js';
import { BOXES, BOX_ORDER, QUESTS, REROLL_PRICE, COIN, levelOf, rankTitle } from './economy.js';

const $ = (id) => document.getElementById(id);
const sfx = new Sfx();
const nowS = () => performance.now() / 1000;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAng = (a, b, t) => a + wrapAngle(b - a) * t;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const fmtDist = (m) => m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} км` : `${Math.round(m)} м`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); };
const BIG = 1e9;

// ------------------------------------------------------------
//  Состояние
// ------------------------------------------------------------
let myId = 0, joined = false, room = null, welcome = null, me = null, lastResults = null;
const P = window.__P = new Predictor();
let levelIdx = -1, levelKey = '', tr = null, levelScene = null;
let phase = 'lobby';
let selSkin = +lsGet('puk.skin', 0) % SKINS.length;
let qualityMode = lsGet('puk.quality', 'auto');           // auto | 0 | 1 | 2
let quality = qualityMode === 'auto' ? 2 : +qualityMode;
const hippos = new Map();
let fps = 60;
window.__dbg = () => ({ ws: connected, snapT: P.snap && P.snap.T, off: P.clockOff, now: nowS(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, progs: renderer.info.programs.length, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures });
const NET = window.__net = { frames: 0, steps: 0, corr: 0, maxCorr: 0, resets: 0, get rtt() { return P.rtt; }, get off() { return P.clockOff; } };

// ------------------------------------------------------------
//  Рендер
// ------------------------------------------------------------
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: quality >= 2, powerPreference: 'high-performance' }); }
catch (cause) {
  const error = new Error('Не удалось создать контекст WebGL 2', { cause });
  error.name = 'WebGLUnavailable';
  throw error;
}
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;                 // всегда включены: переключение пересобирает шейдеры (= фриз)
renderer.shadowMap.type = quality >= 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;   // тип теней задаётся один раз — смена пересобирает шейдеры
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 900);
const hemi = new THREE.HemisphereLight(0xffffff, 0xd8a080, 1.2); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const sky = makeSky('day'); scene.add(sky);
scene.fog = new THREE.Fog(0xcfeaff, 90, 260);
scene.background = new THREE.Color(0xcfeaff);
const pmrem = new THREE.PMREMGenerator(renderer);
const themeT = { fog: new THREE.Color(), top: new THREE.Color(), bot: new THREE.Color(), sun: new THREE.Color(), light: 1, name: '' };

function applyQuality() {
  renderer.setPixelRatio(quality === 2 ? Math.min(devicePixelRatio, 1.5) : quality === 1 ? Math.min(devicePixelRatio, 1) : 0.75);
  const ms = quality >= 2 ? 2048 : quality === 1 ? 1024 : 512;
  if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  updatePointScale();
  renderQualityButtons();
}
function updatePointScale() {
  const h = renderer.domElement.height;
  const s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (const p of [gasFx, foamFx, fireFx, pooFx, trailFx]) p.setView(s, scene.fog);
}
function updateCameraFraming() {
  const width = innerWidth, height = innerHeight;
  camera.aspect = width / height;
  if (document.body.classList.contains('fitting-room')) {
    const narrow = width <= 760;
    camera.setViewOffset(width, height, narrow ? 0 : Math.min(200, width * 0.15), narrow ? height * 0.245 : 0, width, height);
  } else camera.clearViewOffset();
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); updateCameraFraming(); updatePointScale(); });
function prewarm(obj = scene) {          // заранее компилируем шейдеры и грузим текстуры, чтобы не было фризов в заезде
  try {
    renderer.compile(obj, camera, scene);
    const seen = new Set();
    obj.traverse(o => { for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) for (const k of ['map', 'normalMap', 'emissiveMap']) { const t = m[k]; if (t && !seen.has(t)) { seen.add(t); renderer.initTexture(t); } } });
  } catch (e) { console.warn('prewarm', e); }
}
// всё, что впервые появляется посреди заезда: лужи, грязь на препятствиях, облачка фраз
function prewarmTransient() {
  const kit = new THREE.Group(), plane = new THREE.PlaneGeometry(1, 1);
  kit.add(new THREE.Mesh(plane, stains.mats[0]));
  kit.add(bubbleSprite('…'));
  kit.add(makeLabel('…', '#fff', '…'));
  if (tr) kit.add(warmupKit(tr));
  kit.position.copy(camera.position); kit.visible = true;
  scene.add(kit); prewarm(kit); scene.remove(kit);
}

// Плот на экране: модель, бегемоты на нём, сглаженное положение
function disposeRaftGeometry(model) {
  model.traverse(o => {
    if (o.isInstancedMesh) o.dispose();
    o.geometry?.dispose();
  });
}
class RaftVis {
  constructor(shape = 'round', skin = 'classic') {
    this.group = new THREE.Group(); this.holder = new THREE.Group();
    this.setShape(shape, skin);
    this.group.add(this.holder); scene.add(this.group);
    this.disp = { x: 0, z: 0, a: 0, init: false, st: 0 }; this.popAt = -99; this.fallAt = -99; this.ringAcc = 0; this.wakeAcc = 0; this.sectorKey = '';
  }
  setShape(shape, skin = 'classic') {
    if (this.model && this.shape === shape && this.skin === skin) return;
    if (this.model) { this.group.remove(this.model); disposeRaftGeometry(this.model); }
    this.shape = shape; this.skin = skin; this.S = shapeOf(shape); this.model = makeRaft(shape, skin); this.group.add(this.model); this.sectorKey = '';
    prewarm(this.model);
  }
  // R: x z a vx vz w status; rem — сколько досчитать по скорости
  place(R, rem, t, dtReal, waterY, blink) {
    const d = this.disp, moving = R.status === 0 || R.status === 2;
    const px = R.x + (moving ? R.vx * rem : 0), pz = R.z + (moving ? R.vz * rem : 0), pa = R.a + (moving ? R.w * rem : 0);
    const err = Math.hypot(px - d.x, pz - d.z);
    if (!d.init || err > 6 || R.status !== d.st) {
      d.x = px; d.z = pz; d.a = pa; d.init = true; NET.resets++;
      d.lastVx = R.vx; d.lastVz = R.vz; d.pitch = d.roll = 0;
    }
    else {
      if (moving) { d.x += R.vx * dtReal; d.z += R.vz * dtReal; d.a += R.w * dtReal; }
      const k = 1 - Math.exp(-dtReal * 14);
      d.x = lerp(d.x, px, k); d.z = lerp(d.z, pz, k); d.a = lerpAng(d.a, pa, k);
      NET.corr = err; if (err > NET.maxCorr) NET.maxCorr = err;
    }
    d.st = R.status;
    let y = waterY + 0.18 + Math.sin(t * 2.2 + this.group.id) * 0.05, sc = 1;
    if (R.status === 2) { const k = Math.max(0, t - this.fallAt); y -= 4.9 * k * k; }
    if (R.status === 1) { const k = clamp((t - this.popAt) * 3, 0, 1); sc = 1 - 0.65 * k; }
    this.group.position.set(d.x, y, d.z);
    // Наклон корпуса показывает рывок и боковой снос. Камера остаётся на горизонте.
    const sin = Math.sin(d.a), cos = Math.cos(d.a), sampleDt = Math.max(dtReal, 1 / 120);
    const ax = (R.vx - d.lastVx) / sampleDt, az = (R.vz - d.lastVz) / sampleDt;
    const slip = R.vx * cos - R.vz * sin;
    const pitch = clamp((ax * sin + az * cos) * 0.018, -0.16, 0.16);
    const roll = clamp((ax * cos - az * sin) * 0.014 + slip * 0.024, -0.23, 0.23);
    const settle = 1 - Math.exp(-dtReal * 9);
    d.pitch = lerp(d.pitch, moving ? pitch : 0, settle);
    d.roll = lerp(d.roll, moving ? roll : 0, settle);
    d.lastVx = R.vx; d.lastVz = R.vz;
    this.group.rotation.set(Math.sin(t * 1.7) * 0.025 + d.pitch, d.a, Math.cos(t * 1.3) * 0.025 - d.roll, 'YXZ');
    this.model.scale.set(sc, sc * (R.status === 1 ? 0.45 : 1), sc);
    this.model.visible = !(blink && Math.floor(t * 10) % 2);
  }
  wake(R, dt, waterY) {
    const d = this.disp, spd = Math.hypot(R.vx, R.vz);
    this.ringAcc += dt;
    if (R.status === 0 && this.ringAcc > (spd > 1 ? 0.45 : 1.1)) { this.ringAcc = 0; rings.spawn(d.x, waterY + 0.02, d.z, 2.2, 4.8 + spd * 0.2, 1.8, 0.45); }
    this.wakeAcc = Math.min(20, this.wakeAcc + dt * spd * (quality ? 2 : 1));
    while (this.wakeAcc > 1 && R.status === 0) {
      this.wakeAcc -= 1;
      const a = Math.atan2(R.vx, R.vz) + Math.PI + (Math.random() - 0.5) * 2.4;
      foamFx.emit(d.x + Math.sin(a) * 2.1, waterY + 0.05, d.z + Math.cos(a) * 2.1, (Math.random() - 0.5), 0.2, (Math.random() - 0.5), 0.35, 0.15, 0.9, WHITE, { drag: 1, grav: -1, floor: waterY + 0.02 });
    }
  }
  // перец — пламя за плотом, прищепка — пузырь-щит
  effects(flags, R, dt) {
    if (!this.shield) {
      this.shield = new THREE.Mesh(new THREE.SphereGeometry(2.5, 24, 12), new THREE.MeshBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.16, depthWrite: false }));
      this.shield.scale.y = 0.55; this.shield.position.y = 0.4; this.shield.renderOrder = 4; this.group.add(this.shield);
    }
    this.shield.visible = !!(flags & 2);
    if (this.shield.visible) this.shield.material.opacity = 0.12 + Math.sin(nowS() * 6) * 0.05;
    if (flags & 1) {
      this.fireAcc = (this.fireAcc || 0) + dt * 40;
      const sp = Math.hypot(R.vx, R.vz) || 1, bx = -R.vx / sp, bz = -R.vz / sp, d = this.disp;
      while (this.fireAcc > 1) { this.fireAcc -= 1; const a = (Math.random() - 0.5) * 1.2; fireFx.emit(d.x + bx * 2 + Math.cos(a) * 0.4, this.group.position.y + 0.2, d.z + bz * 2 + Math.sin(a) * 0.4, bx * 3, 1 + Math.random(), bz * 3, 0.45, 0.1, 0.5, pick(FIRE), { drag: 1, grav: 1.2 }); }
    }
  }
  // бомба над плотом, зелёная аура зомби, кольцо магнита
  modeFx(flags, dt, left) {
    const t = nowS();
    if (flags & 16) {
      if (!this.bomb) {
        const b = this.bomb = new THREE.Group();
        b.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.35, metalness: 0.3, emissive: new THREE.Color(0xff2a00), emissiveIntensity: 0 })));
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6 })); cap.position.y = 0.55; b.add(cap);
        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 6), new THREE.MeshStandardMaterial({ color: 0xc8a060 })); fuse.position.set(0.08, 0.78, 0); fuse.rotation.z = -0.4; b.add(fuse);
        const lbl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0x8a5526, roughness: 0.4 })); lbl.position.set(0, 0.1, 0.48); lbl.scale.set(1, 0.6, 0.3); b.add(lbl);
        b.position.y = 2.7; this.group.add(b);
      }
      const B = this.bomb; B.visible = true;
      const hurry = left < 4 ? 14 : left < 8 ? 7 : 3;
      B.children[0].material.emissiveIntensity = Math.max(0, Math.sin(t * hurry)) * (left < 4 ? 1.4 : 0.6);
      B.rotation.y += dt * 1.5; B.position.y = 2.7 + Math.sin(t * 4) * 0.1; B.scale.setScalar(1 + (left < 4 ? Math.max(0, Math.sin(t * hurry)) * 0.12 : 0));
      if (Math.random() < dt * 30) { this.group.updateMatrixWorld(); const p = B.children[2].getWorldPosition(new THREE.Vector3()); fireFx.emit(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 2, 1.5 + Math.random(), (Math.random() - 0.5) * 2, 0.18, 0.04, 0.35, pick(FIRE), { drag: 1, grav: 0.5 }); }
    } else if (this.bomb) this.bomb.visible = false;
    if (flags & 8) {
      if (!this.aura) { this.aura = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.18, 8, 48), new THREE.MeshBasicMaterial({ color: 0x7dff3a, transparent: true, opacity: 0.5, depthWrite: false })); this.aura.rotation.x = Math.PI / 2; this.aura.position.y = 0.1; this.group.add(this.aura); }
      this.aura.visible = true; this.aura.material.opacity = 0.35 + Math.sin(t * 5) * 0.15;
      if (Math.random() < dt * 14) { const a = Math.random() * 6.28, d = this.disp; trailFx.emit(d.x + Math.sin(a) * 2.2, this.group.position.y + 0.4, d.z + Math.cos(a) * 2.2, 0, 1 + Math.random(), 0, 0.3, 0.05, 1, pick(ZOMBIE_COL), { drag: 1, grav: -0.5 }); }
    } else if (this.aura) this.aura.visible = false;
    if (flags & 32) {
      if (!this.mag) { this.mag = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color: 0x5a8cff, transparent: true, opacity: 0.6, depthWrite: false })); this.mag.rotation.x = Math.PI / 2; this.mag.position.y = 0.15; this.group.add(this.mag); }
      this.mag.visible = true; const k = (t * 1.5) % 1; this.mag.scale.setScalar(1.6 - k * 0.8); this.mag.material.opacity = 0.6 * k;
    } else if (this.mag) this.mag.visible = false;
  }
  dispose() { scene.remove(this.group); disposeRaftGeometry(this.model); }
}
const swimmers = new THREE.Group(); scene.add(swimmers);
let mainRV = null;                 // плот сплава (создаётся после частиц — ему нужны кольца и пена)
const arenaRVs = new Map();
let arenaScene = null, arenaKey = '', arenaWorld = null;

const gasFx = new Particles(1800, { shade: 0.5 });
const pooFx = new Particles(400, { shade: 0.6 });
const foamFx = new Particles(900, { tex: 'dot', shade: 0 });
const fireFx = new Particles(400, { tex: 'dot', shade: 0, additive: true });
const trailFx = new Particles(900, { tex: 'dot', shade: 0, additive: true });
scene.add(gasFx.points, pooFx.points, foamFx.points, fireFx.points, trailFx.points);
const rings = new Rings(scene, 48);
const puddles = new Puddles(scene);
const traces = new Traces(scene, 180);
const stains = new Stains(scene, 700);
mainRV = new RaftVis('round');
// Цвет газа зависит от запаса: чистый зеленоватый → лайм → олива → коричневый
const GAS_STOPS = [[1.0, 0xdcf5a8], [0.78, 0xc8ef6a], [0.55, 0xb0c93c], [0.38, 0x9a8a32], [0.24, 0x84602a], [0.0, 0x6e4620]].map(([g, c]) => [g, new THREE.Color(c)]);
const gasCol = new THREE.Color();
function gasColor(g, out = gasCol) {
  for (let i = 0; i < GAS_STOPS.length - 1; i++) {
    const [g0, c0] = GAS_STOPS[i], [g1, c1] = GAS_STOPS[i + 1];
    if (g <= g0 && g >= g1) { out.copy(c0).lerp(c1, (g0 - g) / (g0 - g1)); break; }
  }
  if (g < 0) out.copy(GAS_STOPS[GAS_STOPS.length - 1][1]);
  const v = 0.92 + Math.random() * 0.16; out.r = Math.min(1, out.r * v); out.g = Math.min(1, out.g * v); out.b = Math.min(1, out.b * v);
  return out;
}
const GAS = [0xb8f227, 0xa6e61e, 0xc9f53e, 0x95d81a, 0xd4f752].map(c => new THREE.Color(c));
const SMOKE = [0x8a8f99, 0xa3a7ae, 0x6f747d].map(c => new THREE.Color(c));
const POO = [0x8a5526, 0xa0662e, 0x7a4a20].map(c => new THREE.Color(c));
const FIRE = [0xffd23f, 0xff8a1f, 0xff4d1a].map(c => new THREE.Color(c));
const BURP = [0xe8f0c0, 0xd8e8a8, 0xf0f4d8].map(c => new THREE.Color(c));
const WHITE = new THREE.Color(0xffffff);

// ------------------------------------------------------------
//  Трасса и тема
// ------------------------------------------------------------
let envTarget = null, envTheme = '';
function regenEnv(th) {
  if (envTheme === th) return;
  const envScene = new THREE.Scene(), dome = makeSky(th);
  envScene.add(dome);
  const next = pmrem.fromScene(envScene, 0.02, 0.1, 1000);
  scene.environment = next.texture;
  envTarget?.dispose();
  dome.geometry.dispose();
  dome.material.dispose();
  envTarget = next;
  envTheme = th;
}
// Режим комнаты: сплав (трасса) или арена
function syncMode(m) {
  if (m.arena) {
    const A = m.arena, key = `${A.mode}:${A.seed}:${A.teams.map(t => t.members.join('.') + '/' + t.shape + '/' + t.rskin + '/' + (t.side ?? '')).join('|')}`;
    if (key !== arenaKey) setupArena(A, key);
  } else {
    if (arenaKey) teardownArena();
    setLevel(m.level, m.level === DAILY && m.daily ? m.daily.seed : m.seed);
    const hostP = m.players.find(p => p.id === m.host);
    mainRV.setShape((m.rules && m.rules.raft) || 'round', (hostP && hostP.look && hostP.look.rskin) || 'classic');
  }
}
function setupArena(A, key) {
  const fresh = !arenaScene || arenaScene.mode !== A.mode || arenaScene.seed !== A.seed;
  arenaKey = key;
  arenaWorld = createArena(A.mode, A.teams, A.seed); P.setArena(arenaWorld);
  clearPickups(); clearShots();
  if (fresh) {
    if (arenaScene) { scene.remove(arenaScene.root); arenaScene.dispose(); }
    arenaScene = new ArenaScene(A.mode, A.seed, quality); arenaScene.seed = A.seed;
    scene.add(arenaScene.root);
    setTheme(arenaScene.theme, true); regenEnv(arenaScene.theme);
    camSnap = true; clearMess(); prewarm(arenaScene.root);
  }
  if (levelScene) levelScene.root.visible = false;
  mainRV.group.visible = false;
  for (const rv of arenaRVs.values()) rv.dispose();
  arenaRVs.clear();
  for (const R of arenaWorld.rafts) arenaRVs.set(R.id, new RaftVis(R.shape, (A.teams[R.id] && A.teams[R.id].rskin) || 'classic'));
}
function teardownArena() {
  arenaKey = ''; clearPickups(); clearShots();
  if (arenaScene) { scene.remove(arenaScene.root); arenaScene.dispose(); arenaScene = null; }
  for (const rv of arenaRVs.values()) rv.dispose();
  arenaRVs.clear(); arenaWorld = null;
  if (levelScene) levelScene.root.visible = true;
  mainRV.group.visible = true;
  if (tr) { P.setTrack(tr); const th = tr.themeAt(3); setTheme(th, true); regenEnv(th); }
  camSnap = true;
}
function setLevel(i, seed = 1) {
  const key = i >= ENDLESS ? `${i === DAILY ? 'd' : 'e'}${seed}` : `${i}`;
  if (key === levelKey) return;
  levelKey = key; levelIdx = i;
  if (levelScene) { scene.remove(levelScene.root); levelScene.dispose(); }
  tr = buildTrack(i, seed);
  levelScene = new LevelScene(tr, quality);
  scene.add(levelScene.root);
  P.setTrack(tr); clearPickups();
  const th = tr.themeAt(3);
  setTheme(th, true); regenEnv(th);
  $('progMarks').innerHTML = tr.endless ? '' : tr.L.checkpoints.map(s => `<div class="mk" style="left:${(s / tr.length * 100).toFixed(1)}%"></div>`).join('');
  const f = frame(tr, 3);
  camH = f.h; camPos.set(f.x - Math.sin(f.h) * 9, f.y + 9.5, f.z - Math.cos(f.h) * 9); camSnap = true;
  clearMess();
  updatePointScale();
  prewarm(); prewarmTransient();
}
function setTheme(th, instant) {
  const T = THEMES[th] || THEMES.day;
  themeT.name = th; themeT.fog.setHex(T.fog); themeT.top.setHex(T.sky[0]); themeT.bot.setHex(T.sky[1]); themeT.sun.setHex(T.sun); themeT.light = T.light || 1;
  sky.userData.uniforms.stars.value = T.stars ? 1 : 0;
  if (instant) blendTheme(1);
}
function blendTheme(k) {
  const U = sky.userData.uniforms;
  scene.fog.color.lerp(themeT.fog, k); scene.background.copy(scene.fog.color);
  U.top.value.lerp(themeT.top, k); U.bot.value.lerp(themeT.bot, k); U.sunCol.value.lerp(themeT.sun, k);
  sun.color.lerp(themeT.sun, k);
  sun.intensity = lerp(sun.intensity, 2.6 * themeT.light, k);
  hemi.intensity = lerp(hemi.intensity, 1.2 * themeT.light, k);
  scene.environmentIntensity = lerp(scene.environmentIntensity ?? 1, themeT.light, k);
}
function clearMess() { puddles.clear(); traces.clear(); stains.clear(); if (arenaScene) arenaScene.clearMess(); }

// ------------------------------------------------------------
//  Сеть
// ------------------------------------------------------------
// Сеть: WebSocket живёт в отдельном потоке (net-worker.js); если не вышло — в основном
let netW = null, ws = null, connected = false;
const ORIGIN_S = performance.timeOrigin / 1000;
const NETSTAT = { pings: [], gaps: [], lastSnapAt: 0, srvLag: 0 };
function onOpen() {
  connected = true;
  $('disconnected').classList.add('hidden');
  $('connState').textContent = 'Сервер на связи';
  $('joinBtn').disabled = false;
  P.reset();
  if (joined) sendHello();
}
function onDrop() {
  connected = false;
  $('disconnected').classList.toggle('hidden', !joined);
  $('connState').textContent = 'Нет связи с сервером, пробую снова…';
  $('joinBtn').disabled = true;
  P.snap = null;
}
function onClock(r, offAbs) {
  P.onClock(r, offAbs + ORIGIN_S);
  NETSTAT.pings.push([nowS(), r]); while (NETSTAT.pings.length > 20) NETSTAT.pings.shift();
}
function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  try {
    netW = new Worker(new URL('./net-worker.js', import.meta.url));
    netW.onmessage = (e) => {
      const d = e.data;
      if (d.t === '_msg') onMsg(JSON.parse(d.s), d.tr / 1000 - ORIGIN_S);
      else if (d.t === '_clock') onClock(d.r, d.off);
      else if (d.t === '_open') onOpen();
      else if (d.t === '_close') onDrop();
    };
    netW.onerror = () => { netW = null; connectDirect(url); };
    netW.postMessage({ t: '_connect', url });
  } catch { netW = null; connectDirect(url); }
}
function connectDirect(url) {
  ws = new WebSocket(url);
  ws.onopen = () => { onOpen(); pingDirect(); };
  ws.onclose = () => { onDrop(); setTimeout(() => connectDirect(url), 1500); };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'pong') { const t = nowS(), r = t - m.c; onClock(r, m.T + r / 2 - t - ORIGIN_S); } else onMsg(m, nowS()); };
}
const pingDirect = () => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: nowS() })); };
setInterval(() => { if (!netW) pingDirect(); }, 500);
const send = (m) => { const s = JSON.stringify(m); if (netW) netW.postMessage({ s }); else if (ws && ws.readyState === 1) ws.send(s); };
function sendHello() { send({ t: 'hello', name: $('nameInput').value.trim() || 'Бегемот', pin: $('pinInput').value.trim(), skin: selSkin }); }

function onMsg(m, tRecv = nowS()) {
  switch (m.t) {
    case 'welcome':
      if (!welcome) loadShirtPrints(m.shirtOverrides).then(() => { renderShirtPicker(); renderLobby(); });
      welcome = m; myId = P.myId = m.id; renderAddrs(); break;
    case 'room': onRoom(m); break;
    case 's': case 'a': onSnap(m, tRecv); break;
    case 'ev': playEvent(m); break;
    case 'results': lastResults = m.r; if (phase === 'results') showResults(); break;
    case 'me': me = m.p; onMe(); break;
    case 'authfail': joined = false; updateScreens(); $('authErr').textContent = m.reason; $('authErr').classList.remove('hidden'); $('pinInput').focus(); break;
    case 'prof': showProfile(m.p, false); break;
    case 'top': showTop(m); break;
    case 'coins': onCoins(m); break;
    case 'boxres': onBoxRes(m); break;
    case 'shopres': if (m.err) { toast(m.err, '', 'sm', 1800); boxBusy = false; } break;
    case 'quest': { const Q = QUESTS.find(q => q.id === m.id); if (Q) { toast('Задание выполнено!', `${Q.text} · +${Q.coins} ${COIN}`, 'ach', 2600); sfx.ach(1); } break; }
    case 'welcomeGift': toast(`Стартовый капитал: ${m.coins} ${COIN}`, 'и золотой сундук в подарок! Загляните в «Подарки»', 'ach', 4200); sfx.reveal(2); break;
  }
}
function onSnap(m, tRecv) {
  const prev = P.snap;
  if (!P.onSnap(m, tRecv)) return;
  if (NETSTAT.lastSnapAt) NETSTAT.gaps.push([tRecv, tRecv - NETSTAT.lastSnapAt]);
  while (NETSTAT.gaps.length > 90) NETSTAT.gaps.shift();
  NETSTAT.lastSnapAt = tRecv; NETSTAT.srvLag = m.lg || 0;
  if (m.t === 's' && prev && prev.t === 's' && m.st === 0 && prev.st === 0) {
    const dv = Math.hypot(m.vx - prev.vx, m.vz - prev.vz);
    if (dv > 2.6) playEvent({ k: 'bump', mag: Math.min(1, dv / 8) });
  }
}
function onRoom(m) {
  const prevPhase = phase;
  room = m; P.rules = m.rules;
  P.setPerks(new Map(m.players.map(p => [p.id, perkMods(p.look, m.rules.perks !== false)])));
  if (!DEBUG_VIEW.length) syncMode(m);
  phase = m.phase;
  const mine = m.players.find(p => p.id === myId);
  if (mine) selSkin = mine.skin;
  renderLobby(); renderShirtPicker(); updateScreens();
  if (!$('wardrobe').classList.contains('hidden')) renderWardrobe();
  if (phase === 'results') {
    const isHost = m.host === myId;
    $('resBtns').classList.toggle('hidden', !isHost);
    $('resWait').classList.toggle('hidden', isHost);
    $('resTourReset').classList.toggle('hidden', !isHost || !m.arena || m.arena.practice);
    if (prevPhase !== 'results') showResults();
    else if (m.arena) $('resTourTable').innerHTML = tourTable(m.tour, true);
  }
  if (phase === 'count' && prevPhase !== 'count') clearMess();
  for (const p of m.players) { const h = hippos.get(p.id); if (h && h.key !== hippoKey(p)) removeHippo(p.id); }
}
function onMe() {
  if (!me) return;
  renderLobby();
  if (!$('wardrobe').classList.contains('hidden')) renderWardrobe();
  if (modalKind === 'profile-me') showProfile(me, true);
  if (modalKind === 'shop') renderShop();
}

// ------------------------------------------------------------
//  Интерфейс
// ------------------------------------------------------------
const TEE = (fill) => `<svg viewBox="0 0 64 64"><path d="M19 4 L26 4 Q32 16 38 4 L45 4 L46 19 Q55 27 53 61 L11 61 Q9 27 18 19 Z" fill="${fill}" stroke="#1a2238" stroke-width="3.5" stroke-linejoin="round"/></svg>`;
const shirtImg = (i) => shirtImages[i];
const shirtHTML = (i, sel, taken) => `<button type="button" class="shirt ${sel ? 'sel' : ''} ${taken ? 'taken' : ''}" data-skin="${i}" aria-pressed="${sel}" title="${esc(SKINS[i].name)}"><span class="tee">${TEE(SKINS[i].css)}<img src="${shirtImg(i)}" alt=""></span>${SKINS[i].name}</button>`;
const takenSkins = () => room ? new Set(room.players.filter(p => p.id !== myId).map(p => p.skin)) : new Set();
function renderShirtPicker() { const t = takenSkins(); $('shirtPick').innerHTML = SKINS.map((s, i) => shirtHTML(i, i === selSkin, t.has(i))).join(''); }
$('shirtPick').addEventListener('click', (e) => { const el = e.target.closest('.shirt'); if (!el) return; selSkin = +el.dataset.skin; lsSet('puk.skin', selSkin); renderShirtPicker(); });

// значки достижений
const STAT_ICON = { farts: '💨', fartTime: '🎺', shits: '💩', misfires: '💦', overheats: '🔥', ejects: '🌊', faints: '😵', gassed: '☠️', burps: '🫧', syncs: '🤝', sync3: '🤝', sync4: '🤝', cps: '🚩', finishes: '🏁', meters: '📏', blame: '🙈', pops: '🎈', bites: '🐊', smashes: '🪨', falls: '🏞️', geysers: '⛲', emotes: '💬', sprayRelease: '✋', endlessBest: '♾️', finished: '🏁', gold: '🥇', clean: '✨', kos: '☠️', arenaWins: '🏆', goals: '⚽', dailies: '📅', hits: '🎯', pickups: '🌶️', beans: '🫘', boxes: '🎁', legends: '🌟', collected: '👗', gifts: '💝', quests: '✅', megas: '💥', coinsEarned: '🪙', infects: '🧟', bombPasses: '💣', laps: '🏁' };
const SPECIAL_ICON = { all_finish: '🗺️', all_gold: '👑', all_clean: '💎', gold_any: '🥇', record: '🏆', solo: '🦛', full_raft: '🛟', dry_pants: '🩲', triple_blame: '🙈', innocent: '😇', hot_race: '🌶️', double_eject: '🤸', night_owl: '🦉', marathon: '🏃', combo: '🎰', speed: '⚡', spin: '🌀', false_start: '⏱️', fashion: '👗', show_off: '📌', gassed_all: '☣️', stinky_win: '🤢', ach_25: '🎖️', ach_50: '🏵️', ach_100: '🌟', flawless: '👃', triple_ko: '💥', ring_out: '🫸', king_win: '👑', shutout: '🧤', champ: '🏆', center_1: '🎯', center_fin: '🧭', mega_ko: '☢️', perk_full: '👑', shot_win: '💩', royale_win: '🌀', beans_win: '🫘', bomb_win: '💣', laps_win: '🏁', zombie_win: '🧟', lvl_10: '⭐', lvl_25: '🌟' };
const achIcon = (a) => (a.kind === 'special' ? SPECIAL_ICON[a.id] : STAT_ICON[a.stat]) || '⭐';
const achBadge = (id, cls = '') => { const a = ACH[id]; if (!a) return ''; const T = TIER[a.tier]; return `<span class="ach-badge ${cls}" style="--tc:${T.color}" title="${esc(a.name)}: ${esc(a.desc)} (${T.name})">${achIcon(a)}</span>`; };

// Кольцо-плот, поделённое на сектора игроков
function segPath(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}
const WORDS = ['', 'один', 'двоих', 'троих', 'четверых', 'пятерых'];
const SHARE = ['', 'вся кромка', 'половина кромки', 'треть кромки', 'четверть кромки'];
const isArena = () => !!(room && room.arena);
const canShoot = () => !!(room && room.arena && ARENA_MODES[room.arena.mode] && ARENA_MODES[room.arena.mode].shoot);
function renderDial() {
  const seated = room ? room.players.filter(p => p.seat >= 0).sort((a, b) => a.seat - b.seat) : [];
  const rim = seated.filter(p => !isCenter(p.seat)), center = seated.find(p => isCenter(p.seat)), n = rim.length;
  let svg = `<defs><clipPath id="floorClip"><circle cx="110" cy="110" r="62"/></clipPath></defs><circle cx="110" cy="110" r="64" fill="#c99a62" stroke="#1a2238" stroke-width="3"/>`;
  for (let k = 0; k < 7; k++) svg += `<line x1="${50 + k * 20}" y1="60" x2="${50 + k * 20}" y2="160" stroke="rgba(80,50,20,.35)" stroke-width="2" clip-path="url(#floorClip)"/>`;
  if (n === 0) svg += `<circle cx="110" cy="110" r="80" fill="none" stroke="#f6e2c8" stroke-width="30"/><circle cx="110" cy="110" r="95" fill="none" stroke="#1a2238" stroke-width="3"/><circle cx="110" cy="110" r="65" fill="none" stroke="#1a2238" stroke-width="3"/>`;
  const gap = n > 1 ? 0.06 : 0;
  rim.forEach((p, k) => {
    const c = Math.PI + k * 2 * Math.PI / n, h = Math.PI / n;
    const a0 = n === 1 ? 0 : c - h + gap, a1 = n === 1 ? Math.PI * 2 - 0.0001 : c + h - gap;
    svg += `<path d="${segPath(110, 110, 66, 95, a0, a1)}" fill="${SKINS[p.skin].css}" stroke="#1a2238" stroke-width="3" stroke-linejoin="round"/>`;
    const lx = 110 + Math.sin(c) * 108, ly = 110 - Math.cos(c) * 108;
    svg += `<text x="${lx}" y="${ly + 4}" text-anchor="${Math.abs(Math.sin(c)) < 0.3 ? 'middle' : Math.sin(c) > 0 ? 'start' : 'end'}">${esc(p.name)}</text>`;
  });
  if (n > 1) for (let k = 0; k < n; k++) { const b = Math.PI + k * 2 * Math.PI / n + Math.PI / n; svg += `<circle cx="${110 + Math.sin(b) * 80.5}" cy="${110 - Math.cos(b) * 80.5}" r="6" fill="#1a2238"/>`; }
  if (center) svg += `<circle cx="110" cy="110" r="24" fill="${SKINS[center.skin].css}" stroke="#1a2238" stroke-width="3"/><path d="M110 92 A18 18 0 1 1 92 110" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M92 104 L92 111 L99 111" fill="none" stroke="#fff" stroke-width="3"/><text x="110" y="148" text-anchor="middle">${esc(center.name)}</text>`;
  $('dial').innerHTML = svg;
  $('dialText').textContent = n === 0 ? 'На плоту пока пусто' : (n === 1 ? 'Один бегемот: ему вся кромка. Позовите друзей!' : `На кромке ${WORDS[n]}: у каждого ${SHARE[n]}`) + (center ? `. ${center.name} — в центре, крутится как хочет` : n === 4 ? '. Пятый сядет в центр' : '');
}

const shapeChips = () => RAFT_SHAPE_IDS.map(id => [id, `${RAFT_SHAPES[id].icon} ${RAFT_SHAPES[id].name}`]);
const RULE_UI = [
  { k: 'raft', name: 'Плот на сплаве', hint: 'форма общего плота', opts: shapeChips(), when: () => !isArena() },
  { k: 'faint', name: 'Обморок от вони', hint: 'коричневый дым в лицо — отключка', opts: [[true, 'Вкл'], [false, 'Выкл']], when: () => !isArena() },
  { k: 'faintTime', name: 'Длительность обморока', opts: [[2, '2 с'], [3, '3 с'], [4, '4 с'], [5, '5 с']], when: (r) => r.faint || isArena() },
  { k: 'misfire', name: 'Холостой с жидким', hint: 'вместо пука — обделался', opts: MISFIRE_LEVELS.map(x => [x.v, x.name]) },
  { k: 'burps', name: 'Отрыжки', opts: [[true, 'Вкл'], [false, 'Выкл']] },
  { k: 'pickups', name: 'Бонусы на трассе', hint: 'бобы, перец, прищепки', opts: [[true, 'Вкл'], [false, 'Выкл']], when: () => !isArena() },
  { k: 'lives', name: 'Жизни (бесконечный, задание дня)', opts: [[3, '3'], [5, '5'], [9, '9']], when: () => !isArena() },
  { k: 'perks', name: 'Бафы легендарок', hint: 'у каждого бафа есть и минус', opts: [[true, 'Вкл'], [false, 'Выкл']], when: () => room.mode !== 'tow' },
  { k: 'ult', name: 'Мега-пук', hint: 'копится за игру, кнопка Q', opts: [[true, 'Вкл'], [false, 'Выкл']] },
  { k: 'events', name: 'События на арене', hint: 'водоворот, ураган, бобовый дождь', opts: [[true, 'Вкл'], [false, 'Выкл']], when: () => isArena() && !['ball','tow'].includes(room.mode) },
];
function renderRules() {
  if (!room) return;
  const r = room.rules, isHost = room.host === myId;
  $('rulesBox').innerHTML = RULE_UI.filter(u => !u.when || u.when(r)).map(u => `<div class="rule"><div class="rn">${u.name}${u.hint ? `<small>${u.hint}</small>` : ''}</div><div class="chips">${u.opts.map(([v, n]) => `<button class="chip ${(r[u.k] ?? 'round') === v ? 'on' : ''}" data-k="${u.k}" data-v='${JSON.stringify(v)}' ${isHost ? '' : 'disabled'}>${n}</button>`).join('')}</div></div>`).join('') + (isHost ? '' : '<p class="note">Правила меняет хост.</p>');
  if (room.rules.raft && !isArena()) $('rulesBox').insertAdjacentHTML('beforeend', `<p class="note">${esc(shapeOf(room.rules.raft).desc)}</p>`);
}
$('rulesBox').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b || !room || room.host !== myId) return;
  send({ t: 'rules', rules: { ...room.rules, [b.dataset.k]: JSON.parse(b.dataset.v) } });
});

// режимы: сплав по трассам или арена
function renderModes() {
  const isHost = room.host === myId, cur = room.mode || 'race';
  const list = [['race', '🛶', 'Сплав', 'трассы'], ...MODE_KEYS.map(k => [k, ARENA_MODES[k].icon, ARENA_MODES[k].name, ARENA_MODES[k].sub])];
  $('modeName').textContent = cur === 'race' ? 'Сплав' : ARENA_MODES[cur].name;
  $('modeChips').innerHTML = list.map(([k, ic, n, sub]) => `<button class="mode ${cur === k ? 'on' : ''}" data-mode="${k}" aria-pressed="${cur === k}" ${isHost ? '' : 'disabled'}><span class="mi">${ic}</span><b>${n}</b><small>${sub}</small></button>`).join('');
  const A = room.arena;
  $('arenaBox').classList.toggle('hidden', !A);
  $('levelList').classList.toggle('hidden', !!A);
  $('trackTitle').textContent = A ? 'Арена' : 'Трасса';
  $('dialWrap').classList.toggle('hidden', !!A);
  if (A) {
    const M = ARENA_MODES[A.mode];
    const goalTxt = modeGoalText(A.mode);
    const tow = A.mode === 'tow';
    const artFile = tow ? 'art/tow-harbor.webp' : A.mode === 'ball' ? 'art/pukoball.webp' : `art/routes/${M.theme}.webp`;
    const art = `<img class="arena-art" src="${artFile}" alt="" width="800" height="450">`;
    const format = tow ? (A.practice ? 'Тренировка · 90 секунд' : '90 секунд · при ничьей ещё 15') : `раунд ${fmtTime(M.time).slice(0, -2)}`;
    const crewNote = tow
      ? 'У оранжевого причала флаг с солнцем, у синего — с якорем. Подойдите к утке медленно, и трос зацепится сам.'
      : 'Форму своего плота на арене выберите в гардеробе.' + (A.mode === 'hunger2' ? ' Пары собираются по порядку входа.' : A.mode === 'ball' ? ' Команды собираются через одного по порядку входа.' : '');
    $('arenaBox').innerHTML = `<div class="arena-card">${art}<div class="ah">${M.icon} <b>${M.name}</b> <small>${M.sub}</small></div><p>${esc(M.desc)}</p>
      <div class="goal">${goalTxt} · ${format}</div>
      <div class="teams">${A.teams.map(t => `<div class="tm" style="--tc:${t.color}"><i></i><b>${esc(t.name)}</b><span title="${esc(shapeOf(t.shape).name)}">${shapeOf(t.shape).icon}</span></div>`).join('') || '<span class="note">Нужен хотя бы один игрок</span>'}</div>
      <p class="note">${crewNote}</p>
      <div class="row"><button class="btn sm" id="tourBtn">🏆 Турнирная таблица${room.tour && room.tour.rounds ? ` (${room.tour.rounds})` : ''}</button></div></div>`;
    $('tourBtn').onclick = () => showTour();
  }
}
$('modeChips').addEventListener('click', (e) => {
  const button = e.target.closest('[data-mode]');
  if (!button || room?.host !== myId) return;
  send({ t: 'mode', mode: button.dataset.mode });
  closePicker($('modePicker'));
});

function closePicker(details) {
  details.open = false;
  details.querySelector('summary').focus({ preventScroll: true });
}

function routeInfo(index) {
  if (index === ENDLESS || index === DAILY) {
    const daily = index === DAILY, info = daily ? DAILY_INFO : ENDLESS_INFO;
    const mutator = daily ? dailyMutator(room.daily.seed) : null;
    const record = room.records[daily ? 'daily:' + room.daily.date : 'endless'];
    const best = daily ? (me?.data.daily?.date === room.daily.date ? me.data.daily.best : 0) : me?.endlessBest;
    return {
      title: info.name, badge: daily ? '☀' : '∞', art: daily ? 'daily' : 'endless',
      description: daily ? `${mutator.name}. ${mutator.desc}. ${info.desc}` : info.desc,
      goal: `Жизней: ${room.rules.lives}${best ? ' · ваш рекорд ' + fmtDist(best) : ''}`,
      record: record ? `${daily ? 'Лучший сегодня' : 'Рекорд'} ${fmtDist(record.dist)} · ${record.names.join(', ')}` : daily ? 'Сегодня ещё никто не плавал' : '',
    };
  }
  const level = room.levels[index], medal = medalTimes(index), record = room.records[index], best = me?.data.bests?.[index];
  return {
    title: level.name, badge: String(index + 1), art: ['day', 'rapids', 'spikes'][index] || level.theme,
    description: level.desc,
    goal: `Золото ${fmtTime(medal.gold)} · Серебро ${fmtTime(medal.silver)}${best ? ' · ваше время ' + fmtTime(best) : ''}`,
    record: record ? `${['', 'Бронза', 'Серебро', 'Золото'][medalFor(index, record.time)]}, рекорд ${fmtTime(record.time)} · ${record.names.join(', ')}` : '',
  };
}

let lastRouteChoices = '';
function renderRoutes() {
  if (room.arena) return;
  const indices = [...room.levels.keys(), ENDLESS];
  if (room.daily) indices.push(DAILY);
  const active = routeInfo(room.level), canSelect = room.host === myId;
  $('routeCard').innerHTML = `<div class="route-cover"><img src="art/routes/${active.art}.webp" alt="">
    <h4 id="routeName">${esc(active.title)}</h4></div><div class="route-copy"><p>${esc(active.description)}</p>
    <p class="route-goal">${esc(active.goal)}</p>${active.record ? `<p class="route-record">${esc(active.record)}</p>` : ''}</div>`;
  const choices = indices.map(i => {
    const r = routeInfo(i), current = i === room.level;
    return `<button type="button" class="route-choice" data-level="${i}" aria-pressed="${current}" ${canSelect ? '' : 'disabled'} title="${esc([r.description, r.goal, r.record].filter(Boolean).join(' · '))}">
      <img loading="lazy" src="art/routes/${r.art}.webp" alt="" width="60" height="54"><span><small>${i < ENDLESS ? 'Трасса ' : ''}${r.badge}</small><b>${esc(r.title)}</b></span></button>`;
  }).join('');
  if (choices !== lastRouteChoices) {
    $('routeChoices').innerHTML = choices;
    lastRouteChoices = choices;
  }
}

function renderLobby() {
  if (!room) return;
  renderModes(); renderDial(); renderRules();
  $('playerList').innerHTML = room.players.map(p => `
    <div class="pl ${p.id === myId ? 'me' : ''}" data-name="${esc(p.name)}" data-bot="${p.bot ? 1 : 0}"><div class="sw" style="background:${SKINS[p.skin].css}"></div>
      <span class="nm">${esc(p.name)}</span>${room.rules.perks !== false ? perksOf(p.look).map(k => `<span class="perk-ic" title="${esc(k.name)}: ${esc(k.plus)}; минус: ${esc(k.minus)}">${k.ic}</span>`).join('') : ''}<span class="pins">${(p.pinned || []).map(id => achBadge(id, 'sm')).join('')}</span>
      ${p.lvl ? `<span class="tag lvl" title="${esc(rankTitle(p.lvl))}">ур. ${p.lvl}</span>` : ''}${p.achCount ? `<span class="tag ach" title="Достижений">🏅${p.achCount}</span>` : ''}${p.bot ? '<span class="tag bot">бот</span>' : ''}${p.id === room.host ? '<span class="tag">хост</span>' : ''}${isCenter(p.seat) && !isArena() ? '<span class="tag ctr">центр</span>' : ''}${p.seat < 0 ? '<span class="tag spec">зритель</span>' : ''}
    </div>`).join('');
  const taken = takenSkins();
  $('myLook').innerHTML = SKINS.map((s, i) => shirtHTML(i, i === selSkin, taken.has(i))).join('');
  const isHost = room.host === myId;
  renderRoutes();
  $('startBtn').textContent = room.mode === 'tow' ? (room.arena.practice ? 'Начать тренировку' : 'На буксир!') : isArena() ? 'В бой!' : 'Поплыли!';
  $('startBtn').classList.toggle('hidden', !isHost);
  $('botBtns').classList.toggle('hidden', !isHost || isArena());
  $('addBotBtn').disabled = room.players.length >= RIM_SEATS;
  $('delBotBtn').disabled = !room.players.some(p => p.bot);
  $('waitHost').classList.toggle('hidden', isHost);
  const LV = me ? levelOf(me.data.xp || 0) : null;
  $('meBox').innerHTML = me ? `<b>${esc(me.name)}</b> · 🏅 ${me.achCount} из ${ACHIEVEMENTS.length}${me.hasPin ? ' · 🔒' : ''} · <span class="coins">${COIN} ${me.data.coins ?? 0}</span><span class="lvbar" title="До следующего уровня: ${LV.need - LV.cur} опыта (опыт = заработанные пукоины)"><b>ур. ${LV.lvl}</b> ${esc(LV.title)}<i><u style="width:${Math.round(LV.cur / LV.need * 100)}%"></u></i></span>` : '';
  const nb = giftCount(); $('shopBtn').innerHTML = `🎁 Подарки${nb ? ` <span class="badge-n">${nb}</span>` : ''}`;
}
$('myLook').addEventListener('click', (e) => {
  const sh = e.target.closest('.shirt');
  if (sh) { selSkin = +sh.dataset.skin; lsSet('puk.skin', selSkin); send({ t: 'look', skin: selSkin }); }
});
$('playerList').addEventListener('click', (e) => { const el = e.target.closest('.pl'); if (!el || el.dataset.bot === '1') return; if (me && el.dataset.name === me.name) openMyProfile(); else send({ t: 'getprof', name: el.dataset.name }); });
$('routeChoices').addEventListener('click', (e) => {
  const button = e.target.closest('[data-level]');
  if (!button || room?.host !== myId) return;
  send({ t: 'level', level: Number(button.dataset.level) });
  closePicker($('routePicker'));
});
$('addBotBtn').onclick = () => send({ t: 'addbot' });
$('delBotBtn').onclick = () => send({ t: 'removebot' });
$('startBtn').onclick = () => { sfx.init(); send({ t: 'start', level: room.level }); };
$('againBtn').onclick = () => send({ t: 'again' });
$('nextBtn').onclick = () => send({ t: 'next' });
$('lobbyBtn').onclick = () => send({ t: 'lobby' });
$('profBtn').onclick = () => openMyProfile();
$('topBtn').onclick = () => { send({ t: 'top' }); openModal('top', '<p class="note">Загружаю…</p>'); };
$('wardBtn').onclick = () => openWardrobe();
$('shopBtn').onclick = () => openShop();

function renderAddrs() {
  if (!welcome) return;
  const list = welcome.addrs.map(a => `http://${a}:${welcome.port}`);
  if (!/localhost|127\.0\.0\.1/.test(location.origin) && !list.includes(location.origin)) list.unshift(location.origin);
  $('addrList').innerHTML = list.map(a => `<div class="addr">${a}</div>`).join('') || '<p class="note">Адрес не найден. Проверьте, что компьютер подключён к сети.</p>';
}
function updateScreens() {
  const arena = isArena(), endless = !arena && levelIdx >= ENDLESS;
  $('join').classList.toggle('hidden', joined || DEBUG_VIEW.length > 0);
  if (joined && !frameRequest && !DEBUG_VIEW.length) {
    lastFrame = fpsT = nowS();
    fpsAcc = fpsN = frameWorst = lowFpsStreak = 0;
    frameRequest = requestAnimationFrame(animate);
  }
  $('lobby').classList.toggle('hidden', !joined || phase !== 'lobby');
  document.body.classList.toggle('in-lobby', joined && phase === 'lobby');
  document.body.classList.toggle('tow-match', room?.mode === 'tow' && (phase === 'race' || phase === 'count'));
  if (room?.mode !== 'tow' || phase !== 'race') {
    $('towGuide').classList.add('hidden');
    $('timer').classList.remove('overtime');
  }
  $('hud').classList.toggle('hidden', !joined);
  $('results').classList.toggle('hidden', !joined || phase !== 'results');
  $('emotes').classList.toggle('hidden', !joined || phase === 'results');
  $('timer').classList.toggle('hidden', phase === 'lobby');
  $('topbar').classList.toggle('hidden', phase === 'lobby' || endless || arena);
  $('endlessHud').classList.toggle('hidden', phase === 'lobby' || !endless);
  $('arenaHud').classList.toggle('hidden', !arena || !joined || (room.mode === 'tow' && phase === 'lobby'));
  $('help').innerHTML = '<b>Пробел</b> — пукнуть &nbsp; <b>A / D</b> — ползти по кромке (в центре — крутиться)' + (canShoot() ? ' &nbsp; <b>E / правая кнопка</b> — выстрел калом' : '') + (room && room.rules.ult !== false ? ' &nbsp; <b>Q</b> — мега-пук' : '') + ' &nbsp; <b>Мышь</b> — камера &nbsp; <b>M</b> — звук &nbsp; <b>F3</b> — статистика';
  const mine = room && room.players.find(p => p.id === myId);
  $('spectator').classList.toggle('hidden', !joined || !mine || mine.seat >= 0);
  if (phase !== 'count') $('count').classList.add('hidden');
  if (phase !== 'lobby') closeWardrobe();
}

$('nameInput').value = lsGet('puk.name', '');
$('joinBtn').disabled = true;
$('joinBtn').onclick = () => {
  sfx.init();
  $('authErr').classList.add('hidden');
  lsSet('puk.name', $('nameInput').value.trim());
  joined = true; sendHello(); updateScreens();
  $('nameInput').blur(); $('pinInput').blur();
};
for (const id of ['nameInput', 'pinInput']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

function toast(title, sub = '', cls = '', dur = 2200) {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = esc(title) + (sub ? `<div class="sub">${esc(sub)}</div>` : '');
  const box = $('toasts'); box.innerHTML = ''; box.appendChild(el);
  setTimeout(() => el.classList.add('out'), dur); setTimeout(() => el.remove(), dur + 500);
}
function feed(text) {
  const el = document.createElement('div'); el.textContent = text; $('feed').appendChild(el);
  setTimeout(() => el.style.opacity = 0, 4200); setTimeout(() => el.remove(), 4800);
  while ($('feed').children.length > 5) $('feed').firstChild.remove();
}
function achToast(id) {
  const a = ACH[id]; if (!a) return;
  const T = TIER[a.tier];
  const el = document.createElement('div'); el.className = 'ach-toast'; el.style.setProperty('--tc', T.color);
  el.innerHTML = `${achBadge(id, 'lg')}<div><div class="at">${esc(T.name)} достижение</div><b>${esc(a.name)}</b><div class="ad">${esc(a.desc)}</div></div>`;
  $('achToasts').appendChild(el);
  while ($('achToasts').children.length > 3) $('achToasts').firstChild.remove();
  setTimeout(() => el.classList.add('out'), 4200); setTimeout(() => el.remove(), 4800);
  sfx.ach(T.rank);
}
function tourTable(tour, compact = false) {
  if (!tour || !tour.rows.length) return '<p class="note">Турнир ещё не начался: сыграйте раунд на арене.</p>';
  return `<table class="tour"><thead><tr><th>#</th><th>Игрок</th><th title="Очки: за место (5/3/2/1) + по очку за каждого вырубленного">Очки</th><th>Побед</th><th title="Вырубил соперников">☠️</th><th title="Отключался сам">😵</th>${compact ? '' : '<th>Раундов</th>'}</tr></thead><tbody>` +
    tour.rows.map((r, i) => `<tr class="${me && r.name === me.name ? 'me' : ''}"><td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td><td><span class="dot" style="background:${SKINS[r.skin || 0].css}"></span>${esc(r.name)}</td><td><b>${r.pts}</b></td><td>${r.wins}</td><td>${r.kos}</td><td>${r.faints}</td>${compact ? '' : `<td>${r.rounds}</td>`}</tr>`).join('') + '</tbody></table>';
}
function showTour() {
  const isHost = room && room.host === myId;
  openModal('tour', `<h2 class="logo small">Турнирная таблица</h2><p class="note">Раундов сыграно: ${room && room.tour ? room.tour.rounds : 0}. Очки: за место в раунде 5 / 3 / 2 / 1 плюс по очку за каждого вырубленного соперника. Таблица живёт, пока хост её не сбросит.</p>${tourTable(room && room.tour)}${isHost ? '<div class="row" style="margin-top:12px"><button class="btn ghost" id="tourResetBtn">Сбросить турнир</button></div>' : ''}`);
  const b = $('tourResetBtn'); if (b) b.onclick = () => { send({ t: 'tourReset' }); closeModal(); };
}
function showArenaResults(r) {
  const M = ARENA_MODES[r.mode];
  const win = !r.aborted && r.winner >= 0 ? r.teams.find(t => t.place === 0) : null;
  const mine = r.teams.find(t => t.members.some(p => p.id === myId))
    || (me && r.teams.find(t => t.members.some(p => p.name === me.name)));
  const myWin = !!win && mine === win;
  $('results').dataset.art = myWin ? 'finish' : 'landing';
  if (myWin) sfx.fanfare();
  $('resTitle').textContent = r.aborted ? 'Раунд прерван' : !win ? 'Ничья' : myWin ? 'Победа!' : 'Раунд окончен';
  $('resLevel').textContent = `${M.name}${M.sub ? ' · ' + M.sub : ''}`;
  $('resMetricLabel').textContent = 'Время раунда';
  $('resTime').textContent = fmtTime(r.time);
  $('resRecord').classList.add('hidden');
  $('resMedal').textContent = '';
  if (win) {
    $('resMetricLabel').textContent = mine ? 'Место экипажа' : 'Победитель';
    $('resTime').textContent = mine ? `${mine.place + 1} из ${r.teams.length}` : win.name;
    $('resTime').classList.toggle('team-name', !mine);
    $('resMedal').textContent = mine && !myWin ? `Победитель — ${win.name} · ${fmtTime(r.time)}` : `Время раунда · ${fmtTime(r.time)}`;
  }
  $('resStats').innerHTML = r.teams.slice(0, 5).map(t => `<div class="team-score" style="--team-color:${t.color}"><b>${t.score}</b>${esc(t.name)}</div>`).join('');
  const aw = [];
  const all = r.teams.flatMap(t => t.members);
  const best = all.slice().sort((a, b) => b.kos - a.kos)[0], sleepy = all.slice().sort((a, b) => b.faints - a.faints)[0];
  if (best && best.kos) aw.push(`<div class="award">☠️ <b>Главный газовщик:</b> ${esc(best.name)}, вырубил ${best.kos} ${plural(best.kos, 'раз', 'раза', 'раз')}</div>`);
  if (sleepy && sleepy.faints) aw.push(`<div class="award">😵 <b>Слабый нос:</b> ${esc(sleepy.name)}, в отключке ${sleepy.faints} ${plural(sleepy.faints, 'раз', 'раза', 'раз')}</div>`);
  $('resAwards').innerHTML = aw.join('');
  $('resTourTable').innerHTML = tourTable(r.tour, true);
  $('resTour').classList.toggle('hidden', !!r.practice);
  $('againBtn').textContent = r.mode === 'tow' ? (r.practice ? 'Ещё тренировка' : 'Реванш') : 'Следующий раунд';
  $('nextBtn').classList.add('hidden');
  if (r.practice) {
    $('resTitle').textContent = r.aborted ? 'Тренировка прервана' : 'Тренировка окончена';
    $('resLevel').textContent = 'Утка на буксире · тренировка';
    $('resMetricLabel').textContent = 'Доставлено уток';
    $('resTime').textContent = `${r.teams[0]?.score || 0} из ${M.goal}`;
    $('resMedal').textContent = `Время на воде · ${fmtTime(r.time)}`;
    $('resStats').replaceChildren();
  }
  coinsAward();
}
$('resTourReset').onclick = () => send({ t: 'tourReset' });
function showResults() {
  const r = lastResults; if (!r) return;
  lastResults = null;
  sfx.stopAll();
  // Keep the finish-line achievements with the score after their HUD notices expire.
  const achievements = [...$('achToasts').querySelectorAll('.ach-toast:not(.out)')].map(toast => {
    const item = toast.cloneNode(true);
    toast.remove();
    item.className = 'res-achievement';
    return item;
  });
  $('resAchievements').replaceChildren(...achievements);
  $('resScroll').scrollTop = 0;
  $('resScroll').focus({ preventScroll: true });
  $('results').onkeydown = e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.stopPropagation();
  };
  $('resTime').classList.remove('team-name');
  if (r.arena) { showArenaResults(r); return; }
  $('resTour').classList.add('hidden'); $('nextBtn').classList.remove('hidden'); $('againBtn').textContent = 'Ещё раз';
  const endless = !!r.endless;
  const finished = !endless && !r.aborted;
  $('results').dataset.art = finished ? 'finish' : 'landing';
  if (finished) sfx.fanfare();
  $('resTitle').textContent = r.aborted ? 'Заплыв прерван' : endless ? 'Заплыв окончен' : 'Финиш!';
  $('resLevel').textContent = endless ? `${r.daily ? DAILY_INFO.name : ENDLESS_INFO.name} · ${fmtTime(r.time)} в пути` : `${r.level + 1}. ${LEVELS[r.level].name}`;
  $('resMetricLabel').textContent = endless ? 'Дистанция' : 'Время экипажа';
  $('resTime').textContent = endless ? fmtDist(r.dist) : fmtTime(r.time);
  $('resRecord').textContent = r.daily ? 'Новый рекорд дня' : endless ? 'Новый рекорд дистанции' : 'Новый рекорд трассы';
  $('resRecord').classList.toggle('hidden', !r.isRecord);
  $('resMedal').textContent = '';
  if (endless) {
    const day = me?.data.daily;
    const best = r.daily ? (day && day.date === room?.daily?.date ? day.best : 0) : me?.endlessBest;
    if (best) $('resMedal').textContent = `Личный рекорд · ${fmtDist(best)}`;
  } else if (finished) {
    const md = r.medal || medalFor(r.level, r.time), mt = medalTimes(r.level);
    const target = md === 2 ? mt.gold : mt.silver;
    $('resMedal').innerHTML = `<span class="disc m${md}" aria-hidden="true"></span>${['', 'Бронза', 'Серебро', 'Золото'][md]}` + (md < 3 ? ` <span class="note">До ${md === 2 ? 'золота' : 'серебра'} не хватило ${(r.time - target).toFixed(1)} с</span>` : '');
  }
  const cr = r.crashes || {}, total = (cr.pop || 0) + (cr.smash || 0) + (cr.bite || 0);
  const shits = r.team.reduce((a, t) => a + t.shits, 0), ejects = r.team.reduce((a, t) => a + t.ejects, 0), faints = r.team.reduce((a, t) => a + (t.faints || 0), 0);
  $('resStats').innerHTML = `<div><b>${total}</b>аварий</div><div><b>${cr.fall || 0}</b>падений</div><div><b>${ejects}</b>за бортом</div><div><b>${shits}</b>щелчков</div><div><b>${faints}</b>обмороков</div>`;
  const aw = [];
  aw.push(r.culprit ? `<div class="award">🙈 <b>Главный виновник:</b> ${esc(r.culprit.name)}, ${r.culprit.n} ${plural(r.culprit.n, 'авария', 'аварии', 'аварий')}. Игра запомнила.</div>` : `<div class="award">😇 <b>Ни одной аварии по чьей-то вине.</b> Подозрительно дружная команда.</div>`);
  if (r.shitter) aw.push(`<div class="award">💩 <b>Щелкун заезда:</b> ${esc(r.shitter.name)}, щёлкнул ${r.shitter.n} ${plural(r.shitter.n, 'раз', 'раза', 'раз')}</div>`);
  if (r.gasser) aw.push(`<div class="award">☠️ <b>Газовая атака:</b> ${esc(r.gasser.name)} вырубил товарищей ${r.gasser.n} ${plural(r.gasser.n, 'раз', 'раза', 'раз')}</div>`);
  if (r.sleeper) aw.push(`<div class="award">😵 <b>Слабый нос:</b> ${esc(r.sleeper.name)}, в отключке ${r.sleeper.n} ${plural(r.sleeper.n, 'раз', 'раза', 'раз')}</div>`);
  if (r.flyer) aw.push(`<div class="award">🌊 <b>Летающий бегемот:</b> ${esc(r.flyer.name)}, за бортом ${r.flyer.n} ${plural(r.flyer.n, 'раз', 'раза', 'раз')}</div>`);
  if (r.hot) aw.push(`<div class="award">🔥 <b>Горячая попа:</b> ${esc(r.hot.name)}, перегрелся ${r.hot.n} ${plural(r.hot.n, 'раз', 'раза', 'раз')}</div>`);
  if (r.farter) aw.push(`<div class="award">💨 <b>Самый газовый:</b> ${esc(r.farter.name)}, ${r.farter.n} с пуков</div>`);
  aw.push(`<div class="award">🤝 <b>Синхронных пуков:</b> ${r.syncs}${r.bestSync ? `, лучший на ${r.bestSync}` : ''}</div>`);
  if (!r.isRecord && r.record) aw.push(`<div class="award">🏆 <b>Рекорд:</b> ${endless ? fmtDist(r.record.dist) : fmtTime(r.record.time)}, ${esc(r.record.names.join(', '))}</div>`);
  $('resAwards').innerHTML = aw.join('');
  $('nextBtn').textContent = r.level + 1 === ENDLESS ? 'Бесконечный сплав' : r.level === ENDLESS ? 'С первой трассы' : r.level === DAILY ? 'Бесконечный сплав' : 'Следующая трасса';
  coinsAward();
}

// ---------- окна: профиль, рекорды
let modalKind = '', achFilter = 'all';
function openModal(kind, html) { modalKind = kind; $('modalBody').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { modalKind = ''; $('modal').classList.add('hidden'); }
$('modalClose').onclick = closeModal;
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
function openMyProfile() { if (me) showProfile(me, true); else openModal('profile', '<p class="note">Профиль появится, когда вы залезете на плот.</p>'); }

const STAT_ROWS = [['farts', 'пуков'], ['shits', 'щелчков'], ['misfires', 'холостых'], ['overheats', 'перегревов'], ['ejects', 'за бортом'], ['faints', 'обмороков'], ['gassed', 'вырубил дымом'], ['burps', 'отрыжек'], ['syncs', 'синхронов'], ['finishes', 'финишей'], ['blame', 'аварий по вине'], ['meters', 'проплыто'], ['kos', 'распердел на арене'], ['arenaWins', 'побед на арене'], ['goals', 'голов'], ['dailies', 'заданий дня']];
function showProfile(p, mine) {
  if (!p) { openModal('profile', '<p class="note">Такого профиля нет.</p>'); return; }
  const d = p.data || {}, s = d.s || {}, got = d.ach || {}, pinned = d.pinned || [];
  const counts = {}; for (const a of ACHIEVEMENTS) if (got[a.id]) counts[a.tier] = (counts[a.tier] || 0) + 1;
  const list = ACHIEVEMENTS.filter(a => achFilter === 'all' || (achFilter === 'got' ? got[a.id] : a.tier === achFilter))
    .sort((a, b) => (got[b.id] ? 1 : 0) - (got[a.id] ? 1 : 0) || TIER[a.tier].rank - TIER[b.tier].rank);
  const cards = list.map(a => {
    const pr = achProgress(a, d), T = TIER[a.tier], pin = pinned.includes(a.id);
    return `<div class="ach ${pr.done ? 'done' : ''} ${pin ? 'pinned' : ''}" style="--tc:${T.color}" ${mine && pr.done ? `data-pin="${a.id}" title="Нажмите, чтобы ${pin ? 'снять с профиля' : 'повесить на профиль'}"` : ''}>
      ${achBadge(a.id)}<div class="ai"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span>
      ${pr.done ? `<em>${T.name}${pin ? ' · на профиле' : ''}</em>` : `<div class="pbar"><i style="width:${(pr.cur / pr.goal * 100).toFixed(0)}%"></i></div><em>${T.name}${pr.goal > 1 ? ` · ${pr.cur} / ${pr.goal}` : ''}</em>`}</div></div>`;
  }).join('');
  const bests = LEVEL_NAMES.map((n, i) => d.bests && d.bests[i] ? `<div><span>${i + 1}. ${esc(n)}</span><b>${fmtTime(d.bests[i])}</b></div>` : '').join('') + (s.endlessBest ? `<div><span>∞ ${ENDLESS_INFO.name}</span><b>${fmtDist(s.endlessBest)}</b></div>` : '');
  const html = `
    <h2 class="logo small">${esc(p.name)}</h2>
    <p class="note">${Object.keys(got).length} из ${ACHIEVEMENTS.length} достижений${mine ? ' · нажмите на полученное, чтобы повесить на профиль (до трёх)' : ''}</p>
    <div class="pinned-row">${pinned.length ? pinned.map(id => `<div class="pin-big">${achBadge(id, 'lg')}<span>${esc(ACH[id] ? ACH[id].name : id)}</span></div>`).join('') : '<span class="note">На профиле пока ничего не висит</span>'}</div>
    <div class="stat-grid">${STAT_ROWS.map(([k, n]) => `<div><b>${k === 'meters' ? fmtDist(s[k] || 0) : Math.floor(s[k] || 0)}</b>${n}</div>`).join('')}</div>
    ${bests ? `<h3>Лучшие результаты</h3><div class="bests">${bests}</div>` : ''}
    <h3>Достижения</h3>
    <div class="chips filt">${[['all', 'Все'], ['got', 'Полученные'], ...TIERS.map(t => [t.id, `${t.name} ${counts[t.id] || 0}/${ACHIEVEMENTS.filter(a => a.tier === t.id).length}`])].map(([k, n]) => `<button class="chip ${achFilter === k ? 'on' : ''}" data-f="${k}" ${TIER[k] ? `style="--tc:${TIER[k].color}"` : ''}>${n}</button>`).join('')}</div>
    <div class="ach-grid">${cards}</div>`;
  const sc = $('modalBody').scrollTop, same = modalKind === (mine ? 'profile-me' : 'profile');
  openModal(mine ? 'profile-me' : 'profile', html);
  if (same) $('modalBody').scrollTop = sc;
  $('modalBody').onclick = (e) => {
    const f = e.target.closest('[data-f]'); if (f) { achFilter = f.dataset.f; showProfile(p, mine); return; }
    const c = e.target.closest('[data-pin]'); if (!c || !mine || !me) return;
    const id = c.dataset.pin, cur = [...(me.data.pinned || [])];
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id].slice(-3);
    me.data.pinned = next; send({ t: 'pin', ids: next }); showProfile(me, true);
  };
}
function showTop(m) {
  const recs = (m.records || {});
  const lv = LEVELS.map((l, i) => recs[i] ? `<div><span>${i + 1}. ${esc(l.name)}</span><b>${fmtTime(recs[i].time)}</b><small>${esc(recs[i].names.join(', '))}</small></div>` : `<div class="empty"><span>${i + 1}. ${esc(l.name)}</span><b>—</b></div>`).join('');
  const en = (m.endless || []).map((r, i) => `<div><span>${i + 1}. ${esc(r.name)}</span><b>${fmtDist(r.v || 0)}</b></div>`).join('') || '<p class="note">Пока никто не плавал</p>';
  const ac = (m.ach || []).map((r, i) => `<div><span>${i + 1}. ${esc(r.name)}</span><b>🏅 ${r.v || 0}</b></div>`).join('') || '<p class="note">Пока пусто</p>';
  openModal('top', `<h2 class="logo small">Рекорды</h2><p class="note">Всего заездов: ${m.races || 0} · база: ${esc(m.db || '')}</p>
    <div class="top-cols"><div><h3>Трассы</h3><div class="bests">${lv}</div></div>
    <div><h3>∞ Бесконечный сплав</h3><div class="bests">${en}</div><h3>Больше всех достижений</h3><div class="bests">${ac}</div></div></div>`);
}

// ---------- гардероб
function openWardrobe() {
  if (!joined || phase !== 'lobby') return;
  renderWardrobe(); wardSnap = true;
  $('wardrobe').classList.remove('hidden');
  document.body.classList.add('fitting-room');
  for (const h of hippos.values()) h.label.visible = false;
  updateCameraFraming();
  $('wardClose').focus({ preventScroll: true });
}
function closeWardrobe() {
  if ($('wardrobe').classList.contains('hidden')) return;
  camSnap = true;
  $('wardrobe').classList.add('hidden');
  document.body.classList.remove('fitting-room');
  for (const h of hippos.values()) h.label.visible = true;
  updateCameraFraming();
  if (phase === 'lobby') $('wardBtn').focus({ preventScroll: true });
}
$('wardClose').onclick = closeWardrobe;
const fittingAngles = { front: 0.18, side: Math.PI * 0.48, back: Math.PI };
let fittingView = 'front';
$('wardViews').addEventListener('click', e => {
  const button = e.target.closest('[data-view]');
  if (!button) return;
  fittingView = button.dataset.view;
  wardSnap = true;
  for (const view of $('wardViews').children) view.setAttribute('aria-pressed', String(view === button));
});
function myLookNow() { const p = room && room.players.find(q => q.id === myId); return (p && p.look) || DEFAULT_LOOK; }
let wardTab = lsGet('puk.wtab', 'hat');
function myInv() { return { ach: (me && me.data.ach) || {}, inv: (me && me.data.inv) || {} }; }
function lockReason(it) {
  if (it.unlock) { const a = ACH[it.unlock]; return a ? `Откроется за достижение «${a.name}»: ${a.desc}` : 'Откроется за достижение'; }
  if (it.box) return `Выпадает из подарков · ${RARITY[it.r].name.toLowerCase()}`;
  return '';
}
function perkHTML(it, small = false) {
  const k = it.perk && PERKS[it.perk]; if (!k) return '';
  return `<div class="perk ${small ? 'sm' : ''}"><b>${k.ic} ${esc(k.name)}</b><span class="plus">+ ${esc(k.plus)}</span><span class="minus">− ${esc(k.minus)}</span></div>`;
}
function renderWardrobe() {
  const look = myLookNow(), { ach, inv } = myInv(), taken = takenSkins();
  const boxOwned = BOX_ITEMS.filter(it => inv[it.key]).length;
  const tabs = [['shirt', '👕 Майка'], ...SLOTS.map(s => [s.key, s.tab])];
  if (!tabs.some(t => t[0] === wardTab)) wardTab = 'hat';
  let body;
  if (wardTab === 'shirt') body = `<div class="shirts sm">${SKINS.map((s, i) => shirtHTML(i, i === selSkin, taken.has(i))).join('')}</div><p class="note">Майка — цвет вашего бегемота в команде. Занятые цвета разбирают первыми.</p>`;
  else {
    const sl = SLOT[wardTab];
    const list = sl.list.slice().sort((a, b) => (owns(b, ach, inv) - owns(a, ach, inv)) || (RARITY[a.r].rank - RARITY[b.r].rank));
    const available = [], locked = [];
    for (const it of list) {
      const have = owns(it, ach, inv), on = look[sl.key] === it.id;
      (have ? available : locked).push(`<button class="item card r-${it.r} ${on ? 'on' : ''} ${have ? '' : 'locked'}" data-slot="${sl.key}" data-id="${it.id}" ${have ? `aria-pressed="${on}"` : 'disabled'} title="${esc(have ? it.name : lockReason(it))}">
        ${itemIcon(it)}<span class="nm">${have ? '' : '🔒 '}${esc(it.name)}</span><small class="rar">${RARITY[it.r].name}${it.perk ? ' · баф' : ''}</small>
        ${it.perk ? perkHTML(it, true) : ''}${!have ? `<small class="how">${esc(lockReason(it))}</small>` : ''}</button>`);
    }
    const keepOpen = $('wardLocked')?.dataset.slot === sl.key && $('wardLocked').open;
    const lockedList = locked.length ? `<details class="lobby-fold ward-locked" id="wardLocked" data-slot="${sl.key}" ${keepOpen ? 'open' : ''}><summary>Как открыть ещё · ${locked.length}</summary><div class="items cards">${locked.join('')}</div></details>` : '';
    body = `<div class="items cards">${available.join('')}</div>${lockedList}${sl.key === 'raft' ? `<p class="note">${room?.mode === 'tow' ? 'Для буксировки обе команды получают круглый плот.' : esc(shapeOf(look.raft).desc)}</p>` : ''}${sl.key === 'rskin' ? '<p class="note">В сплаве цвет общего плота выбирает хост.</p>' : ''}${sl.key === 'voice' ? '<p class="note">Так звучит ваш пук у всех игроков.</p>' : ''}${sl.key === 'trail' ? '<p class="note">Искорки летят поверх газа. Цвет газа показывает, когда он стал коричневым.</p>' : ''}`;
  }
  const perks = perksOf(look), on = !room || room.rules.perks !== false;
  $('wardBody').innerHTML = `<div class="ward-top"><span>Собрано из подарков: <b>${boxOwned}</b> из ${BOX_ITEMS.length}</span><button class="btn sm" id="wardShop">🎁 Подарки</button></div>
    <div class="wtabs">${tabs.map(([k, n]) => `<button class="wtab ${wardTab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>${body}
    ${perks.length ? `<div class="my-perks"><h4>Мои бафы ${on ? '' : '<small>(отключены в этой партии)</small>'}</h4>${perks.map(k => perkHTML(k.item)).join('')}</div>` : ''}`;
  $('wardShop').onclick = () => { closeWardrobe(); openShop(); };
}
$('wardBody').addEventListener('click', (e) => {
  const tb = e.target.closest('.wtab'); if (tb) { wardTab = tb.dataset.tab; lsSet('puk.wtab', wardTab); renderWardrobe(); return; }
  const sh = e.target.closest('.shirt'); if (sh) { selSkin = +sh.dataset.skin; lsSet('puk.skin', selSkin); send({ t: 'look', skin: selSkin }); return; }
  const b = e.target.closest('.item'); if (!b || b.disabled) return;
  send({ t: 'look', look: { [b.dataset.slot]: b.dataset.id } });
});

// ---------- пукоины, подарки, задания
let roundCoins = 0, boxBusy = false, lastBox = null;
function onCoins(m) {
  roundCoins += m.n;
  if (me) me.data.coins = m.total;
  sfx.coin();
  coinPop(`+${m.n} ${COIN}`, m.why);
  if (phase === 'lobby') renderLobby();
}
function coinPop(text, sub = '') {
  const el = document.createElement('div'); el.className = 'coin-pop'; el.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  $('coinPops').appendChild(el); setTimeout(() => el.remove(), 1800);
  while ($('coinPops').children.length > 4) $('coinPops').firstChild.remove();
}
function coinsAward() {
  if (!roundCoins) return;
  $('resAwards').insertAdjacentHTML('afterbegin', `<div class="award coins-award">${COIN} <b>Заработано за раунд: +${roundCoins}</b> · всего ${me ? me.data.coins : ''}. Потратить можно в «Подарках» в лобби.</div>`);
}
const dailyFree = () => !!(me && room && room.daily && me.data.giftDate !== room.daily.date);
function giftCount() { if (!me) return 0; const b = me.data.boxes || {}; return (dailyFree() ? 1 : 0) + (b.common || 0) + (b.gold || 0); }
function boxArt(id, big = false) { const B = BOXES[id]; return `<div class="giftbox ${big ? 'big' : ''} gb-${id}" style="--c:${B.color}"><i class="lid"></i><i class="body"></i><i class="rib"></i><i class="bow"></i></div>`; }
const oddsText = (B) => ['common', 'rare', 'epic', 'legendary'].filter(r => B.odds[r]).map(r => `${RARITY[r].name.toLowerCase()} ${B.odds[r]}%`).join(' · ');
function openShop() {
  if (!joined || phase === 'race' || phase === 'count') return;
  if (!me) { toast('Сначала войдите', '', 'sm'); return; }
  closeWardrobe(); openModal('shop', ''); renderShop();
}
function renderShop() {
  if (modalKind !== 'shop' || !me) return;
  const d = me.data, b = d.boxes || {}, coins = d.coins ?? 0;
  const boxes = BOX_ORDER.map(id => {
    const B = BOXES[id], n = id === 'daily' ? (dailyFree() ? 1 : 0) : (b[id] || 0);
    return `<div class="shop-box r-${id}">${boxArt(id)}<b>${esc(B.name)}</b><small>${esc(B.desc)}</small><small class="odds">${oddsText(B)}</small>
      <div class="have">${id === 'daily' ? (n ? 'Сегодня ещё не открыт' : 'Открыт · завтра новый') : `У вас: <b>${n}</b>`}</div>
      <div class="row">${n ? `<button class="btn sm primary" data-open="${id}">Открыть</button>` : ''}${B.price ? `<button class="btn sm" data-buy="${id}" ${coins < B.price ? 'disabled' : ''}>Купить · ${B.price} ${COIN}</button>` : ''}</div></div>`;
  }).join('');
  const q = d.quests && room && d.quests.date === room.daily.date ? d.quests : null;
  const quests = q ? q.list.map(x => {
    const Q = QUESTS.find(z => z.id === x.id); if (!Q) return '';
    const cur = Math.min(Q.n, Math.floor((d.s[Q.stat] || 0) - x.base)), pct = x.done ? 100 : Math.round(cur / Q.n * 100);
    return `<div class="quest ${x.done ? 'done' : ''}"><div class="qt">${x.done ? '✅' : '🎯'} ${esc(Q.text)}<span>+${Q.coins} ${COIN}</span></div><div class="qbar"><i style="width:${pct}%"></i></div><small>${x.done ? 'Выполнено' : `${cur} из ${Q.n}`}</small></div>`;
  }).join('') : '<p class="note">Задания появятся после входа в профиль.</p>';
  const friends = room ? room.players.filter(p => p.id !== myId && p.prof && !p.bot) : [];
  const owned = BOX_ITEMS.filter(it => d.inv && d.inv[it.key]).length, legs = BOX_ITEMS.filter(it => it.r === 'legendary'), legOwned = legs.filter(it => d.inv && d.inv[it.key]).length;
  $('modalBody').innerHTML = `<div class="shop-head"><h2 class="logo small">Подарки</h2><div class="wallet">${COIN} <b>${coins}</b> <small>пукоинов</small></div></div>
    <p class="note">Пукоины капают за чекпоинты, финиши, медали, попадания, нокауты, победы на арене, достижения и задания. Настоящие деньги тут не нужны.</p>
    <div class="shop-boxes">${boxes}</div>
    <div class="shop-cols"><div><h3>Задания на сегодня</h3>${quests}${q && !q.rerolled && q.list.some(x => !x.done) ? `<button class="btn sm" id="rerollBtn" ${coins < REROLL_PRICE ? 'disabled' : ''}>🎲 Заменить невыполненные · ${REROLL_PRICE} ${COIN}</button>` : ''}</div>
    <div><h3>Подарить другу</h3>${friends.length ? `<div class="gift-row"><select id="giftTo">${friends.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><select id="giftBox">${BOX_ORDER.filter(id => BOXES[id].price).map(id => `<option value="${id}">${esc(BOXES[id].name)} · ${BOXES[id].price} ${COIN}</option>`).join('')}</select><button class="btn sm primary" id="giftBtn">🎁 Подарить</button></div><p class="note">Подарок ляжет другу нераспечатанным — откроет сам.</p>` : '<p class="note">Когда в комнате будут друзья, им можно подарить коробку или сундук.</p>'}
    <h3>Коллекция</h3><p class="note" style="margin-top:0">Вещей из подарков: <b>${owned}</b> из ${BOX_ITEMS.length} · легендарок: <b>${legOwned}</b> из ${legs.length}${d.pity ? ` · золотых сундуков без легендарки подряд: ${d.pity} из ${BOXES.gold.pity - 1}` : ''}</p>
    <p class="note">Повтор не пропадает: за него возвращаются пукоины (обычная ${RARITY.common.dupe}, редкая ${RARITY.rare.dupe}, эпическая ${RARITY.epic.dupe}, легендарная ${RARITY.legendary.dupe}). Новых вещей выпадает вчетверо чаще, чем повторов.</p></div></div>`;
}
$('modalBody').addEventListener('click', (e) => {
  if (modalKind !== 'shop') return;
  const o = e.target.closest('[data-open]'), bu = e.target.closest('[data-buy]');
  if (o && !boxBusy) { boxBusy = true; lastBox = o.dataset.open; sfx.init(); send({ t: 'shop', a: 'open', box: o.dataset.open }); return; }
  if (bu) { send({ t: 'shop', a: 'buy', box: bu.dataset.buy }); return; }
  if (e.target.id === 'rerollBtn') { send({ t: 'shop', a: 'reroll' }); return; }
  if (e.target.id === 'giftBtn') { send({ t: 'shop', a: 'gift', to: +$('giftTo').value, box: $('giftBox').value }); return; }
});
// Открытие: лента с вещами крутится и останавливается на выигрыше
function cardHTML(key, cls = '') { const it = ITEM[key]; if (!it) return ''; return `<div class="loot r-${it.r} ${cls}">${itemIcon(it)}<span>${esc(it.name)}</span></div>`; }
function onBoxRes(m) {
  const it = ITEM[m.res.key]; if (!it) { boxBusy = false; return; }
  const ov = $('boxOpen'); ov.classList.remove('hidden', 'revealed'); ov.dataset.r = it.r;
  ov.innerHTML = `<div class="bo-card tube"><h2 class="logo small">${esc(BOXES[m.box].name)}</h2><div class="bo-win"><div class="bo-strip" id="boStrip">${m.strip.map((k, i) => cardHTML(k, i === m.at ? 'win' : '')).join('')}</div><i class="bo-mark"></i></div><div class="bo-res" id="boRes"></div></div>`;
  const strip = $('boStrip'), cw = 132, win = ov.querySelector('.bo-win').clientWidth;
  const target = m.at * cw + cw / 2 - win / 2 + (Math.random() - 0.5) * cw * 0.6;
  strip.style.transform = 'translateX(0px)';
  const T0 = performance.now(), DUR = 4800, ease = (x) => 1 - Math.pow(1 - x, 4);
  let lastIdx = -1;
  const step = () => {
    const k = Math.min(1, (performance.now() - T0) / DUR), x = target * ease(k);
    strip.style.transform = `translateX(${-x}px)`;
    const idx = Math.floor((x + win / 2) / cw); if (idx !== lastIdx) { lastIdx = idx; sfx.tick(1 - k * 0.5); }
    if (k < 1) requestAnimationFrame(step); else reveal();
  };
  requestAnimationFrame(step);
  const reveal = () => {
    ov.classList.add('revealed'); sfx.reveal(RARITY[it.r].rank);
    const look = myLookNow(), worn = look[it.slot] === it.id;
    $('boRes').innerHTML = `<div class="bo-item r-${it.r}">${itemIcon(it)}<div><b>${esc(it.name)}</b><small>${RARITY[it.r].name} · ${esc(SLOT[it.slot].name)}</small>${perkHTML(it)}${m.res.dupe ? `<p class="dupe">Уже есть — вернули +${m.res.coins} ${COIN}</p>` : '<p class="new">Новая вещь!</p>'}</div></div>
      <div class="row">${!m.res.dupe && !worn && phase === 'lobby' ? '<button class="btn primary" id="boWear">Надеть</button>' : ''}${giftCount() ? '<button class="btn" id="boMore">Открыть ещё</button>' : ''}<button class="btn ghost" id="boDone">Готово</button></div>`;
    if (it.r === 'legendary' || it.r === 'epic') confetti(it.r === 'legendary' ? 90 : 45);
    const close = () => { ov.classList.add('hidden'); boxBusy = false; renderShop(); };
    $('boDone').onclick = close;
    if ($('boWear')) $('boWear').onclick = () => { send({ t: 'look', look: { [it.slot]: it.id } }); close(); closeModal(); openWardrobe(); wardTab = it.slot; renderWardrobe(); };
    if ($('boMore')) $('boMore').onclick = () => { ov.classList.add('hidden'); boxBusy = false; const nx = BOX_ORDER.find(id => id === lastBox && (id === 'daily' ? dailyFree() : (me.data.boxes[id] || 0) > 0)) || BOX_ORDER.find(id => id === 'daily' ? dailyFree() : (me.data.boxes[id] || 0) > 0); if (nx) { boxBusy = true; lastBox = nx; send({ t: 'shop', a: 'open', box: nx }); } };
  };
}
function confetti(n) {
  const cols = ['#ffd23f', '#e8456b', '#3d8fe0', '#b8f227', '#a35ee8', '#ff8a1f'];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('i'); el.className = 'confetti';
    el.style.left = (50 + (Math.random() - 0.5) * 40) + 'vw'; el.style.background = cols[i % cols.length];
    el.style.setProperty('--dx', ((Math.random() - 0.5) * 70) + 'vw'); el.style.setProperty('--rot', (Math.random() * 1080) + 'deg'); el.style.animationDelay = (Math.random() * 0.25) + 's';
    document.body.appendChild(el); setTimeout(() => el.remove(), 2600);
  }
}


// Настройки графики
const QNAMES = [['auto', 'Авто'], ['2', 'Высокая'], ['1', 'Средняя'], ['0', 'Низкая']];
function renderQualityButtons() { $('qualityBtns').innerHTML = QNAMES.map(([k, n]) => `<button class="btn ${qualityMode === k ? 'on' : ''}" data-q="${k}">${n}</button>`).join(''); }
$('qualityBtns').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  qualityMode = b.dataset.q; lsSet('puk.quality', qualityMode);
  quality = qualityMode !== 'auto' ? +qualityMode : 2;
  applyQuality();
});
$('settingsBtn').onclick = () => $('settings').classList.toggle('hidden');

// ------------------------------------------------------------
//  Управление
// ------------------------------------------------------------
const keys = new Set();
let touchFart = false, touchCrawl = 0, padCrawl = 0, padFart = false, shootMouse = false, touchShoot = false, padShoot = false;
let camYawOff = 0, camPitch = 0.81, camDist = 13.1, dragging = false, lastDragT = 0;
const CAM_DEF = { pitch: 0.81, dist: 13.1 };
const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox';
let escTime = 0;
addEventListener('keydown', (e) => {
  if (typing()) return;
  if (['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) &&
      e.target instanceof Element && e.target.closest('button, summary, select, a[href]') &&
      (!joined || phase === 'lobby' || phase === 'results' || modalKind)) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyM' && !e.repeat) toggleMute();
  if (e.code === 'Escape') {
    if (modalKind) { closeModal(); return; }
    if (!$('wardrobe').classList.contains('hidden')) { closeWardrobe(); return; }
    if (room && room.host === myId && (phase === 'race' || phase === 'count')) {
      if (nowS() - escTime < 1.5) send({ t: 'abort' }); else { escTime = nowS(); toast(levelIdx === ENDLESS ? 'Esc ещё раз — закончить заплыв' : 'Esc ещё раз прервёт заезд', '', 'sm', 1200); }
    }
  }
  keys.add(e.code);
  const em = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
  if (em && !e.repeat && joined) send({ t: 'emote', n: +em[1] - 1 });
  if (e.code === 'KeyQ' && !e.repeat && joined) tryMega();
  sfx.init();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); touchFart = false; touchCrawl = 0; dragging = false; shootMouse = false; touchShoot = false; });
const cv = renderer.domElement;
cv.addEventListener('mousedown', (e) => { sfx.init(); if (e.button === 2) { shootMouse = true; return; } dragging = true; $('settings').classList.add('hidden'); cv.style.cursor = 'grabbing'; });
addEventListener('mouseup', (e) => { if (e.button === 2) { shootMouse = false; return; } dragging = false; cv.style.cursor = ''; });
addEventListener('mousemove', (e) => {
  if (!dragging) return;
  camYawOff = wrapAngle(camYawOff - e.movementX * 0.006);
  camPitch = clamp(camPitch + e.movementY * 0.004, 0.22, 1.4);
  lastDragT = nowS();
});
cv.addEventListener('wheel', (e) => { e.preventDefault(); camDist = clamp(camDist * (1 + Math.sign(e.deltaY) * 0.08), 6, 28); }, { passive: false });
cv.addEventListener('dblclick', () => { camYawOff = 0; camPitch = CAM_DEF.pitch; camDist = CAM_DEF.dist; });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
const touches = new Map();
let touchHintSeen = false;
cv.addEventListener('touchstart', (e) => {
  e.preventDefault();
  sfx.init();
  if (!touchHintSeen && joined && (phase === 'race' || phase === 'count')) {
    touchHintSeen = true;
    $('touchHint').classList.remove('hidden');
    setTimeout(() => $('touchHint').classList.add('hidden'), 4500);
  }
  for (const t of e.changedTouches) {
    touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, left: t.clientX < innerWidth / 2 });
  }
  updTouch();
}, { passive: false });
cv.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) { const o = touches.get(t.identifier); if (o) { o.x = t.clientX; o.y = t.clientY; } } updTouch(); }, { passive: false });
const tend = (e) => { for (const t of e.changedTouches) touches.delete(t.identifier); updTouch(); };
cv.addEventListener('touchend', tend); cv.addEventListener('touchcancel', tend);
function updTouch() { touchFart = false; touchShoot = false; touchCrawl = 0; for (const o of touches.values()) { if (!o.left) { if (canShoot() && o.y0 < innerHeight * 0.45) touchShoot = true; else touchFart = true; } else { const dx = o.x - o.x0; if (Math.abs(dx) > 14) touchCrawl = Math.sign(dx); } } }
function pollPad(dt = 0.016) {
  padCrawl = 0; padFart = false; padShoot = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const x = p.axes[0] || 0, rx = p.axes[2] || 0, ry = p.axes[3] || 0;
    if (Math.abs(x) > 0.35) padCrawl = Math.sign(x);
    if (p.buttons[14] && p.buttons[14].pressed) padCrawl = -1;
    if (p.buttons[15] && p.buttons[15].pressed) padCrawl = 1;
    if (Math.abs(rx) > 0.2) camYawOff = wrapAngle(camYawOff - rx * dt * 2.5);
    if (Math.abs(ry) > 0.2) camPitch = clamp(camPitch + ry * dt * 1.5, 0.22, 1.4);
    if ((p.buttons[0] && p.buttons[0].pressed) || (p.buttons[7] && p.buttons[7].value > 0.3) || (p.buttons[5] && p.buttons[5].pressed)) padFart = true;
    if ((p.buttons[2] && p.buttons[2].pressed) || (p.buttons[4] && p.buttons[4].pressed) || (p.buttons[6] && p.buttons[6].value > 0.3)) padShoot = true;
    const y = !!(p.buttons[3] && p.buttons[3].pressed); if (y && !padMegaWas) tryMega(); padMegaWas = y;
    break;
  }
}
function toggleMute() { sfx.setMuted(!sfx.muted); $('muteBtn').textContent = sfx.muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = () => { sfx.init(); toggleMute(); };

let lastSent = { f: 0, c: 0, t: 0 }, padMegaWas = false;
// Пробел — пук; A / D (или стрелки) — ползти по своему куску кромки
function readInput(dt) {
  pollPad(dt);
  if (typing() || modalKind) return { f: 0, c: 0, s: 0 };
  let c = 0;
  if (keys.has('KeyD') || keys.has('ArrowRight')) c += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) c -= 1;
  if (touchCrawl) c = touchCrawl;
  if (padCrawl) c = padCrawl;
  const f = (keys.has('Space') || touchFart || padFart) ? 1 : 0;
  const sh = canShoot() && (keys.has('KeyE') || shootMouse || touchShoot || padShoot) ? 1 : 0;
  return { f, c, s: sh };
}
function sendInput(inp) {
  const t = nowS();
  if (inp.f !== lastSent.f || inp.c !== lastSent.c || (inp.s || 0) !== (lastSent.s || 0) || t - lastSent.t > 0.2) { send({ t: 'in', a: null, f: inp.f, c: inp.c, s: inp.s || 0 }); lastSent = { f: inp.f, c: inp.c, s: inp.s || 0, t }; }
}

// ------------------------------------------------------------
//  Бегемоты
// ------------------------------------------------------------
const hippoKey = (p) => p ? `${p.name}|${p.skin}|${JSON.stringify(p.look || {})}|${(p.pinned || [])[0] || ''}` : '';
function ensureHippo(id) {
  let h = hippos.get(id); if (h) return h;
  const info = (room && room.players.find(p => p.id === id)) || { name: 'Бегемот', skin: 0, look: DEFAULT_LOOK };
  const obj = makeHippo(info.skin, info.look || DEFAULT_LOOK);
  const title = info.pinned && info.pinned[0] && ACH[info.pinned[0]] ? ACH[info.pinned[0]].name : '';
  const label = makeLabel(info.name, id === myId ? '#d4f752' : '#ffffff', title);
  label.visible = !document.body.classList.contains('fitting-room');
  label.position.set(0, 2.55, 0); obj.add(label);
  const lk = info.look || DEFAULT_LOOK;
  h = { id, obj, rv: null, key: hippoKey(info), name: info.name, skin: info.skin, look: lk, voice: VOICES.find(v => v.id === lk.voice) || VOICES[0], trail: lk.trail || 'none', trailAcc: 0, farting: false, gas: 1, heat: 0, flags: 0, dirt: -1, jit: Math.random() * 10, vpos: null, ej: null, blink: 2 + Math.random() * 3, emitAcc: 0, smokeAcc: 0, burpT: -9, rumbleT: -9, rumbleNext: 4 + Math.random() * 8, faintT: -9 };
  h.label = label;
  hippos.set(id, h);
  prewarm(obj);
  return h;
}
function removeHippo(id) {
  const h = hippos.get(id);
  if (!h) return;
  h.obj.removeFromParent();
  h.label.material.map.dispose();
  h.label.material.dispose();
  h.obj.userData.disposeAppearance?.();
  sfx.fartStop(id, false); sfx.sizzle(id, 0);
  hippos.delete(id);
}

// ------------------------------------------------------------
//  Грязь на окружении: куда упала капля
// ------------------------------------------------------------
const sv1 = new THREE.Vector3(), sv2 = new THREE.Vector3();
function splatAt(x, z, size, Tnow) {
  if (isArena()) { if (arenaScene && Math.hypot(x, z) < ARENA_R - 0.3) arenaScene.paintBlob(x, z, size); return; }
  if (!tr || !levelScene) return;
  const loc = locate(tr, x, z, Math.round(lastS));
  const side = loc.d > 0 ? 1 : -1, hw = loc.w / 2;
  // препятствие рядом?
  for (const r of levelScene.obs) {
    const o = r.o; if (!r.target || !o.r || Math.abs(o.s - loc.s) > 6 || o.type === 'whirl' || o.type === 'boost' || o.type === 'geyser') continue;
    const st = obstacleState(o, tr, Tnow); if (!st || st.active === false) continue;
    const dx = x - st.x, dz = z - st.z, dist = Math.hypot(dx, dz);
    if (dist < o.r + 0.5) {
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      sv1.set(st.x + nx * o.r * 0.92, yAt(o.s) + 0.35 + Math.random() * 0.5, st.z + nz * o.r * 0.92); sv2.set(nx, 0.25, nz).normalize();
      stains.addOn(r.target, sv1, sv2, size * 1.2);
      return;
    }
  }
  const gap = (side > 0 ? tr.gapL : tr.gapR)[loc.i];
  if (!gap && Math.abs(loc.d) > hw - 0.25) {
    const f = frame(tr, loc.s, side * (hw - 0.07));
    stains.addWall(f.x, f.y + 0.25 + Math.random() * 0.25, f.z, f.h, side, size * 1.1);
    return;
  }
  if (Math.abs(loc.d) < hw + (gap ? 3 : 0)) stains.addWater(x, yAt(loc.s) - 0.015, z, size);
}

// ------------------------------------------------------------
//  События — проигрываются сразу, как пришли
// ------------------------------------------------------------
let lastCountShown = null;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function splash(x, y, z, n = 30, power = 1) {
  for (let i = 0; i < n * (quality ? 1 : 0.5); i++) { const a = Math.random() * 6.28, sp = (2 + Math.random() * 4) * power; foamFx.emit(x + Math.sin(a) * 0.5, y + 0.1, z + Math.cos(a) * 0.5, Math.sin(a) * sp, (3 + Math.random() * 4) * power, Math.cos(a) * sp, 0.25, 0.12, 0.9 + Math.random() * 0.4, WHITE, { drag: 0.8, grav: -11, floor: y - 0.2 }); }
  rings.spawn(x, y + 0.03, z, 0.8, 4.5 * power, 1.4, 0.7);
}
function panFor(x, z) { tmpV.set(x, 0, z).sub(camera.position); const right = tmpV2.set(-Math.cos(camH + camYawOff), 0, Math.sin(camH + camYawOff)); return clamp(tmpV.normalize().dot(right), -0.8, 0.8); }
function hippoPan(h) { if (!h) return 0; h.obj.getWorldPosition(tmpV); return panFor(tmpV.x, tmpV.z); }
function pooBurst(h, n, power = 1) {
  const U = h.obj.userData;
  h.obj.localToWorld(tmpV.copy(U.butt));
  const rv = h.rv || mainRV, th = rv.group.rotation.y + (h.vpos || 0), ox = Math.sin(th), oz = Math.cos(th), wy = rv.group.position.y;
  for (let i = 0; i < n; i++) {
    const a = (Math.random() - 0.5) * 1.6, sp = (1.5 + Math.random() * 2.5) * power;
    pooFx.emit(tmpV.x, tmpV.y, tmpV.z, Math.sin(th + a) * sp, 1.5 + Math.random() * 2.5, Math.cos(th + a) * sp, 0.2 + Math.random() * 0.12, 0.3, 1.2, pick(POO), { drag: 0.5, grav: -9, floor: wy - 0.3 });
  }
  for (let i = 0; i < 4; i++) { const d = 1 + Math.random() * 1.8, a = (Math.random() - 0.5) * 1.2; splatAt(tmpV.x + Math.sin(th + a) * d, tmpV.z + Math.cos(th + a) * d, 0.45 + Math.random() * 0.4, P.T); }
  void ox; void oz;
}
function crashToast(e, title, sub) {
  if (levelIdx >= ENDLESS && phase === 'race' && typeof e.lives === 'number') {
    if (e.over) toast('Плот всё!', `Заплыв окончен: ${fmtDist(lastS)}`, '', 2600);
    else toast(title, `${sub}. Осталось жизней: ${e.lives}`);
  } else toast(title, sub);
}
const teamName = (i) => (room && room.arena && room.arena.teams[i]) ? room.arena.teams[i].name : '?';
function playEvent(e) {
  const wy = isArena() ? 0 : mainRV.group.position.y;
  switch (e.k) {
    case 'join': if (joined) feed(`${e.name} залез на плот`); return;
    case 'mega': megaFx(e); return;
    case 'bombnew': { const mine = e.team === myTeam(); feed(`💣 Бомба у ${teamName(e.team)} — ${e.sec} с до взрыва`); if (mine) { toast('У вас бомба!', 'Врежьтесь в соперника, чтобы сбагрить', 'hot', 1800); sfx.beep(true); } return; }
    case 'bombpass': {
      const mt = myTeam(); sfx.bump(1); sfx.beep(false);
      if (e.toTeam === mt) { toast('Бомба у вас!', 'Скорее сбагрите её!', 'hot', 1300); shake(0.4); }
      else if (e.fromTeam === mt) toast('Сбагрили!', '', 'sm gas', 900);
      floatText(e.x, 2.6, e.z, '💣', '#ff8a1f'); return;
    }
    case 'boom': {
      sfx.mega(panFor(e.x, e.z)); shake(Math.max(0.2, 1 - Math.hypot(camera.position.x - e.x, camera.position.z - e.z) / 40));
      rings.spawn(e.x, 0.05, e.z, 1.5, 12, 0.9, 0.95, 0x8a5a26);
      for (let i = 0; i < [40, 70, 100][quality]; i++) { const a = Math.random() * 6.28, sp = 4 + Math.random() * 8; gasFx.emit(e.x, 0.8, e.z, Math.sin(a) * sp, 1 + Math.random() * 2, Math.cos(a) * sp, 0.8, 3, 1.4, pick(MEGA_BROWN), { drag: 1.4, alpha: 0.7 }); fireFx.emit(e.x, 0.8, e.z, Math.sin(a) * sp, 2 + Math.random() * 3, Math.cos(a) * sp, 0.5, 0.1, 0.6, pick(FIRE), { drag: 1, grav: 1 }); }
      feed(`💥 Бомба взорвалась у ${teamName(e.team)}`); return;
    }
    case 'infect': {
      const mt = myTeam();
      for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28; trailFx.emit(e.x, 1, e.z, Math.sin(a) * 4, 2 + Math.random() * 2, Math.cos(a) * 4, 0.35, 0.05, 0.9, pick(ZOMBIE_COL), { drag: 1.2, grav: -1 }); }
      sfx.burp(panFor(e.x, e.z), 3);
      if (e.team === mt) toast(e.by >= 0 ? 'Вас заразили!' : 'Вы — нулевой пациент!', 'Теперь вы зомби: врезайтесь в здоровых', 'gas', 2000);
      else if (e.by === mt) { toast('Заразил!', '+5 очков', 'sm gas', 1200); floatText(e.x, 2.6, e.z, '+5', '#8ee04a'); }
      feed(e.by >= 0 ? `🧟 ${teamName(e.by)} заразил ${teamName(e.team)}` : `🧟 ${teamName(e.team)} — первый зомби!`); return;
    }
    case 'gate': if (e.team === myTeam()) { sfx.tone(880, 0.12, 'triangle', 0.15); } return;
    case 'lap': {
      const mt = myTeam(), M = room && room.arena ? ARENA_MODES[room.arena.mode] : null;
      if (e.team === mt) { toast(`Круг ${e.lap}!`, M && e.lap < M.goal ? `осталось ${M.goal - e.lap}` : '', 'gas', 1500); sfx.sync(3); } else feed(`🏁 ${e.name}: круг ${e.lap}`);
      return;
    }
    case 'aevent': {
      const E = ARENA_EVENTS[e.e]; if (!E) return;
      toast(`${E.icon} ${E.name}!`, E.desc, 'hot', 2000); sfx.geyser();
      return;
    }
    case 'levelup': {
      if (e.id === myId) { toast(`Уровень ${e.lvl}!`, `${e.title} · ${e.gold ? 'золотой сундук' : 'коробка'} в «Подарках»`, 'ach', 3000); sfx.reveal(2); confetti(40); }
      else feed(`⭐ ${e.who} — уровень ${e.lvl}`);
      return;
    }
    case 'gift': {
      if (e.toId === myId) { toast(`${e.from} подарил вам подарок!`, `${BOXES[e.box].name} — откройте в «Подарках»`, 'ach', 3200); sfx.reveal(1); }
      else feed(`🎁 ${e.from} подарил ${e.to}: ${BOXES[e.box].name}`);
      return;
    }
    case 'drop': { const it = ITEM[e.key]; if (it && e.id !== myId) feed(`${e.r === 'legendary' ? '🌟' : '💜'} ${e.who} достал: ${it.name} (${RARITY[e.r].name.toLowerCase()})`); return; }
    case 'leave': feed(`${e.name} ушёл`); return;
    case 'pop': {
      sfx.pop(); mainRV.popAt = nowS();
      crashToast(e, pick(['Плот лопнул!', 'Ба-бах!', 'Пшшшш…', 'Прокол!']), e.who ? pick([`Последним пукнул ${e.who}`, `${e.who}: «А я что сделал?»`, `Виноват ${e.who}. Наверное.`]) : 'Никто не пукал. Виновато течение');
      splash(e.x, wy, e.z, 40, 1.2);
      for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28; gasFx.emit(e.x, wy + 0.8, e.z, Math.sin(a) * 5, Math.random() * 2, Math.cos(a) * 5, 0.8, 3, 1.8, pick(GAS)); }
      break;
    }
    case 'smash': sfx.smash(); mainRV.popAt = nowS(); crashToast(e, pick(['В щепки!', 'Разбились!', 'Бдыщ!']), e.who ? `За штурвалом был ${e.who}` : 'Скала оказалась крепче'); splash(e.x, wy, e.z, 50, 1.4); break;
    case 'bite': sfx.bite(); mainRV.popAt = nowS(); crashToast(e, pick(['Ам!', 'Крокодил доволен', 'Хрясь!']), e.who ? `${e.who} сам заплыл в пасть` : 'Плот надкушен'); splash(e.x, wy, e.z, 30, 1); break;
    case 'fall': sfx.fall(); mainRV.fallAt = nowS(); crashToast(e, pick(['За борт трассы!', 'Водопад!', 'Уплыли!']), e.who ? pick([`Штурман дня: ${e.who}`, `${e.who} выбрал короткий путь`]) : 'Течение победило'); break;
    case 'respawn': sfx.splash(0.6); mainRV.popAt = mainRV.fallAt = -99; mainRV.disp.init = false; break;
    case 'count': roundCoins = 0; clearMess(); clearShots(); for (const rv of arenaRVs.values()) { rv.disp.init = false; rv.group.visible = true; } break;
    case 'sync': P.syncMult = 1 + 0.22 * (e.n - 1); sfx.sync(e.n); if (e.n >= 3) toast(`Синхронный пук ×${e.n}!`, 'Вот это командная работа', 'sm gas', 1100); break;
    case 'cp': sfx.ding(); toast(levelIdx >= ENDLESS ? `${fmtDist(lastS)}!` : `Чекпоинт ${e.n} из ${e.of}`, 'Если что, начнём отсюда', 'sm', 1300); break;
    case 'go': sfx.beep(true); $('count').classList.add('hidden'); break;
    case 'bump': sfx.bump(e.mag); splash(mainRV.group.position.x, wy, mainRV.group.position.z, 10 * e.mag + 4, 0.6); break;
    // --- арена
    case 'abump': {
      const a = arenaRVs.get(e.a), b = arenaRVs.get(e.b); sfx.bump(Math.min(1, e.v / 8));
      if (a && b) splash((a.group.position.x + b.group.position.x) / 2, 0, (a.group.position.z + b.group.position.z) / 2, 8 + e.v * 3, 0.7);
      break;
    }
    case 'apop': {
      const rv = arenaRVs.get(e.raft); if (rv) rv.popAt = nowS();
      sfx.pop(); splash(e.x, 0, e.z, 40, 1.2);
      for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28; gasFx.emit(e.x, 0.8, e.z, Math.sin(a) * 5, Math.random() * 2, Math.cos(a) * 5, 0.8, 3, 1.8, pick(GAS)); }
      const mineT = myTeam();
      if (e.by >= 0) { feed(`${teamName(e.by)} загнал ${teamName(e.team)} на шипы`); if (e.by === mineT) toast('На шипы его!', 'Засчитано как вырубил', 'sm gas', 1300); }
      else feed(`${teamName(e.team)}: плот лопнул`);
      if (e.out) { feed(`🌀 ${teamName(e.team)} выбывает`); if (e.team === mineT) toast('Вы выбыли!', 'Смотрите, кто останется последним', '', 2200); if (rv) rv.group.visible = false; }
      else if (e.team === mineT) { toast(e.cause === 'bomb' ? 'БАБАХ!' : 'Плот лопнул!', typeof e.lives === 'number' && room.arena && ARENA_MODES[room.arena.mode].lives ? `Осталось жизней: ${e.lives}` : 'Сейчас дадут новый', 'sm', 1300); shake(0.6); }
      break;
    }
    case 'shot': spawnShot(e); break;
    case 'shotland': endShot(e.pid, e.x, e.z, e.what); break;
    case 'shothit': {
      endShot(e.pid, e.x, e.z, 'hippo');
      const h = hippos.get(e.id); if (h) { pooBurst(h, 22, 0.6); h.faintT = nowS(); }
      const meBy = me && e.by === me.name;
      if (e.id === myId) { toast('Прямое попадание!', e.by ? `${e.by} угодил калом прямо в вас` : 'Ой', 'sm poo', 1600); shake(0.5); }
      else if (meBy) { toast(pick(['Попал!', 'В яблочко!', 'Щёлк!']), `${e.who} в отключке`, 'sm gas', 1200); sfx.ding(); floatText(e.x, 2.6, e.z, '+1'); }
      feed(`💩 ${e.by || '?'} попал в ${e.who || '?'}`);
      break;
    }
    case 'pickup': pickupFx(e, e.team === myTeam()); if (e.team !== myTeam() && room && room.arena && room.arena.teams[e.team]) feed(`${room.arena.teams[e.team].name}: ${PICKUPS[e.kind].icon} ${PICKUPS[e.kind].name}`); break;
    case 'rpickup': pickupFx(e, true); break;
    case 'arespawn': { const rv = arenaRVs.get(e.raft); if (rv) { rv.popAt = -99; rv.disp.init = false; } sfx.splash(0.5); break; }
    case 'goal': {
      sfx.fanfare(); const mineT = myTeam();
      toast(e.own ? 'Автогол!' : 'ГОЛ!', `${e.name}${e.own ? ' — спасибо соперникам' : ''}`, e.team === mineT ? 'gas' : '', 2000);
      if (arenaScene && arenaScene.ball) splash(arenaScene.ball.position.x, 0, arenaScene.ball.position.z, 70, 1.6);
      break;
    }
    case 'delivery':
      sfx.ding();
      feed(`🦆 ${teamName(e.team)} доставили утку`);
      break;
    case 'overtime':
      sfx.beep(true);
      toast('Решающая доставка', 'Ещё 15 секунд', 'sm', 1250);
      break;
    case 'grow': if (tr) extendTrack(tr, e.len); break;
    case 'geyser': {
      sfx.geyser();
      const o = tr && tr.L.obstacles.find(q => q.type === 'geyser' && Math.abs(q.s - e.s) < 0.01);
      if (o) { const f = frame(tr, o.s, o.d || 0); splash(f.x, f.y, f.z, 60, 1.6); }
      break;
    }
    case 'eject': {
      const h = hippos.get(e.id);
      if (h) h.ej = { t0: nowS(), x: e.x, z: e.z, dx: e.dx, dz: e.dz, landed: false };
      sfx.yell(panFor(e.x, e.z));
      feed(`${e.who} вылетел за борт`);
      if (e.id === myId) toast('Вы за бортом!', 'Плывём обратно…', 'sm', 1500);
      break;
    }
    case 'back': { const h = hippos.get(e.id); if (h) h.ej = null; sfx.splash(0.4); break; }
    case 'shit': {
      const h = hippos.get(e.id);
      if (e.id === myId) P.needRelease = true;
      sfx.shit(hippoPan(h));
      toast(`${e.who} щёлкнул!`, pick(['Бывает…', 'Это был не пук', 'Майку теперь только выбросить', 'Тужился не в ту сторону', 'Подтекло…']), 'poo', 1800);
      if (h) { pooBurst(h, 26); h.rumbleT = nowS(); }
      if (e.pd) addPuddle(e.pd);
      break;
    }
    case 'misfire': {
      const h = hippos.get(e.id);
      if (e.id === myId) P.needRelease = true;
      sfx.misfire(hippoPan(h));
      if (e.id === myId) toast('Холостой с жидким!', pick(['Вместо пука — конфуз', 'Это было не то, на что вы рассчитывали', 'Теплее, чем хотелось бы']), 'poo', 2000);
      else { toast(`${e.who}: холостой с жидким`, pick(['Плот этого не забудет', 'Все сделали вид, что не заметили', 'Ой.']), 'sm poo', 1700); }
      if (h) { pooBurst(h, 40, 0.7); h.faintT = nowS(); h.rumbleT = nowS(); }
      if (e.pd) addPuddle(e.pd);
      break;
    }
    case 'burp': {
      const h = hippos.get(e.id);
      sfx.burp(hippoPan(h), h ? h.skin : 0);
      if (h) {
        h.burpT = nowS();
        const U = h.obj.userData; h.obj.localToWorld(tmpV.copy(U.mouthPos));
        const th = (h.rv || mainRV).group.rotation.y + (h.vpos || 0);
        for (let i = 0; i < 10; i++) gasFx.emit(tmpV.x, tmpV.y, tmpV.z, -Math.sin(th) * (1 + Math.random()), 0.6 + Math.random() * 0.6, -Math.cos(th) * (1 + Math.random()), 0.25, 0.9, 1.0, pick(BURP), { drag: 2, grav: 0.4, alpha: 0.6 });
      }
      if (Math.random() < 0.5) feed(`${e.who} ${pick(['отрыгнул', 'рыгнул на весь плот', 'выпустил газ не с той стороны'])}`);
      break;
    }
    case 'faint': {
      const h = hippos.get(e.id);
      sfx.faint(hippoPan(h));
      if (h) h.faintT = nowS();
      if (e.arena) {
        const meBy = me && e.by === me.name;
        if (e.id === myId) toast('Вас распердели!', e.by ? `${e.by} попал вонью прямо в лицо` : 'Нюхнули своего же', 'sm poo', 1800);
        else if (meBy) { toast(pick(['Попал!', 'Распердел!', 'Прямо в нос!']), `${e.who} в отключке`, 'sm gas', 1300); if (h) { h.obj.getWorldPosition(tmpV); floatText(tmpV.x, tmpV.y + 2.6, tmpV.z, '+1'); } }
        feed(e.by ? `💨 ${e.by} распердел ${e.who}` : `${e.who} отключился`);
        if (meBy) sfx.ding();
      } else if (e.id === myId) toast('Вы потеряли сознание!', e.by ? `${e.by} надымил прямо в лицо` : 'Нюхнули своего же', 'sm poo', 2000);
      else feed(e.by ? `${e.who} отключился: надымил ${e.by}` : `${e.who} отключился от вони`);
      break;
    }
    case 'ach': {
      if (e.id === myId) achToast(e.a);
      else if (ACH[e.a]) feed(`${e.who}: «${ACH[e.a].name}»`);
      break;
    }
    case 'emote': {
      showBubble(e.id, EMOTES[e.n] || '…');
      const h = hippos.get(e.id), seed = h ? h.skin : 0, base = 300 + seed * 60;
      [1, 1.25, 0.9].slice(0, e.n === 4 ? 3 : 2).forEach((k, i) => sfx.tone(base * k * (e.n === 1 ? 0.8 : 1), 0.09, 'square', 0.07, i * 0.08));
      if (!h) feed(`${e.who}: ${EMOTES[e.n]}`);
      break;
    }
    case 'overheat': {
      sfx.overheat();
      if (e.id === myId) toast('Перегрев попы!', 'Остываем пару секунд', 'sm hot', 1500); else feed(`${e.who} перегрел попу`);
      break;
    }
  }
}
function myTeam() { const A = room && room.arena; if (!A) return -1; const t = A.teams.find(t => t.members.includes(myId)); return t ? t.id : -1; }
function addPuddle(pd) {
  const y = tr ? yAt(locate(tr, pd.x, pd.z, Math.round(lastS)).s) : 0;
  puddles.add(pd, y, P.snap ? P.snap.T : 0);
  P.addPuddle(pd);
  stains.addWater(pd.x, y - 0.01, pd.z, pd.r * 1.5);
}

// ------------------------------------------------------------
//  Щелчок: снаряды из кала, след на воде до конца раунда
// ------------------------------------------------------------
// всплывающие «+1» над тем, кому досталось
const floaters = [];
function floatText(x, y, z, text, color = '#d4f752') {
  const c = document.createElement('canvas'); c.width = 192; c.height = 96; const g = c.getContext('2d');
  g.font = '900 64px Rubik, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = 10; g.strokeStyle = '#1a2238'; g.strokeText(text, 96, 50); g.fillStyle = color; g.fillText(text, 96, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.renderOrder = 13; sp.position.set(x, y, z); sp.scale.set(0.09, 0.045, 1); scene.add(sp);
  floaters.push({ sp, t0: nowS() });
}
function updateFloaters() {
  const t = nowS();
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i], age = t - f.t0;
    if (age > 1.3) { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); floaters.splice(i, 1); continue; }
    f.sp.position.y += 0.02; f.sp.material.opacity = Math.min(1, (1.3 - age) * 2.5);
    const k = Math.min(1, age * 8); f.sp.scale.set(0.09 * k, 0.045 * k, 1);
  }
}
let shakeAmp = 0;
function shake(a) { shakeAmp = Math.max(shakeAmp, a); }
const shots = new Map();
const shotGeo = new THREE.DodecahedronGeometry(0.3, 1), shotMat = new THREE.MeshStandardMaterial({ color: 0x6b4220, roughness: 0.35 });
const SHOT_G = 7, SHOT_Y0 = 1.0;
// ---------- след пука из гардероба (поверх обычного газа)
const TRAIL_COL = {
  sparks: [0xffd23f, 0xff8a1f, 0xffef9a], toxic: [0x7dff3a, 0xb8ff5a, 0x3aff7d], stars: [0xffffff, 0xfff2a8, 0xa8d8ff],
  confetti: [0xff4f7a, 0x3d8fe0, 0xffd23f, 0x4fe07a, 0xa35ee8], bubbles: [0xd8f4ff, 0xffffff, 0xb8e6ff],
};
const trailCols = Object.fromEntries(Object.entries(TRAIL_COL).map(([k, a]) => [k, a.map(c => new THREE.Color(c))]));
const rainbowCol = new THREE.Color();
function emitTrail(h, butt, ox, oz, R, t, dt, floorY) {
  const kind = h.trail, rate = [10, 18, 26][quality] * (kind === 'bubbles' ? 0.8 : 1);
  h.trailAcc += dt * rate;
  while (h.trailAcc > 1) {
    h.trailAcc -= 1;
    const sp = 3 + Math.random() * 3, j = 1.4;
    const vx = ox * sp + (Math.random() - 0.5) * j + R.vx * 0.5, vz = oz * sp + (Math.random() - 0.5) * j + R.vz * 0.5;
    if (kind === 'bubbles') { foamFx.emit(butt.x + ox * 0.2, butt.y, butt.z + oz * 0.2, vx * 0.6, 0.8 + Math.random(), vz * 0.6, 0.12 + Math.random() * 0.1, 0.22, 1.4, pick(trailCols.bubbles), { drag: 1.5, grav: -1.2, floor: floorY }); continue; }
    let col;
    if (kind === 'rainbow') col = rainbowCol.setHSL((t * 0.6 + Math.random() * 0.15) % 1, 1, 0.6);
    else col = pick(trailCols[kind] || trailCols.sparks);
    const size = kind === 'stars' ? 0.14 + Math.random() * 0.1 : kind === 'confetti' ? 0.16 : 0.18;
    trailFx.emit(butt.x + ox * 0.2, butt.y + 0.05, butt.z + oz * 0.2, vx, 0.3 + Math.random() * 1.2, vz, size, kind === 'toxic' ? 0.5 : 0.05, kind === 'stars' ? 1.4 : 0.9, col, { drag: 1.4, grav: kind === 'confetti' ? -2.5 : kind === 'toxic' ? 0.6 : 0.2, floor: floorY, alpha: 0.95 });
  }
}

// ---------- мега-пук: шкала и кнопка
function myUlt() {
  const hp = P.hp && P.hp.get(myId); if (!hp || !P.snap) return null;
  return P.snap.t === 'a' ? (hp[10] ?? 0) : (hp[9] ?? 0);
}
let ultWasReady = false;
function updateUltHud() {
  const show = joined && room && room.rules.ult !== false && (phase === 'race' || phase === 'lobby' || phase === 'count') && !modalKind;
  const u = show ? myUlt() : null;
  $('ultHud').classList.toggle('hidden', u === null);
  if (u === null) return;
  const ready = u >= 1;
  $('ultHud').classList.toggle('ready', ready);
  $('ultFill').style.transform = `scaleY(${clamp(u, 0, 1)})`;
  $('ultTxt').textContent = ready ? 'МЕГА-ПУК!' : `${Math.floor(u * 100)}%`;
  if (ready && !ultWasReady && phase === 'race') { sfx.ready(); feedOnce('Мега-пук готов — жмите Q'); }
  ultWasReady = ready;
}
let feedOnceT = 0;
function feedOnce(t) { if (nowS() - feedOnceT > 20) { feedOnceT = nowS(); feed(t); } }
function tryMega() {
  if (!room || room.rules.ult === false) return;
  const u = myUlt();
  if (u === null) return;
  if (u < 1) { toast('Мега-пук копится', `${Math.floor(u * 100)}% · газуйте, попадайте, берите бонусы`, 'sm', 1200); return; }
  send({ t: 'mega' });
}
$('ultHud').addEventListener('click', () => tryMega());
$('ultHud').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); tryMega(); }, { passive: false });
const MEGA_BROWN = [0x6e4620, 0x84602a, 0x5a3815, 0x9a7a3a].map(c => new THREE.Color(c));
const ZOMBIE_COL = [0x7dff3a, 0x4fd02a, 0xb8ff5a].map(c => new THREE.Color(c));
function megaFx(e) {
  const wy = isArena() ? 0 : mainRV.group.position.y;
  const h = hippos.get(e.id), pan = h ? hippoPan(h) : panFor(e.x, e.z);
  sfx.mega(pan);
  const cx = e.cx ?? e.x, cz = e.cz ?? e.z;
  rings.spawn(cx, wy + 0.05, cz, 1.5, e.arena ? 18 : 9, 0.9, 0.95, 0x8a5a26);
  rings.spawn(cx, wy + 0.08, cz, 1, e.arena ? 12 : 6, 0.7, 0.9, 0xc9f53e);
  const n = (e.arena ? [40, 70, 100] : [24, 40, 56])[quality];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 9;
    let vx = Math.sin(a) * sp, vz = Math.cos(a) * sp;
    if (!e.arena && e.dx !== undefined) { vx = vx * 0.4 + e.dx * sp; vz = vz * 0.4 + e.dz * sp; }
    gasFx.emit(e.x, wy + 0.6, e.z, vx, 0.3 + Math.random() * 0.8, vz, 0.6 + Math.random() * 0.4, (e.arena ? 2.6 : 2.0) + Math.random() * 1.2, 1.1 + Math.random() * 0.6, pick(MEGA_BROWN), { drag: 1.6, grav: 0.1, alpha: 0.6 });
  }
  for (let i = 0; i < 30 * (quality + 1); i++) { const a = Math.random() * 6.28; fireFx.emit(e.x, wy + 0.5, e.z, Math.sin(a) * 6, 2 + Math.random() * 3, Math.cos(a) * 6, 0.4, 0.1, 0.5, pick(FIRE), { drag: 1, grav: 1 }); }
  if (h) h.shotT = nowS();
  const mine = e.id === myId;
  const d = Math.hypot(camera.position.x - cx, camera.position.z - cz);
  shake(mine ? 0.9 : Math.max(0, 0.7 - d / 40));
  floatText(e.x, wy + 2.5, e.z, 'МЕГА-ПУК!', '#ffb340');
  if (mine) toast('МЕГА-ПУК!', e.arena ? (e.hit && e.hit.length ? `Раскидал ${e.hit.length} ${plural(e.hit.length, 'плот', 'плота', 'плотов')}` : 'Волна ушла в пустоту') : 'Турбо на 3 секунды', 'hot', 1400);
  else feed(`${e.who}: 💥 МЕГА-ПУК!`);
}

function spawnShot(e) {
  if (shots.has(e.pid)) return;
  const mesh = new THREE.Mesh(shotGeo, shotMat); mesh.castShadow = true; scene.add(mesh);
  shots.set(e.pid, { e, mesh, lx: e.x, lz: e.z, vy: (SHOT_G * e.life * e.life / 2 - SHOT_Y0) / e.life });
  sfx.shot(panFor(e.x, e.z));
  for (let i = 0; i < 8; i++) pooFx.emit(e.x, SHOT_Y0, e.z, e.vx * 0.15 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, e.vz * 0.15 + (Math.random() - 0.5) * 2, 0.16, 0.2, 0.6, pick(POO), { drag: 0.5, grav: -10, floor: 0 });
  const h = hippos.get(e.id); if (h) h.burpT = -9, h.shotT = nowS();
}
function endShot(pid, x, z, what) {
  const s = shots.get(pid);
  if (s) { if (arenaScene && x !== undefined) arenaScene.paintStroke(s.lx, s.lz, x, z); scene.remove(s.mesh); shots.delete(pid); }
  if (x === undefined) return;
  const onWater = what === 'water' || what === 'wall' || what === undefined;
  if (arenaScene && onWater) arenaScene.paintBlob(x, z, 0.7);
  for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, sp = 1 + Math.random() * 3; pooFx.emit(x, onWater ? 0.1 : 0.9, z, Math.sin(a) * sp, 1.5 + Math.random() * 2.5, Math.cos(a) * sp, 0.18, 0.25, 0.7, pick(POO), { drag: 0.6, grav: -10, floor: 0 }); }
  if (onWater) rings.spawn(x, 0.03, z, 0.3, 2.2, 0.8, 0.5);
  sfx.splat(panFor(x, z), onWater ? 0.6 : 1);
}
function updateShots(Tnow) {
  for (const [pid, s] of shots) {
    const e = s.e, age = clamp(Tnow - e.T, 0, e.life);
    const x = e.x + e.vx * age, z = e.z + e.vz * age, y = Math.max(0.1, SHOT_Y0 + s.vy * age - SHOT_G * age * age);
    s.mesh.position.set(x, y, z); s.mesh.rotation.set(age * 9, age * 7, 0);
    if (arenaScene) arenaScene.paintStroke(s.lx, s.lz, x, z);
    if (Math.random() < 0.35) pooFx.emit(x, y, z, (Math.random() - 0.5), -1, (Math.random() - 0.5), 0.1, 0.12, 0.5, pick(POO), { drag: 0.5, grav: -10, floor: 0 });
    s.lx = x; s.lz = z;
    if (age >= e.life) endShot(pid, x, z, 'water');
  }
}
function clearShots() { for (const s of shots.values()) scene.remove(s.mesh); shots.clear(); }
// бонусы на воде (арена и сплав)
const pkVis = new Map();
function syncPickups(list, t) {
  const seen = new Set();
  for (const [id, kind, x, z, y] of list || []) {
    seen.add(id);
    let m = pkVis.get(id);
    if (!m) { m = makePickupMesh(kind); scene.add(m); pkVis.set(id, m); }
    m.position.set(x, (y || 0) + 0.75, z); animatePickup(m, t);
  }
  for (const [id, m] of pkVis) if (!seen.has(id)) { scene.remove(m); pkVis.delete(id); }
}
function clearPickups() { for (const m of pkVis.values()) scene.remove(m); pkVis.clear(); }
const PK_TOAST = { bean: ['Боб!', 'газ снова полный'], gold: ['Золотой боб!', 'полный газ и +3 очка'], pepper: ['Острый перец!', 'тяга в полтора раза сильнее 6 с'], clip: ['Прищепка!', 'вонь и снаряды не страшны 8 с'], stink: ['Вонючка!', 'вокруг плота кольцо вони'], magnet: ['Магнит!', 'бонусы сами плывут к вам 8 с'] };
function pickupFx(e, mine) {
  const m = pkVis.get(e.pkid); const y = m ? m.position.y : 0.8;
  if (m) { scene.remove(m); pkVis.delete(e.pkid); }
  sfx.pickup(e.kind);
  const col = new THREE.Color({ bean: 0xffb36b, gold: 0xffe14a, pepper: 0xff5a3c, clip: 0x7fe0ff, stink: 0x9a7a3a, magnet: 0x5a8cff }[e.kind] || 0xffffff);
  for (let i = 0; i < 18; i++) { const a = Math.random() * 6.28; fireFx.emit(e.x, y, e.z, Math.sin(a) * 3, 2 + Math.random() * 2, Math.cos(a) * 3, 0.3, 0.05, 0.6, col, { drag: 1.5, grav: -3 }); }
  if (mine) toast(PK_TOAST[e.kind][0], PK_TOAST[e.kind][1], 'sm gas', 1300);
  if (room && room.arena && ARENA_MODES[room.arena.mode].beans && (e.kind === 'bean' || e.kind === 'gold')) floatText(e.x, y + 1.6, e.z, e.kind === 'gold' ? '+3' : '+1', e.kind === 'gold' ? '#ffd23f' : '#ffb36b');
}

// ------------------------------------------------------------
//  Главный цикл
// ------------------------------------------------------------
let camH = 0, camSnap = true, wardSnap = false; const camPos = new THREE.Vector3(0, 9, -9), camLook = new THREE.Vector3();
let lastFrame = nowS(), lastS = 0;
let frameWorst = 0, frameWorstShow = 0, diagT = 0;
let fpsAcc = 0, fpsN = 0, fpsT = nowS(), lowFpsStreak = 0, hudT = 0, sectorKey = '', chunkCount = 0;
let frameRequest = 0;

const FPS_CAP = +(new URLSearchParams(location.search).get('fps') || 0);      // для тестов: ?fps=10
function animate() {
  if (!joined) { frameRequest = 0; return; }
  frameRequest = requestAnimationFrame(animate);
  const t = nowS();
  if (FPS_CAP && t - lastFrame < 1 / FPS_CAP - 0.002) return;
  const rawDt = t - lastFrame, dtReal = Math.min(0.25, rawDt), dt = Math.min(0.05, dtReal); lastFrame = t;
  if (rawDt > frameWorst) frameWorst = rawDt;
  fpsAcc += rawDt; fpsN++;
  if (t - fpsT > 2) {
    fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; fpsT = t; frameWorstShow = frameWorst; frameWorst = 0;
    if (qualityMode === 'auto' && quality > 0 && fps < 40) { if (++lowFpsStreak >= 2) { quality--; lowFpsStreak = 0; applyQuality(); feed(quality === 1 ? 'Графика: средняя, для плавности' : 'Графика: низкая, для плавности'); } }
    else lowFpsStreak = 0;
    $('perfInfo').textContent = `${Math.round(fps)} кадров/с, худший кадр ${Math.round(frameWorstShow * 1000)} мс, пинг сети ${Math.round(P.rtt * 1000)} мс. F3 — подробно.`;
    $('netInfo').textContent = joined && P.rtt ? `${Math.round(P.rtt * 1000)} мс` : '';
    $('netInfo').className = P.rtt > 0.15 ? 'bad' : P.rtt > 0.07 ? 'mid' : '';
  }

  if (t - diagT > 0.5) { diagT = t; renderDiag(t); }
  const inp = joined ? readInput(dt) : { f: 0, c: 0, s: 0 };
  if (joined) { sendInput(inp); P.record(t, inp); }
  const ok = P.run(t); NET.steps = P.steps;
  if (ok) NET.frames++;
  if (ok && P.kind === 'arena' && arenaScene && P.A) frameArena(t, dt, dtReal);
  else if (ok && P.kind === 'race' && levelScene && P.snap.t === 's') frameRace(t, dt, dtReal);

  updateFloaters();
  if (shakeAmp > 0.01) { camera.position.x += (Math.random() - 0.5) * shakeAmp; camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.6; camera.position.z += (Math.random() - 0.5) * shakeAmp; shakeAmp *= Math.exp(-dt * 7); }
  updateBubbles();
  gasFx.update(dt); pooFx.update(dt); foamFx.update(dt); fireFx.update(dt); trailFx.update(dt); updateUltHud(t); rings.update(dt); traces.update(dt);
  renderer.render(scene, camera);
}

// общий для сплава и арены: звук, урчание, анимация одного бегемота
function driveHippo(ph, flags, dirt, rv, R, t, dt, waterY) {
  const id = ph.id, h = ensureHippo(id);
  h.rv = rv;
  const off = !!(flags & 1), hot = !!(flags & 2), stun = !!(flags & 4), faint = !!(flags & 32);
  h.gas = ph.gas; h.heat = ph.heat; h.flags = flags; h.seat = ph.seat;
  if (Math.abs(dirt - h.dirt) > 0.02) { h.dirt = dirt; setHippoDirt(h.obj, h.dirt); }
  if (h.vpos === null || Math.abs(wrapAngle(ph.pos - h.vpos)) > 1) h.vpos = ph.pos;
  else h.vpos = lerpAng(h.vpos, ph.pos, 1 - Math.exp(-dt * (id === myId ? 30 : 18)));
  const f = ph.fartOn && !off;
  if (f && !h.farting) sfx.fartStart(id, { seed: h.skin, loud: id === myId ? 1 : 0.6, pan: hippoPan(h), heat: ph.heat, gas: ph.gas, burst: true, voice: h.voice });
  if (!f && h.farting) sfx.fartStop(id);
  if (f) sfx.fartUpdate(id, ph.heat, ph.gas);
  h.farting = f;
  sfx.sizzle(id, (hot ? 1 : clamp((ph.heat - 0.72) / 0.28, 0, 1)) * (id === myId ? 1 : 0.5));
  h.rumbleNext -= dt * (ph.gas < 0.3 ? 4 : ph.gas < 0.5 ? 1.6 : 0.35) * (1 + h.dirt);
  if (h.rumbleNext <= 0 && !off && phase !== 'results') { h.rumbleNext = 6 + Math.random() * 10; h.rumbleT = t; sfx.rumble(hippoPan(h), id === myId ? 1 : 0.45); }
  animateHippo(h, { pos: h.vpos, vel: ph.vel, f, heat: ph.heat, hot, stun, faint, off, t, dt, R, waterY, rv, spray: f && (flags & 16 || (id === myId && ph.gas < PHYS.sprayGas)) });
  return h;
}
function placeCamera(rv, waterY, t, dt, lookH, distMul = 1, cargo = null) {
  const wardrobe = !$('wardrobe').classList.contains('hidden') && hippos.get(myId) && hippos.get(myId).rv && hippos.get(myId).obj.parent === hippos.get(myId).rv.holder;
  if (wardrobe) {
    const mh = hippos.get(myId), mrv = mh.rv, th = mrv.disp.a + mh.vpos;
    mh.obj.getWorldPosition(tmpV2);
    const center = isCenter(mh.seat), dir = th + (center ? Math.PI : 0) + fittingAngles[fittingView], dist = innerWidth <= 760 ? 5.15 : 3.15;
    const want = tmpV.set(tmpV2.x - Math.sin(dir) * dist * (center ? -1 : 1), tmpV2.y + 1.35, tmpV2.z - Math.cos(dir) * dist * (center ? -1 : 1));
    if (wardSnap) { camPos.copy(want); wardSnap = false; } else camPos.lerp(want, Math.min(1, dt * 5));
    camera.position.copy(camPos);
    camLook.set(tmpV2.x, tmpV2.y + 0.75, tmpV2.z); camera.lookAt(camLook);
    return;
  }
  const d = rv.disp;
  const focusX = cargo ? d.x + (cargo.x - d.x) * 0.32 : d.x;
  const focusZ = cargo ? d.z + (cargo.z - d.z) * 0.32 : d.z;
  camH = camSnap ? lookH : lerpAng(camH, lookH, Math.min(1, dt * 1.8));
  const yaw = camH + camYawOff, hd = Math.cos(camPitch) * camDist * distMul;
  const want = tmpV.set(focusX - Math.sin(yaw) * hd, waterY + 0.3 + Math.sin(camPitch) * camDist * distMul, focusZ - Math.cos(yaw) * hd);
  if (camSnap) camPos.copy(want); else camPos.lerp(want, Math.min(1, dt * (nowS() - lastDragT < 0.3 ? 14 : 4)));
  camSnap = false;
  camera.position.copy(camPos);
  camLook.set(focusX + Math.sin(yaw) * 2.5, waterY + 0.3, focusZ + Math.cos(yaw) * 2.5);
  camera.lookAt(camLook);
}

function frameRace(t, dt, dtReal) {
  const sn = P.snap, R = P.W.raft, predT = P.T, predRem = P.rem, rv = mainRV;
  lastS = R.s;
  if (tr.endless) {
    extendTrack(tr, R.s + 460);
    levelScene.ensure(R.s + 420); levelScene.trim(R.s - 70);
    if (levelScene.chunks.length !== chunkCount) { chunkCount = levelScene.chunks.length; prewarm(levelScene.chunks[chunkCount - 1].g); }
    const th = tr.themeAt(R.s + 30); if (th !== themeT.name) setTheme(th, false);
  }
  blendTheme(Math.min(1, dt * 0.8));
  levelScene.update(predT, dt, camera.position);
  const waterY = yAt(R.s);
  rv.place(R, predRem, t, dtReal, waterY, sn.inv && sn.ph === 'race');
  setRaftDirt(rv.model, sn.rd || 0);
  const n = P.W.hippos.length, nr = rimCount(n), half = sectorHalf(nr);
  const colorOf = (id) => { const p = room && room.players.find(q => q.id === id); return SKINS[p ? p.skin : 0].css; };
  const sk = sn.hp.map(h => h[0] + ':' + h[1]).join(',') + (room ? room.players.map(p => p.skin).join() : '') + rv.shape;
  if (sk !== rv.sectorKey) {
    rv.sectorKey = sk;
    const ctr = sn.hp.find(h => isCenter(h[1]));
    setRaftSectors(rv.model, sn.hp.filter(h => !isCenter(h[1])).map(h => ({ seat: h[1], color: colorOf(h[0]) })), nr, half, sectorCenter, ctr ? colorOf(ctr[0]) : null);
  }
  const seen = new Set();
  for (const ph of P.W.hippos) {
    const hp = P.hp.get(ph.id); if (!hp) continue;
    seen.add(ph.id);
    driveHippo(ph, hp[7], hp[8] || 0, rv, R, t, dt, waterY);
  }
  for (const id of [...hippos.keys()]) if (!seen.has(id)) removeHippo(id);
  rv.wake(R, dt, waterY);
  rv.effects(sn.rf || 0, R, dt);
  syncPickups(sn.pk, t);
  placeCamera(rv, waterY, t, dt, frame(tr, Math.min(tr.length, R.s + 4)).h);
  sun.position.set(rv.disp.x + 12, waterY + 26, rv.disp.z - 9); sun.target.position.set(rv.disp.x, waterY, rv.disp.z);
  sky.position.copy(camera.position);
  puddles.update(sn.T);
  hudT += dt;
  if (hudT > 0.1) { hudT = 0; renderTeam(sn.hp.map(h => ({ id: h[0], seat: h[1], flags: h[7], n: sn.n || sn.hp.length }))); }
  if (sn.ph === 'race') $('timer').textContent = fmtTime(sn.rt + (predT - sn.T));
  countdown(sn, predT);
  if (tr.endless) {
    $('ehDist').textContent = fmtDist(Math.max(0, R.s - 3));
    $('ehLives').innerHTML = '<i>❤</i>'.repeat(Math.max(0, sn.lv || 0)) || '<span>последняя попытка</span>';
    const dkey = levelIdx === DAILY && room && room.daily ? 'daily:' + room.daily.date : 'endless';
    const best = Math.max(levelIdx === DAILY ? 0 : (me ? me.endlessBest || 0 : 0), room && room.records[dkey] ? room.records[dkey].dist : 0);
    $('ehBest').textContent = (levelIdx === DAILY ? `${dailyMutator(room.daily.seed).name} · ` : '') + (best ? `рекорд ${fmtDist(best)}` : 'рекорда ещё нет');
  } else {
    const pr = Math.min(1, R.s / tr.length) * 100;
    $('progFill').style.width = pr + '%'; $('progRaft').style.left = pr + '%';
  }
  $('syncBadge').classList.toggle('hidden', !sn.sy);
}
function countdown(sn, predT) {
  if (sn.ph === 'count') {
    const c = Math.ceil(-(sn.rt + (predT - sn.T)));
    if (c >= 1 && c <= 3 && c !== lastCountShown && joined && room) {
      const mode = room.arena?.mode;
      $('countTitle').textContent = mode ? ARENA_MODES[mode].name : routeInfo(room.level).title;
      $('countHint').textContent = mode ? modeGoalText(mode) : room.level >= ENDLESS ? 'Уйдите как можно дальше' : 'Доберитесь до финиша';
      $('countNumber').textContent = c;
      $('count').classList.remove('hidden');
      sfx.beep(false);
      lastCountShown = c;
    }
    $('timer').textContent = fmtTime(0);
  } else lastCountShown = null;
}

let bombTickSec = -1;
function frameArena(t, dt, dtReal) {
  const sn = P.snap, A = P.A, predT = P.T, extra = predT - sn.T;
  blendTheme(Math.min(1, dt * 0.8));
  arenaScene.update(t, dt, sn, extra);
  if (A.ball) arenaScene.placeBall(A.ball.x + A.ball.vx * P.rem, A.ball.z + A.ball.vz * P.rem, dt);
  if (A.duck) arenaScene.placeDuck(A.duck, A.rafts, t, dt);
  const teamLivery = A.mode === 'ball' || A.mode === 'tow';
  const teams = room && room.arena ? room.arena.teams : [];
  const colorOf = (id) => { const p = room && room.players.find(q => q.id === id); return SKINS[p ? p.skin : 0].css; };
  const rafts = new Map(sn.r.map(r => [r[0], r]));
  syncPickups(sn.pk, t);
  updateShots(predT);
  const outRaft = new Set();
  for (const R of A.rafts) {
    const rv = arenaRVs.get(R.id); if (!rv) continue;
    const r = rafts.get(R.id), fl = r ? r[10] || 0 : 0;
    if (fl & 4) { outRaft.add(R.id); rv.group.visible = false; continue; }
    rv.group.visible = true;
    rv.place(R, P.rem, t, dtReal, 0, r && r[8] && sn.ph === 'race');
    rv.effects(fl, R, dt);
    const left = sn.bm && sn.bm[0] === R.id ? sn.bm[1] - extra : 99;
    rv.modeFx(fl, dt, left);
    if (fl & 16 && R.team === myTeam() && sn.ph === 'race') { const sec = Math.ceil(left); if (sec !== bombTickSec) { bombTickSec = sec; sfx.beep(sec <= 3); } }
    if (A.mode === 'laps' && R.team === myTeam() && r) arenaScene.setNextGate(r[11] || 0);
    setRaftDirt(rv.model, R.dirt || 0);
    const n = R.hippos.length, half = sectorHalf(n);
    const sk = R.hippos.map(h => h.id + ':' + h.seat).join(',') + (room ? room.players.map(p => p.skin).join() : '');
    if (sk !== rv.sectorKey) { rv.sectorKey = sk; const tcol = teamLivery && teams[R.team] ? teams[R.team].color : null; setRaftSectors(rv.model, R.hippos.map(h => ({ seat: h.seat, color: tcol || colorOf(h.id) })), n, half, sectorCenter, null); }
    rv.wake(R, dt, 0);
  }
  const seen = new Set();
  for (const ph of A.hippos) {
    const hp = P.hp.get(ph.id); if (!hp) continue;
    seen.add(ph.id);
    const R = A.rafts[ph.raft], rv = arenaRVs.get(R.id); if (!rv || outRaft.has(R.id)) continue;
    driveHippo(ph, hp[8], hp[9] || 0, rv, R, t, dt, 0);
  }
  for (const id of [...hippos.keys()]) if (!seen.has(id)) removeHippo(id);
  // камера: над своим плотом (зритель — над серединой пруда)
  const mine = A.hippos.find(h => h.id === myId), mrv = mine && !outRaft.has(mine.raft) ? arenaRVs.get(mine.raft) : null;
  if (mrv) {
    const R = A.rafts[mine.raft];
    const heading = A.duck ? ((R.side ?? R.team) === 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(-mrv.disp.x, -mrv.disp.z);
    placeCamera(mrv, 0, t, dt, heading, 1.35, A.duck?.owner === R.id ? A.duck : null);
  }
  else {
    camH += dt * 0.08; const hd = Math.cos(0.9) * 34;
    camera.position.set(-Math.sin(camH + camYawOff) * hd, Math.sin(0.9) * 34, -Math.cos(camH + camYawOff) * hd); camera.lookAt(0, 0, 0);
  }
  const fx = mrv ? mrv.disp.x : 0, fz = mrv ? mrv.disp.z : 0;
  sun.position.set(fx + 12, 26, fz - 9); sun.target.position.set(fx, 0, fz);
  sky.position.copy(camera.position);
  hudT += dt;
  if (hudT > 0.1) {
    hudT = 0;
    renderTeam(A.hippos.map(h => { const hp = P.hp.get(h.id); return { id: h.id, seat: h.seat, flags: hp ? hp[8] : 0, n: A.rafts[h.raft].hippos.length, color: teamLivery && teams[h.team] ? teams[h.team].color : null }; }));
    renderArenaHud(sn);
    if (A.duck) renderTowGuide(A, mine && A.rafts[mine.raft], sn);
  }
  $('timer').textContent = sn.ph === 'race' ? fmtTime(sn.left) : fmtTime(ARENA_MODES[A.mode].time);
  $('syncBadge').classList.add('hidden');
  countdown(sn, predT);
}
function modeGoalText(mode) {
  const M = ARENA_MODES[mode];
  if (M.lives) return `${M.lives} жизни, последний на плаву побеждает`;
  if (M.laps) return `${M.goal} круга вокруг острова`;
  if (M.zombie) return 'больше всех очков к концу раунда';
  if (mode === 'king') return `до ${M.goal} очков в круге`;
  if (mode === 'ball') return `до ${M.goal} голов`;
  if (mode === 'tow') return `до ${M.goal} доставок`;
  if (M.shoot) return `до ${M.goal} попаданий (вонь тоже считается)`;
  if (M.beans) return `до ${M.goal} очков бобами`;
  return `до ${M.goal} вырубленных коричневым дымом`;
}
function renderTowGuide(A, raft, sn) {
  const active = sn.ph === 'race';
  $('towGuide').classList.toggle('hidden', !active);
  if (!active) return;
  const duck = A.duck, towing = raft && duck.owner === raft.id;
  const holder = A.rafts.find(r => r.id === duck.owner);
  const ownDock = raft?.team === 0 ? 'причал с солнцем' : 'причал с якорем';
  const side = raft ? towDockSide(raft.side ?? raft.team) : 0;
  // Войти надо всем буксиром: рулевого ведём дальше створа, расстояние считаем для груза.
  const x = towing ? side * ARENA_R : duck.x;
  const z = towing ? 0 : duck.z;
  const dx = x - (raft?.x ?? 0), dz = z - (raft?.z ?? 0);
  const distance = towing
    ? Math.hypot(Math.max(0, TOW_DOCK_X - side * duck.x), Math.max(0, Math.abs(duck.z) - TOW_DOCK_HALF))
    : Math.hypot(dx, dz);
  const action = towing ? 'Утка на тросе' : holder ? 'Перехватите утку' : 'Подцепите утку';
  $('towAction').textContent = sn.waiting ? 'Ждём экипаж' : !raft ? 'С трибуны' : action;
  $('towHint').textContent = sn.waiting ? 'Матч на паузе' : !raft ? (holder ? `Буксируют ${teamName(holder.team)}` : 'Утка свободна')
    : towing ? `Тяните в ${ownDock}` : holder ? 'Подойдите к самому грузу' : 'Сбавьте газ рядом с ней';
  $('towDistance').textContent = sn.waiting || !raft ? '' : `${Math.ceil(distance)} м`;
  const needle = $('towNeedle');
  needle.style.visibility = !raft || sn.waiting ? 'hidden' : '';
  if (raft && !sn.waiting) {
    const m = camera.matrixWorld.elements;
    const horizontal = Math.hypot(m[8], m[10]) || 1;
    const angle = Math.atan2(dx * m[0] + dz * m[2], -(dx * m[8] + dz * m[10]) / horizontal);
    needle.style.transform = `rotate(${angle}rad)`;
  }
  $('timer').classList.toggle('overtime', !!sn.ot);
}
function renderArenaHud(sn) {
  const A = room && room.arena; if (!A) return;
  const M = ARENA_MODES[A.mode], sc = sn.sc || [], mt = myTeam();
  const outs = new Set((sn.r || []).filter(r => (r[10] || 0) & 4).map(r => r[0])), infs = new Set((sn.r || []).filter(r => (r[10] || 0) & 8).map(r => r[0]));
  $('ahScore').innerHTML = A.teams.map((t, i) => `<div class="sc ${i === mt ? 'me' : ''} ${sn.kt === i ? 'king' : ''} ${outs.has(i) ? 'out' : ''}" style="--tc:${t.color}"><i></i><span>${esc(t.name)}</span><b>${M.lives ? ('❤'.repeat(sc[i] ?? 0) || '✖') : (sc[i] ?? 0)}${M.zombie && infs.has(i) ? ' 🧟' : ''}${M.bomb && sn.bm && sn.bm[0] === i ? ' 💣' : ''}</b></div>`).join('');
  let extra = '';
  if (A.mode === 'king') extra = sn.kt >= 0 ? ` · круг держит ${A.teams[sn.kt] ? A.teams[sn.kt].name : ''}` : sn.kt === -2 ? ' · в круге драка' : ' · круг свободен';
  if (M.shrink && typeof sn.rad === 'number') extra = ` · забор: ${Math.round(sn.rad)} м от центра`;
  if (M.shoot) extra = ' · E или правая кнопка — выстрел';
  if (M.bomb) extra = sn.bm ? ` · 💣 у ${A.teams[sn.bm[0]] ? A.teams[sn.bm[0]].name : '?'}: ${Math.ceil(sn.bm[1])} с` : ' · бомба скоро появится';
  if (M.zombie) extra = ` · 🧟 зомби: ${infs.size}, здоровых: ${A.teams.length - infs.size}`;
  if (M.laps) { const mr = (sn.r || []).find(r => r[0] === mt); if (mr) extra = ` · ваш круг ${Math.min(M.goal, (mr[12] || 0) + 1)} из ${M.goal}, следующие ворота: ${mr[11] === 0 ? 'старт/финиш' : `${mr[11]} из ${LAP_GATES - 1}`}`; }
  if (sn.evt && ARENA_EVENTS[sn.evt[0]]) extra += ` · ${ARENA_EVENTS[sn.evt[0]].icon} ${ARENA_EVENTS[sn.evt[0]].name}!`;
  $('ahInfo').textContent = `${M.icon} ${M.name} · ${modeGoalText(A.mode)}${extra}`;
}

// Подробная статистика (F3): где именно тормозит — сеть, сервер или видеокарта
function renderDiag(t) {
  const el = $('diag'); if (el.classList.contains('hidden')) return;
  const pings = NETSTAT.pings.filter(p => t - p[0] < 6).map(p => p[1] * 1000), gaps = NETSTAT.gaps.filter(g => t - g[0] < 3).map(g => g[1] * 1000);
  const mx = (a) => a.length ? Math.round(Math.max(...a)) : '—', mn = (a) => a.length ? Math.round(Math.min(...a)) : '—';
  const row = (k, v, bad) => `<div class="${bad ? 'bad' : ''}"><span>${k}</span><b>${v}</b></div>`;
  const fw = Math.round(frameWorstShow * 1000), pm = mx(pings), gm = mx(gaps), lg = NETSTAT.srvLag;
  el.innerHTML = '<h4>Статистика (F3)</h4>' +
    row('Кадров в секунду', Math.round(fps), fps < 40) +
    row('Худший кадр', `${fw} мс`, fw > 100) +
    row('Пинг сети (мин…макс)', `${mn(pings)}…${pm} мс`, pm !== '—' && pm > 80) +
    row('Перерыв между снимками', `до ${gm} мс`, gm !== '—' && gm > 120) +
    row('Задержка сервера', `${lg} мс`, lg > 50) +
    row('Упреждение', `${Math.round(P.lead() * 1000)} мс, ${P.steps} шагов`) +
    row('Графика', ['низкая', 'средняя', 'высокая'][quality] + (qualityMode === 'auto' ? ' (авто)' : '')) +
    `<p>${fw > 150 && (pm === '—' || pm < 50) ? (quality > 0 ? 'Тормозит компьютер или видеокарта: попробуйте графику «Низкая» (⚙).' : 'Тормозит компьютер или видеокарта даже на низкой графике: закройте лишние вкладки и программы.') : pm !== '—' && pm > 80 ? 'Плохая сеть: подключите хост кабелем, проверьте Wi-Fi.' : lg > 50 ? 'Тормозит сервер: закройте лишние программы на компьютере хоста.' : 'Всё в порядке.'}</p>`;
}
addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); $('diag').classList.toggle('hidden'); diagT = 0; } });

// Облачка с фразами над бегемотами
const bubbles = new Map();
function bubbleSprite(text) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 120;
  const x = c.getContext('2d');
  x.font = '800 40px Rubik, "Segoe UI", sans-serif';
  const w = Math.min(300, x.measureText(text).width + 44), x0 = (320 - w) / 2;
  x.fillStyle = '#fff3e3'; x.strokeStyle = '#1a2238'; x.lineWidth = 6; x.lineJoin = 'round';
  x.beginPath(); x.roundRect(x0, 8, w, 74, 30); x.moveTo(150, 80); x.lineTo(160, 108); x.lineTo(176, 80); x.fill(); x.stroke();
  x.fillStyle = '#fff3e3'; x.fillRect(150, 74, 26, 9);
  x.fillStyle = '#1a2238'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 160, 47);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.renderOrder = 12; return sp;
}
function showBubble(id, text) {
  const old = bubbles.get(id); if (old) { scene.remove(old.sp); old.sp.material.map.dispose(); }
  const sp = bubbleSprite(text); scene.add(sp);
  bubbles.set(id, { sp, t0: nowS() });
}
function updateBubbles() {
  const t = nowS();
  for (const [id, b] of bubbles) {
    const h = hippos.get(id), age = t - b.t0;
    if (!h || age > 2.2) { scene.remove(b.sp); b.sp.material.map.dispose(); bubbles.delete(id); continue; }
    h.obj.getWorldPosition(b.sp.position); b.sp.position.y += 2.9;
    const k = Math.min(1, age * 6), s = (0.6 + 0.4 * k) * (age > 1.9 ? (2.2 - age) / 0.3 : 1);
    b.sp.scale.set(0.3 * s, 0.1125 * s, 1);
  }
}

const characterMotionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
function animateHippo(h, { pos, vel, f, heat, hot, stun, faint, off, t, dt, R, waterY, spray, rv }) {
  const o = h.obj, U = o.userData, disp = rv.disp, raftGroup = rv.group, center = isCenter(h.seat), rr = center ? 0 : rimR(rv.S, pos);
  if (U.head.userData.hat && U.head.userData.hat.userData.spin) U.head.userData.hat.userData.spin.rotation.y += dt * (f ? 30 : 4);
  if (U.anim.length) for (const fn of U.anim) fn(t, dt, f);
  // --- за бортом: летит, плюхается, плывёт обратно
  if (off && h.ej) {
    if (o.parent !== swimmers) swimmers.add(o);
    const e = h.ej, k = t - e.t0;
    if (k < 0.85) {
      const q = k / 0.85;
      o.position.set(e.x + e.dx * 5.5 * q, waterY + 0.5 + Math.sin(Math.PI * q) * 3.2, e.z + e.dz * 5.5 * q);
      o.rotation.set(q * 7, Math.atan2(e.dx, e.dz), q * 3);
    } else {
      if (!e.landed) { e.landed = true; e.lx = e.x + e.dx * 5.5; e.lz = e.z + e.dz * 5.5; splash(e.lx, waterY, e.lz, 30, 1); }
      const q = clamp((k - 0.85) / (PHYS.offTime - 1.1), 0, 1);
      const th = disp.a + pos, tx = disp.x + Math.sin(th) * (rimR(rv.S, pos) + 0.9), tz = disp.z + Math.cos(th) * (rimR(rv.S, pos) + 0.9);
      o.position.set(lerp(e.lx, tx, q * q), waterY - 0.95 + Math.sin(t * 6) * 0.06, lerp(e.lz, tz, q * q));
      o.rotation.set(0.3, Math.atan2(tx - o.position.x, tz - o.position.z), 0);
      U.arms[0].rotation.x = Math.sin(t * 9) * 1.2; U.arms[1].rotation.x = -Math.sin(t * 9) * 1.2;
      if (Math.random() < dt * 8) foamFx.emit(o.position.x, waterY + 0.05, o.position.z, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.2, 0.1, 0.6, WHITE, { grav: -6, floor: waterY });
    }
    return;
  }
  if (off) { if (o.parent !== swimmers) swimmers.add(o); o.position.set(raftGroup.position.x, waterY - 0.9, raftGroup.position.z); return; }
  if (o.parent !== rv.holder) { rv.holder.add(o); o.rotation.set(0, 0, 0); }
  // --- на кромке: лицом к центру плота (центральный — сидит на полу и вертится)
  o.position.set(Math.sin(pos) * rr, center ? -0.05 : 0.38, Math.cos(pos) * rr);
  o.rotation.set(0, pos + Math.PI, 0);
  const crawl = Math.abs(vel) > 0.25 && !faint;
  const inner = U.inner;
  const burp = clamp(1 - (t - h.burpT) / 0.7, 0, 1), rumble = clamp(1 - (t - h.rumbleT) / 1.4, 0, 1);
  const motion = characterMotionQuery?.matches ? 0.15 : 1;
  const breath = Math.sin(t * 2.45 + h.jit) * motion, effort = f ? 1 : 0;
  const pant = hot ? 1 : clamp((heat - 0.58) / 0.42, 0, 1);
  const turnTarget = clamp(R.w / 3.8, -1, 1), follow = 1 - Math.exp(-dt * 8);
  h.turnLean = lerp(h.turnLean || 0, turnTarget, follow);
  const turn = h.turnLean;
  if (f) {
    inner.position.set(Math.sin(t * 20 + h.jit) * 0.016 * motion, 0.015, Math.sin(t * 16 + h.jit) * 0.018 * motion);
    U.cheeks.scale.set(1.08 + Math.sin(t * 20) * 0.045 * motion, 0.94, 1.05);
    U.chest.rotation.x = 0.42;
    U.head.rotation.x = 0.06 + Math.sin(t * 18 + h.jit) * 0.035 * motion;
  } else {
    inner.position.set(0, (breath + 1) * 0.014, 0);
    U.cheeks.scale.set(1, 1, 1);
    U.chest.rotation.x = 0.28;
    U.head.rotation.x = -0.10 + breath * 0.037 - pant * 0.12;
  }
  // выстрел: попа резко сжимается, бегемота подбрасывает
  const shotK = clamp(1 - (t - (h.shotT || -9)) / 0.25, 0, 1);
  if (shotK > 0) { U.cheeks.scale.set(1 - 0.25 * shotK, 1 + 0.2 * shotK, 1 - 0.3 * shotK); inner.position.y += 0.12 * shotK; }
  // урчание: живот подрагивает, бегемот ёрзает
  const belly = breath * 0.017 + Math.sin(t * 28) * 0.035 * rumble * motion;
  U.chest.scale.set(1 + belly + effort * 0.027, 1 - belly * 0.5, 1 + belly);
  U.chest.rotation.z = turn * 0.15;
  // отрыжка: голова дёргается вверх, рот открыт
  if (burp > 0) U.head.rotation.x -= Math.sin(burp * Math.PI) * 0.5;
  U.jaw.rotation.x = 0.09 + (faint ? 0.29 : 0.04 * breath + pant * (0.25 + 0.10 * Math.sin(t * 6) * motion) + burp * 0.57);
  U.muzzle.scale.x = 0.49 + effort * 0.035 + pant * 0.01;
  U.muzzle.scale.y = 0.225 + effort * 0.019;
  U.muzzle.material.color.lerpColors(U.snoutBase, U.blush, pant * 0.20);
  inner.rotation.z = turn * 0.12 + Math.sin(t * 9) * 0.05 * rumble;
  // перебирание руками
  if (crawl) { const w = t * 11; U.arms[0].rotation.x = Math.max(0, Math.sin(w)) * 0.9; U.arms[1].rotation.x = Math.max(0, -Math.sin(w)) * 0.9; inner.rotation.z += Math.sin(w) * 0.08; }
  else { U.arms[0].rotation.x *= 1 - follow; U.arms[1].rotation.x *= 1 - follow; }
  if (stun && !faint) { inner.rotation.z = Math.sin(t * 20) * 0.12; U.head.rotation.x = 0.6; }
  // обморок: глаза-крестики, звёздочки, голова свесилась набок
  for (const x of U.xEyes) x.visible = faint;
  U.stars.visible = faint;
  if (faint) {
    const k = clamp((t - h.faintT) * 3, 0, 1);
    U.head.rotation.x = 0.75 * k; U.head.rotation.z = Math.sin(t * 1.6 + h.jit) * 0.35 * k;
    inner.rotation.z = Math.sin(t * 1.6 + h.jit) * 0.12 * k; inner.rotation.x = -0.25 * k;
    U.stars.rotation.y += dt * 4; U.stars.position.y = 0.85 + Math.sin(t * 5) * 0.04;
    U.arms[0].rotation.x = U.arms[1].rotation.x = -0.3 * k;
  } else { U.head.rotation.z = -turn * 0.23 + breath * 0.02; if (Math.abs(inner.rotation.x) > 0.001 && R.status !== 1) inner.rotation.x *= 1 - follow; }
  U.head.rotation.y = faint ? 0 : -turn * 0.29 + Math.sin(t * 0.83 + h.jit) * 0.07;
  h.blink -= dt;
  if (h.blink <= 0) h.blink = 3.7 + Math.sin(t * 0.7 + h.jit) * 1.35;
  const blink = faint ? 0 : Math.max(0, 1 - Math.abs(h.blink - 0.09) / 0.09);
  const gaze = turn * 0.44 + Math.sin(t * 0.78 + h.jit) * 0.10;
  for (let i = 0; i < 2; i++) {
    const side = i * 2 - 1, eye = U.eyes[i], brow = U.brows[i], ear = U.ears[i];
    eye.visible = !U.masked && blink < 0.84;
    eye.rotation.y = faint ? Math.PI : gaze - side * 0.055;
    eye.rotation.x = faint ? 0 : -0.13 - pant * 0.14;
    eye.scale.y = 0.106 * (1 - 0.92 * blink) * (1 - 0.16 * effort + 0.13 * pant);
    brow.position.y = 0.431 + pant * 0.021 - blink * 0.062 + side * (turn * 0.012 + breath * 0.008);
    brow.rotation.z = side * (-0.09 + effort * 0.48 - pant * 0.18) + turn * 0.20 + breath * 0.055;
    const flick = Math.max(0, Math.sin(t * 1.22 + h.jit + side) - 0.82) * Math.sin(t * 14 + side);
    ear.rotation.z = -side * (0.48 + effort * 0.27 + pant * 0.17 + flick * motion) + turn * 0.22;
    ear.rotation.x = 0.06 + effort * 0.25 - pant * 0.14;
    U.arms[i].rotation.z = side * (0.035 + Math.abs(turn) * 0.33) + turn * 0.16;
    U.legs[i].rotation.x = (faint ? 0 : Math.abs(turn) * (0.12 + side * turn * 0.11) + effort * 0.06);
  }
  // перегрев: попа краснеет и светится
  const glow = hot ? 1.45 + Math.sin(t * 5) * 0.14 * motion : Math.pow(heat, 2) * 1.4;
  U.cheekMat.emissiveIntensity = glow;
  U.cheekMat.emissive.setRGB(1, hot ? 0.35 : 0.22, 0.05);
  // взлёт при лопании
  if (R.status === 1) { const k = Math.min(1.6, t - rv.popAt); inner.position.y = Math.max(0, 6 * k - 6 * k * k) * 1.4; inner.rotation.x = k * 6; }

  // частицы газа из попы
  const butt = o.localToWorld(tmpV.copy(U.butt));
  const th = raftGroup.rotation.y + pos;
  const ox = Math.sin(th), oz = Math.cos(th);
  if (f) {
    const burst = (h.flags & 8) ? 1 : 0;
    const rate = [24, 45, 70][quality] * (burst ? 2.2 : 1);
    h.emitAcc += dt * rate;
    while (h.emitAcc > 1) {
      h.emitAcc -= 1;
      const sp = (6 + Math.random() * 3) * (burst ? 1.4 : 1), j = 0.9;
      gasFx.emit(butt.x + ox * 0.15, butt.y, butt.z + oz * 0.15,
        ox * sp + (Math.random() - 0.5) * j + R.vx * 0.5, 0.15 + Math.random() * 0.4, oz * sp + (Math.random() - 0.5) * j + R.vz * 0.5,
        0.5 + Math.random() * 0.3, (quality === 0 ? 2.6 : 3.4) + Math.random() * 1.2 + burst * 1.0, 1.9 + Math.random() * 1.0, gasColor(h.gas),
        { drag: 1.6, grav: 0.1, floor: raftGroup.position.y - 0.05, alpha: 0.72 + (1 - h.gas) * 0.25 });
    }
    // брызги за полсекунды до «щелчка»: капли, следы на воде, стенах и препятствиях
    if (spray) {
      h.sprayAcc = (h.sprayAcc || 0) + dt * 38;
      while (h.sprayAcc > 1) {
        h.sprayAcc -= 1;
        const sp = 4 + Math.random() * 5, a = (Math.random() - 0.5) * 0.9;
        const dx = Math.sin(th + a), dz = Math.cos(th + a);
        pooFx.emit(butt.x, butt.y, butt.z, dx * sp + R.vx * 0.4, 1 + Math.random() * 2.5, dz * sp + R.vz * 0.4, 0.13 + Math.random() * 0.1, 0.2, 0.55, pick(POO), { drag: 0.4, grav: -12, floor: raftGroup.position.y - 0.2 });
        if (Math.random() < 0.55) {
          const dist = 1.2 + Math.random() * 3.2, cur = isArena() ? { fx: 0, fz: 0 } : frame(tr, lastS);
          const lx = butt.x + dx * dist + R.vx * 0.15, lz = butt.z + dz * dist + R.vz * 0.15;
          traces.spawn(lx, isArena() ? 0 : yAt(lastS), lz, cur.fx * 1.2, cur.fz * 1.2, 0.18 + Math.random() * 0.28, 8 + Math.random() * 4);
          if (Math.random() < 0.45) splatAt(lx, lz, 0.25 + Math.random() * 0.35, P.T);
        }
      }
      if (h.id === myId && !h.warned) { h.warned = true; toast('Отпусти!', 'сейчас щёлкнет', 'sm poo', 700); }
    } else if (h.gas > PHYS.sprayGas + 0.05) h.warned = false;
    if (h.trail !== 'none') emitTrail(h, butt, ox, oz, R, t, dt, raftGroup.position.y);
    if (burst && !h.burstRing) { h.burstRing = true; rings.spawn(butt.x + ox * 1.2, raftGroup.position.y - 0.12, butt.z + oz * 1.2, 0.6, 3.2, 0.9, 0.8, 0xc9f53e); }
  } else { h.emitAcc = 0; h.burstRing = false; }
  // дым и огонь от перегрева
  if (heat > 0.72 || hot) {
    h.smokeAcc += dt * (hot ? 30 : 10 * (heat - 0.6) / 0.4);
    while (h.smokeAcc > 1) {
      h.smokeAcc -= 1;
      gasFx.emit(butt.x, butt.y + 0.1, butt.z, ox * 0.6 + (Math.random() - 0.5) * 0.4, 1.4 + Math.random(), oz * 0.6 + (Math.random() - 0.5) * 0.4, 0.2, 1.1, 1.3, pick(SMOKE), { drag: 1.2, grav: 0.6, alpha: 0.6 });
      if (hot) fireFx.emit(butt.x + (Math.random() - 0.5) * 0.3, butt.y, butt.z + (Math.random() - 0.5) * 0.3, ox * 0.8, 2 + Math.random() * 1.5, oz * 0.8, 0.5, 0.1, 0.45 + Math.random() * 0.2, pick(FIRE), { drag: 1, grav: 1.5 });
    }
  }
}

function segIcon(seat, n, color) {
  if (isCenter(seat) && !isArena()) return `<svg class="seg" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="none" stroke="rgba(26,34,56,.2)" stroke-width="5"/><circle cx="11" cy="11" r="5" fill="${color}" stroke="#1a2238" stroke-width="1.5"/></svg>`;
  const nr = isArena() ? n : rimCount(n);
  if (nr <= 1) return `<svg class="seg" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="none" stroke="${color}" stroke-width="5"/><circle cx="11" cy="11" r="10.5" fill="none" stroke="#1a2238" stroke-width="1.5"/></svg>`;
  const c = Math.PI + seat * 2 * Math.PI / nr, h = Math.PI / nr - 0.08;
  return `<svg class="seg" viewBox="0 0 22 22"><circle cx="11" cy="11" r="8" fill="none" stroke="rgba(26,34,56,.2)" stroke-width="5"/><path d="${segPath(11, 11, 5.5, 10.5, c - h, c + h)}" fill="${color}" stroke="#1a2238" stroke-width="1.5"/></svg>`;
}
let teamKey = '';
const tmpC = new THREE.Color();
// list: [{ id, seat, n, flags, color? }]
function renderTeam(list) {
  const key = list.map(h => h.id + ':' + h.seat + ':' + h.n + (h.color || '')).join(',') + '|' + (room ? room.players.map(p => p.name + p.skin).join() : '');
  const box = $('team');
  if (key !== teamKey) {
    teamKey = key;
    box.innerHTML = list.map(h => {
      const p = room && room.players.find(q => q.id === h.id), col = SKINS[p ? p.skin : 0].css;
      return `<div class="mate ${h.id === myId ? 'me' : ''}" data-id="${h.id}" ${h.color ? `style="border-color:${h.color}"` : ''}><div class="top">${segIcon(h.seat, h.n, col)}<span>${esc(p ? p.name : '?')}</span><span class="st"></span></div>
        <div class="bars"><div class="gasbar"><i></i></div><div class="heat"><i></i></div></div></div>`;
    }).join('');
  }
  for (const it of list) {
    const el = box.querySelector(`[data-id="${it.id}"]`); if (!el) continue;
    const hh = hippos.get(it.id), fl = it.flags, gas = hh ? hh.gas : 1, heat = hh ? hh.heat : 0;
    const gi = el.querySelector('.gasbar i'); gi.style.width = (gas * 100).toFixed(0) + '%'; gi.style.background = '#' + gasColor(Math.max(0, gas), tmpC).getHexString();
    el.classList.toggle('spray', !!(fl & 16));
    el.querySelector('.heat i').style.width = (heat * 100).toFixed(0) + '%';
    el.classList.toggle('farting', !!(hh && hh.farting));
    el.classList.toggle('empty', gas < 0.08);
    el.classList.toggle('hot', !!(fl & 2));
    el.classList.toggle('out', !!(fl & 1));
    el.classList.toggle('faint', !!(fl & 32));
    el.querySelector('.st').textContent = fl & 1 ? '🌊' : fl & 32 ? '😵' : fl & 2 ? '🔥' : fl & 4 ? '💩' : (hh && hh.farting ? '💨' : canShoot() ? `💩×${Math.floor(gas / PHYS.shotCost + 1e-6)}` : '');
  }
}

// ------------------------------------------------------------
renderShirtPicker();
$('emotes').innerHTML = EMOTES.map((t, i) => `<button data-n="${i}"><kbd>${i + 1}</kbd><span>${t}</span></button>`).join('');
$('emotes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) send({ t: 'emote', n: +b.dataset.n }); });
renderQualityButtons();
const DEBUG_VIEW = (new URLSearchParams(location.search).get('view') || '').split(':').map(Number);
if (DEBUG_VIEW.length !== 2 || !DEBUG_VIEW.every(isFinite)) DEBUG_VIEW.length = 0;
setLevel(DEBUG_VIEW.length ? DEBUG_VIEW[0] : 0, 7);
applyQuality();
connect();
if (DEBUG_VIEW.length) {
  // режим осмотра трассы: ?view=уровень:метр
  const loop = () => {
    requestAnimationFrame(loop);
    const f = frame(tr, DEBUG_VIEW[1]), fb = frame(tr, Math.max(0, DEBUG_VIEW[1] - 12)), t = nowS();
    if (tr.endless) { extendTrack(tr, DEBUG_VIEW[1] + 300); levelScene.ensure(DEBUG_VIEW[1] + 250); setTheme(tr.themeAt(DEBUG_VIEW[1]), true); }
    levelScene.update(t, 0.016, camera.position);
    camera.position.set(fb.x, fb.y + 11, fb.z); camera.lookAt(f.x, f.y, f.z);
    mainRV.group.position.set(f.x, f.y + 0.2, f.z); mainRV.group.rotation.y = f.h;
    sky.position.copy(camera.position);
    sun.position.set(f.x + 12, f.y + 26, f.z - 9); sun.target.position.set(f.x, f.y, f.z);
    renderer.render(scene, camera);
  };
  $('join').classList.add('hidden'); $('help').classList.add('hidden');
  loop();
}
if ('ontouchstart' in window) $('help').classList.add('hidden');
