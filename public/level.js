// ============================================================
//  Сцена трассы: строится кусками (для бесконечного режима — на ходу)
// ============================================================
import * as THREE from 'three';
import { THEMES, frame, obstacleState, obstacleShapes, yAt, crocPhase, geyserPhase, extendTrack } from './shared.js';
import {
  hex, woodTex, metalTex, rockTex, crocTex, rubberTex, mushTex, cliffTex, waterTex, waterNormal, foamTex, worldSurfaceTex,
  stripeTex, hazardTex, bannerTex, gateSignTex, swirlTex, arrowTex,
} from './textures.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });
const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

// ---------- небо (со звёздами ночью)
export function makeSky(theme) {
  const T = THEMES[theme] || THEMES.day;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(T.sky[0]) }, bot: { value: new THREE.Color(T.sky[1]) }, sunDir: { value: new THREE.Vector3(0.4, 0.75, -0.5).normalize() }, sunCol: { value: new THREE.Color(T.sun) }, stars: { value: T.stars ? 1 : 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; uniform float stars; varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y*1.4+0.15,0.,1.); vec3 c = mix(bot, top, pow(h,0.8));
        float s = max(dot(d, sunDir), 0.); c += sunCol * (pow(s, 400.)*1.2 + pow(s, 8.)*0.25);
        if (stars > 0.5 && d.y > 0.05) { vec2 g = floor(vec2(atan(d.z, d.x) * 180., d.y * 260.)); float r = h21(g); c += vec3(step(0.996, r)) * (0.6 + 0.4 * h21(g + 7.)); }
        gl_FragColor = vec4(c,1.); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
  m.renderOrder = -10; m.frustumCulled = false;
  m.userData.setTheme = (th) => { const X = THEMES[th] || THEMES.day; mat.uniforms.top.value.setHex(X.sky[0]); mat.uniforms.bot.value.setHex(X.sky[1]); mat.uniforms.sunCol.value.setHex(X.sun); mat.uniforms.stars.value = X.stars ? 1 : 0; };
  m.userData.uniforms = mat.uniforms;
  return m;
}

// ---------- материалы темы (кэш)
const themeMats = new Map();
function TM(theme) {
  if (themeMats.has(theme)) return themeMats.get(theme);
  const T = THEMES[theme] || THEMES.day;
  const wmap = waterTex(theme, 2, 1);
  const wnorm = waterNormal().clone(); wnorm.needsUpdate = true; wnorm.repeat.set(3, 3);
  const ftex = foamTex().clone(); ftex.needsUpdate = true;
  const masonry = T.brick || T.glow;
  const cliff = std(masonry ? 0xffffff : T.cliff[0], { map: masonry ? cliffTex(theme) : worldSurfaceTex('rock'), flatShading: true });
  const cap = std(T.grass, { map: worldSurfaceTex('bank', 2, 2), roughness: 0.95 });
  const capTint = { day: 0xe0ae75, sunset: 0xedaa78, sewer: 0x666960, lava: 0x69504b };
  const o = {
    T, wmap, wnorm, ftex,
    water: new THREE.MeshStandardMaterial({ map: wmap, normalMap: wnorm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: theme === 'ice' ? 0.05 : 0.12, metalness: 0.05, envMapIntensity: 0.9, side: THREE.DoubleSide }),
    foam: new THREE.MeshBasicMaterial({ map: ftex, transparent: true, depthWrite: false, opacity: theme === 'sewer' ? 0.5 : 0.85, side: THREE.DoubleSide }),
    slope: std(T.sand, { map: worldSurfaceTex('bank', 0.5, 1), roughness: 0.9, side: THREE.DoubleSide }),
    top: std(T.top, { map: worldSurfaceTex('bank', 5, 1), roughness: 0.95, side: THREE.DoubleSide }),
    fall: new THREE.MeshStandardMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.85, map: wmap, roughness: 0.2, side: THREE.DoubleSide }),
    bumper: std(theme === 'sewer' ? 0x6f8a52 : theme === 'ice' ? 0x9fd8f0 : 0x86d13b, { roughness: 0.4 }),
    spikeTube: std(0xffffff, { map: rubberTex().map, normalMap: rubberTex().normalMap, roughness: 0.35 }),
    cone: std(theme === 'ice' ? 0xe8f8ff : 0xfff0fa, { roughness: 0.3 }),
    mesa: [cliff, cliff, cap, cap, cliff, cliff],
    bankCap: capTint[theme] ? std(capTint[theme], { map: cap.map, roughness: 0.95 }) : cap,
    trunk: std(0x8a5a3a, { map: woodTex().map }),
    crown: std(T.grass, { flatShading: true }),
    tuft: std(T.grass),
    stone: std(0xffffff, { map: rockTex(0x7a7c86).map, normalMap: rockTex(0x7a7c86).normalMap, flatShading: true }),
    glow: T.glow ? new THREE.MeshBasicMaterial({ color: T.glow }) : null,
  };
  if (T.glow) { o.top.emissive = new THREE.Color(0x401000); o.mesa[0].emissive = new THREE.Color(0x200800); }
  themeMats.set(theme, o);
  return o;
}

function ribbon(i0, i1, fnA, fnB, mat, vScale = 4, flatUp = false) {
  const pos = [], uv = [], idx = [];
  for (let i = i0; i <= i1; i++) {
    const a = fnA(i), b = fnB(i);
    pos.push(...a, ...b); uv.push(0, i / vScale, 1, i / vScale);
    if (i > i0) { const k = (i - i0) * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const n = geo.attributes.normal; let up = 0; for (let i = 0; i < n.count; i++) up += n.getY(i);
  if (up < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } geo.setIndex(idx); geo.computeVertexNormals(); }
  if (flatUp) { for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); n.needsUpdate = true; }
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; return m;
}
function runs(a, b, pred) {
  const out = []; let st = -1;
  for (let i = a; i <= b; i++) { const ok = pred(i); if (ok && st < 0) st = i; if (!ok && st >= 0) { out.push([st, i - 1]); st = -1; } }
  if (st >= 0) out.push([st, b]); return out;
}

// Высота и радиус колец задают профиль берега. Размеры в метрах.
const BANKS = {
  day:    { rings: [[0, 1], [.33, .85], [.42, .61], [.82, .55], [1, .42]], radius: [4, 8], height: [4, 13], sides: 7 },
  sunset: { rings: [[0, 1], [.34, .63], [.66, .37], [.74, .62], [.93, .54], [1, .29]], radius: [3, 6], height: [6, 14], sides: 6 },
  ice:    { rings: [[0, 1], [.38, .87], [.82, .60], [1, .22]], radius: [4, 8], height: [5, 13], sides: 5 },
  swamp:  { rings: [[0, 1], [.42, .86], [.8, .64], [1, .36]], radius: [5, 9], height: [1.4, 4.2], sides: 7 },
  jungle: { rings: [[0, 1], [.24, .79], [.85, .62], [1, .40]], radius: [3.5, 7], height: [5, 14], sides: 7 },
  sewer:  { rings: [[0, 1], [.74, 1], [.76, 1.07], [.85, 1.07], [.86, .90], [1, .90]], radius: [4, 7], height: [4, 9], sides: 8 },
  lava:   { rings: [[0, 1], [.32, .87], [.37, .70], [.91, .66], [1, .53]], radius: [3, 6], height: [4, 12], sides: 6 },
  night:  { rings: [[0, 1], [.45, .70], [.64, .40], [.93, .25], [1, .10]], radius: [4, 8], height: [6, 14], sides: 5 },
};

function clearsRiver(tr, at, x, z, radius) {
  // В меандрах рядом оказываются далёкие по течению участки. Окно покрывает видимые чанки и запас догрузки.
  const end = Math.min(tr.N - 1, at + 900);
  for (let i = Math.max(0, at - 900); i <= end; i += 3) {
    const dx = x - tr.X[i], dz = z - tr.Z[i], margin = tr.W[i] / 2 + radius + 1.1;
    if (dx * dx + dz * dz < margin * margin) return false;
  }
  return true;
}

function riverCliffs(forms, theme, materials) {
  const spec = BANKS[theme] || BANKS.day, pos = [], uv = [], walls = [], caps = [];
  const vertex = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };
  const n = spec.sides;
  for (const f of forms) {
    let previous, ring;
    for (const [rise, radius] of spec.rings) {
      ring = [];
      for (let k = 0; k <= n; k++) {
        const a = f.angle + (k % n) * Math.PI * 2 / n;
        const r = f.rad * radius * f.outline[k % n];
        const x = f.x + Math.cos(a) * r + f.leanX * rise;
        const z = f.z + Math.sin(a) * r + f.leanZ * rise;
        const y = f.y + (f.height + f.crown[k % n]) * rise;
        ring.push(vertex(x, y, z, k * 3 / n, (y - f.y) / 7));
      }
      if (previous) for (let k = 0; k < n; k++) {
        walls.push(previous[k], ring[k], ring[k + 1], previous[k], ring[k + 1], previous[k + 1]);
      }
      previous = ring;
    }
    const center = vertex(f.x + f.leanX, f.y + f.height, f.z + f.leanZ, 0.5, 0.5);
    const edge = ring.slice(0, n).map(i => {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      return vertex(x, y, z, (x - f.x) / 5, (z - f.z) / 5);
    });
    for (let k = 0; k < n; k++) caps.push(center, edge[(k + 1) % n], edge[k]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(walls.concat(caps));
  geometry.addGroup(0, walls.length, 0); geometry.addGroup(walls.length, caps.length, 1);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, [materials.mesa[0], materials.bankCap]);
}

const bankPlantMaterial = lam(0xffffff, { vertexColors: true });
function bankPlantGeometry(theme, quality) {
  const positions = [], colors = [], color = new THREE.Color();
  const triangle = (a, b, c) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  // Кольца могут смещаться в стороны: так получаются изгибы стволов, ветви и асимметричные кроны.
  function layers(rows, tint, sides = 6) {
    if (quality === 0) sides = Math.min(5, sides);
    color.setHex(tint);
    let last, oldRadius;
    for (const [x, y, z, rx, rz = rx] of rows) {
      const ring = [];
      for (let i = 0; i < sides; i++) {
        const a = i * Math.PI * 2 / sides;
        ring.push([x + Math.cos(a) * rx, y, z + Math.sin(a) * rz]);
      }
      if (last) for (let i = 0; i < sides; i++) {
        const next = (i + 1) % sides;
        if (rx) triangle(last[i], ring[i], ring[next]);
        if (oldRadius) triangle(last[i], ring[next], last[next]);
      }
      last = ring; oldRadius = rx;
    }
    if (oldRadius) {
      const [x, y, z] = rows[rows.length - 1];
      for (let i = 0; i < sides; i++) triangle([x,y,z], last[(i + 1) % sides], last[i]);
    }
  }
  const wood = 0x71533e;
  const canopy = (x,y,z,w,h,tint) => layers([[x,y,z,w*.19],[x,y+h*.24,z,w,w*.79],[x+w*.08,y+h*.8,z,w*.76,w*.60],[x,y+h,z,w*.26]], tint, 7);
  if (theme === 'ice' || theme === 'night') {
    const snow = theme === 'ice';
    layers([[0,0,0,.21],[0,2.6,0,.11]], wood);
    for (let i = 0; i < 3; i++) {
      const y = .65 + i * 1.08, r = (1.53 - i*.35) * (snow ? 1 : .84);
      layers([[.07*i,y,0,r],[.07*i+.08,y+1.95,0,0]], snow ? 0x336f64 : 0x316359);
      if (snow) layers([[.07*i+.04,y+.65,0,r*.72],[.07*i+.08,y+2,0,0]], 0xe0f0e7);
    }
  } else if (theme === 'jungle') {
    layers([[0,0,0,.27],[.18,2.3,0,.20],[.62,4.65,.12,.14]], 0x966e45);
    for (let i = 0; i < 9; i++) {
      color.setHex([0x286742,0x468744,0x75a955][i%3]);
      const a = i*2.40, dx = Math.cos(a), dz = Math.sin(a), reach = 2.2 + (i%3)*.36;
      const leaf = (r,h,w) => [.62+dx*r-dz*w,h,.12+dz*r+dx*w];
      const base = leaf(0,4.58,0), mid = leaf(reach*.52,5.03,0), tip = leaf(reach,3.64+(i%2)*.40,0);
      const left = leaf(reach*.51,4.79,.43), right = leaf(reach*.51,4.79,-.43);
      triangle(base,left,mid); triangle(base,mid,right); triangle(mid,left,tip); triangle(mid,tip,right);
    }
  } else if (theme === 'sunset') {
    const green = 0x55866b;
    layers([[0,0,0,.36],[.05,2.9,0,.31],[.04,3.75,0,.23],[.04,3.94,0,.06]], green);
    layers([[0,1.08,0,.22],[.67,1.49,.06,.23],[.80,1.72,.08,.20],[.80,2.67,.08,.18],[.79,2.8,.08,.04]], green);
    layers([[0,1.82,0,.17],[-.48,2.11,-.12,.18],[-.58,2.35,-.12,.16],[-.58,3.16,-.12,.12]], 0x679279);
  } else if (theme === 'sewer') {
    layers([[0,0,0,.77],[0,.22,0,.77],[0,.22,0,.55],[0,3.25,0,.52]], 0x626f69, 8);
    layers([[0,2.82,0,.65],[0,3.01,0,.65]], 0xa47b4c, 8);
    layers([[0,3.22,0,.45],[0,3.40,0,.45],[0,3.40,0,.89],[0,3.57,0,.89],[0,3.89,0,.37]], 0x425956, 8);
  } else if (theme === 'lava') {
    layers([[0,0,0,.42],[-.12,1.2,0,.32],[.18,2.75,.15,.17],[.63,3.70,.09,.05]], 0x483b37, 5);
    layers([[0,1.16,0,.26],[-.90,2.0,.11,.18],[-1.24,2.92,.04,.05]], 0x5f493d, 5);
    layers([[.18,2.62,.15,.13],[.82,2.96,-.18,.07],[1.03,3.38,-.23,.025]], 0x714f3d, 5);
  } else {
    const willow = theme === 'swamp';
    layers([[0,0,0,willow ? .58 : .34],[.16,1.5,0,.24],[-.09,2.45,.06,.17],[-.77,3.18,.01,.08]], wood);
    layers([[.15,1.53,0,.20],[.72,2.64,.03,.12],[1.22,2.97,.09,.06]], wood);
    if (willow) {
      canopy(-.68,2.49,0,1.35,1.15,0x688451); canopy(.74,2.55,.06,1.48,1.16,0x8c9f55);
      for (let i=0;i<5;i++) { const a=i*2.40, x=Math.cos(a)*1.5, z=Math.sin(a)*.94; layers([[x,1.07+(i%2)*.39,z,.06],[x,2.86,z,.51],[x,3.40,z,.22]],0x738a4f,5); }
    } else {
      canopy(-.82,2.74,0,1.60,.94,0x507c57); canopy(.98,2.57,.05,1.35,.78,0x8b9e60);
      canopy(.12,3.33,.23,1.26,.74,0x749665);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function pennantGeometry(span) {
  const positions = [], colors = [], indices = [];
  const palette = [0xe36c50, 0xf1b544, 0xffedc4, 0x258a80].map(c => new THREE.Color(c));
  const cord = new THREE.Color(0x765436);
  const vertex = (x, y, z, color) => {
    colors.push(color.r, color.g, color.b);
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const height = x => 4.96 + 0.44 * (2 * x / span) ** 2;
  const count = Math.max(2, Math.floor(span / 0.9)), step = span / count;
  for (let i = 0; i < count; i++) {
    const x = -span / 2 + i * step, next = x + step, mid = (x + next) / 2;
    const first = vertex(x, height(x), 0, cord);
    vertex(next, height(next), 0, cord);
    vertex(next, height(next) + 0.055, 0, cord);
    vertex(x, height(x) + 0.055, 0, cord);
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    const color = palette[i % palette.length], left = x + 0.13 * step, right = next - 0.13 * step;
    const flag = vertex(left, height(left), 0, color);
    vertex(right, height(right), 0, color);
    vertex(mid + 0.07, height(mid) - 0.49, 0.09 * Math.cos(i), color);
    indices.push(flag, flag + 1, flag + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function releaseArch(arch) {
  arch.g.removeFromParent();
  for (const part of arch.g.children) {
    if (part.isInstancedMesh) part.dispose();
    part.geometry.dispose();
    part.material.map?.dispose();
    part.material.dispose();
  }
}

function releaseGeometry(part) {
  if (part.isInstancedMesh) part.dispose();
  if (part.geometry) part.geometry.dispose();
}

// ------------------------------------------------------------
export class LevelScene {
  constructor(tr, quality = 2) {
    this.tr = tr; this.L = tr.L; this.q = quality;
    this.root = new THREE.Group();
    this.built = 0; this.obsIdx = 0; this.cpIdx = 0; this.chunks = []; this.obs = []; this.arches = []; this.themes = new Set();
    this.P = (i, d, dy = 0) => { const h = tr.H[i]; return [tr.X[i] + Math.cos(h) * d, yAt(i) + dy, tr.Z[i] - Math.sin(h) * d]; };
    this.ensure(tr.endless ? 450 : tr.length);
  }
  ensure(uptoS) {
    const tr = this.tr, requested = Math.ceil(uptoS);
    const target = Math.min(tr.N - 1, tr.endless ? Math.ceil(requested / 150) * 150 : requested);
    while (this.built < target) {
      const a = this.built;
      let b = Math.min(target, (Math.floor(a / 150) + 1) * 150);
      if (tr.endless) {
        const theme = tr.themeAt(a + 1);
        for (let i = a + 2; i <= b; i++) {
          if (tr.themeAt(i) !== theme) { b = i - 1; break; }
        }
      }
      this.buildRange(a, b);
      this.built = b;
    }
    const L = this.L;
    while (this.obsIdx < L.obstacles.length && L.obstacles[this.obsIdx].s <= this.built) {
      const r = makeObstacle(L.obstacles[this.obsIdx], tr); if (r.mesh) this.root.add(r.mesh); this.obs.push(r); this.obsIdx++;
    }
    while (this.cpIdx < L.checkpoints.length && L.checkpoints[this.cpIdx] <= this.built) {
      this.arch(L.checkpoints[this.cpIdx], `ЧЕКПОИНТ ${this.cpIdx + 1}`, 'checkpoint'); this.cpIdx++;
    }
  }
  trim(behindS) {          // бесконечный режим: убираем то, что далеко позади
    for (const c of this.chunks) if (!c.gone && c.b < behindS - 40) { this.root.remove(c.g); c.g.traverse(releaseGeometry); c.gone = true; }
    for (const r of this.obs) if (!r.gone && r.o.s < behindS - 40) { releaseObstacle(r); r.gone = true; }
    for (const a of this.arches) if (!a.gone && a.s < behindS - 40) { releaseArch(a); a.gone = true; }
    this.chunks = this.chunks.filter(c => !c.gone); this.obs = this.obs.filter(r => !r.gone); this.arches = this.arches.filter(a => !a.gone);
  }
  buildRange(a, b) {
    const tr = this.tr, P = this.P, N = tr.N, g = new THREE.Group();
    const theme = tr.themeAt(a + 1), M = TM(theme), T = M.T;
    this.themes.add(theme);
    const gapW = (i, side) => ((side > 0 ? tr.gapL : tr.gapR)[i] ? 4.5 : 1.1);
    // вода и пена
    g.add(ribbon(a, b, i => P(i, tr.W[i] / 2 + gapW(i, 1), -0.05), i => P(i, -tr.W[i] / 2 - gapW(i, -1), -0.05), M.water, 7, true));
    for (const side of [1, -1]) {
      const gaps = side > 0 ? tr.gapL : tr.gapR;
      for (const [x0, x1] of runs(a, b, i => !gaps[i])) {
        if (x1 - x0 < 1) continue;
        const m = ribbon(x0, x1, i => P(i, side * (tr.W[i] / 2 + 0.1), 0.0), i => P(i, side * (tr.W[i] / 2 - 1.1), 0.0), M.foam, 4, true);
        m.renderOrder = 1; m.receiveShadow = false; g.add(m);
        g.add(ribbon(Math.max(0, x0 - 1), Math.min(N - 1, x1 + 1), i => P(i, side * (tr.W[i] / 2 + 0.75), -0.1), i => P(i, side * (tr.W[i] / 2 + 1.9), 1.4), M.slope));
        const outerBank = i => {
          const half = tr.W[i] / 2, p = P(i, side * (half + 19));
          const extra = clearsRiver(tr, i, p[0], p[2], 3.5) ? 22 : 16;
          return P(i, side * (half + extra), 1.7);
        };
        g.add(ribbon(Math.max(0, x0 - 1), Math.min(N - 1, x1 + 1), i => P(i, side * (tr.W[i] / 2 + 1.9), 1.4), outerBank, M.top));
      }
      for (const [x0, x1] of runs(a, b, i => gaps[i])) {
        g.add(ribbon(x0, x1, i => P(i, side * (tr.W[i] / 2 + 4.5), -0.05), i => P(i, side * (tr.W[i] / 2 + 6.5), -16), M.fall, 3));
        if (x1 - x0 > 6) {
          const mid = Math.round((x0 + x1) / 2);
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.7), lam(0xffffff, { map: bannerTex('ОБРЫВ!', '#e0261b'), side: THREE.DoubleSide }));
          sign.position.set(...P(mid, side * (tr.W[mid] / 2 + 3), 2.4)); sign.rotation.y = tr.H[mid] + Math.PI; g.add(sign);
          for (const k of [-1.4, 1.4]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4), lam(0x333333)); post.position.set(...P(Math.min(N - 1, Math.max(0, Math.round(mid + k))), side * (tr.W[mid] / 2 + 3), 1.2)); g.add(post); }
        }
      }
    }
    // бортики и шипастые валы
    const coneGeo = new THREE.ConeGeometry(0.26, 0.8, 10), coneData = [];
    for (const side of [1, -1]) {
      const gaps = side > 0 ? tr.gapL : tr.gapR, spikes = side > 0 ? tr.spikeL : tr.spikeR;
      for (const kind of [0, 1]) for (const [x0, x1] of runs(a, b, i => !gaps[i] && spikes[i] === kind)) {
        if (x1 - x0 < 1) continue;
        const pts = []; for (let i = x0; i <= x1; i++) pts.push(new THREE.Vector3(...P(i, side * (tr.W[i] / 2 + 0.4), 0.32)));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(4, (x1 - x0) * 2), kind ? 0.55 : 0.46, 14, false), kind ? M.spikeTube : M.bumper);
        tube.castShadow = true; tube.receiveShadow = true; g.add(tube);
        if (kind) for (let i = x0; i <= x1; i += 1.15) for (const el of [-0.75, 0, 0.75]) coneData.push({ i: Math.floor(i), side, el: el + (Math.floor(i) % 2) * 0.35 });
      }
    }
    if (coneData.length) {
      const inst = new THREE.InstancedMesh(coneGeo, M.cone, coneData.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
      coneData.forEach((c, k) => {
        const h = tr.H[c.i], inx = -c.side * Math.cos(h), inz = c.side * Math.sin(h);
        const dir = new THREE.Vector3(inx * Math.cos(c.el), Math.sin(c.el), inz * Math.cos(c.el)).normalize();
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        m4.compose(new THREE.Vector3(...P(c.i, c.side * (tr.W[c.i] / 2 + 0.4), 0.32)).addScaledVector(dir, 0.7), q, one); inst.setMatrixAt(k, m4);
      });
      inst.castShadow = true; g.add(inst);
    }
    // окружение
    let seed = (tr.idx || 0) * 977 + a * 31 + 13;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const mesas = [], trees = [], tufts = [], stones = [], glows = [], spec = BANKS[theme] || BANKS.day;
    const between = ([lo, hi]) => lo + (hi - lo) * rnd();
    for (const side of [1, -1]) {
      const gaps = side > 0 ? tr.gapL : tr.gapR;
      for (let i = a + 2 + Math.floor(rnd()*5); i < b; i += 8 + Math.floor(rnd()*8)) {
        if (gaps[i]) continue;
        const rad = between(spec.radius), height = between(spec.height);
        const setback = rad + 3.8 + rnd()*9;
        const [x,y,z] = P(i, side * (tr.W[i]/2 + setback), 0.55);
        if (!clearsRiver(tr, i, x, z, rad * 1.35)) continue;
        const regular = theme === 'sewer', tilt = regular ? 0 : theme === 'ice' || theme === 'night' ? .38 : .16;
        const outline = [], crown = [];
        for (let j=0; j<spec.sides; j++) {
          outline.push(regular ? 1 : .81 + rnd()*.28);
          crown.push(regular ? 0 : (rnd()-.5) * height * (theme === 'ice' ? .48 : .17));
        }
        mesas.push({x,y,z,rad,height,outline,crown,angle:rnd()*6.28,leanX:(rnd()-.5)*rad*tilt,leanZ:(rnd()-.5)*rad*tilt});
      }
      // Крупные силуэты остаются на низком качестве. Более дорогие режимы добавляют растительность между ними.
      const spacing = T.dense ? 8 : theme === 'lava' || theme === 'sewer' ? 20 : 13;
      for (let i=a+2+Math.floor(rnd()*5); i<b; i += spacing + Math.floor(rnd()*8)) {
        if (gaps[i]) continue;
        const scale = .75 + rnd() * .65, radius = (T.dense ? 3.5 : 2.45) * scale;
        const offset = Math.max(radius + 1.3, 3.5) + rnd()*4;
        const [x,y,z] = P(i, side * (tr.W[i]/2 + offset), 1.43);
        if (!clearsRiver(tr, i, x, z, radius)) continue;
        trees.push({x,y,z,s:scale,r:rnd()*6.28});
        if (this.q >= 1 && (T.dense || rnd() < .36)) {
          const j = Math.min(b, i + 3);
          if (gaps[j]) continue;
          const [xx,yy,zz] = P(j, side * (tr.W[j]/2 + offset + 2.9), 1.48);
          if (clearsRiver(tr, j, xx, zz, radius)) trees.push({x:xx,y:yy,z:zz,s:.57+rnd()*.46,r:rnd()*6.28});
        }
      }
    }
    for (let i = a; i < b; i += 5) for (const side of [1, -1]) {
      if ((side > 0 ? tr.gapL : tr.gapR)[i]) continue;
      if (this.q >= 1 && !T.brick && !T.glow && rnd() < (this.q >= 2 ? .7 : .3)) {
        const p = P(i, side * (tr.W[i]/2 + 2.5 + rnd()*6), 1.55);
        tufts.push({x:p[0], y:p[1], z:p[2], s:.65+rnd()*.65});
      }
      if (rnd() < (this.q ? .18 : .1)) { const p = P(i, side * (tr.W[i] / 2 + 4 + rnd() * 6), 1.6); stones.push({ x: p[0], y: p[1], z: p[2], s: 0.5 + rnd() * 1.2 }); }
      if (M.glow && rnd() < 0.5) { const p = P(i, side * (tr.W[i] / 2 + 2.2 + rnd() * 3), 1.62); glows.push({ x: p[0], y: p[1], z: p[2], s: 0.4 + rnd() * 0.8 }); }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3();
    if (mesas.length) {
      const mi = riverCliffs(mesas, theme, M);
      mi.receiveShadow = true; mi.castShadow = this.q >= 2; g.add(mi);
    }
    if (trees.length) {
      const plants = new THREE.InstancedMesh(bankPlantGeometry(theme, this.q), bankPlantMaterial, trees.length);
      trees.forEach((t, k) => {
        q.setFromEuler(e.set(0, t.r, 0));
        m4.compose(v.set(t.x, t.y, t.z), q, sv.setScalar(t.s)); plants.setMatrixAt(k, m4);
      });
      plants.castShadow = this.q >= 1; g.add(plants);
    }
    if (tufts.length) {
      const ti = new THREE.InstancedMesh(new THREE.ConeGeometry(0.25, 0.7, 5), M.tuft, tufts.length * 3); let k = 0;
      for (const t of tufts) for (let j = 0; j < 3; j++) { q.setFromEuler(e.set((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6)); m4.compose(v.set(t.x + (j - 1) * 0.2, t.y + 0.3 * t.s, t.z + (rnd() - 0.5) * 0.3), q, sv.set(t.s, t.s, t.s)); ti.setMatrixAt(k++, m4); }
      g.add(ti);
    }
    if (stones.length) {
      const si = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), M.mesa[0], stones.length);
      stones.forEach((s, k) => { q.setFromEuler(e.set(rnd(), rnd() * 3, rnd())); m4.compose(v.set(s.x, s.y, s.z), q, sv.set(s.s, s.s * 0.7, s.s)); si.setMatrixAt(k, m4); });
      si.castShadow = true; g.add(si);
    }
    if (glows.length) {    // лавовые трещины светятся
      const gi = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 7), M.glow, glows.length);
      glows.forEach((s, k) => { q.setFromEuler(e.set(-Math.PI / 2, 0, rnd() * 6)); m4.compose(v.set(s.x, s.y, s.z), q, sv.set(s.s, s.s * 0.4, 1)); gi.setMatrixAt(k, m4); });
      g.add(gi);
    }
    if (theme === 'sewer') {   // трубы из стен
      for (let i = a + 7; i < b; i += 23) for (const side of [1, -1]) {
        if ((side > 0 ? tr.gapL : tr.gapR)[i] || rnd() < 0.4) continue;
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3, 16, 1, true), std(0x6a6f75, { map: metalTex().map, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }));
        const p = P(i, side * (tr.W[i] / 2 + 2.6), 1.9); pipe.position.set(...p); pipe.rotation.z = Math.PI / 2; pipe.rotation.y = tr.H[i]; pipe.castShadow = true; g.add(pipe);
        const slime = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8), new THREE.MeshBasicMaterial({ color: 0x7fa83a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        slime.position.set(...P(i, side * (tr.W[i] / 2 + 1.2), 0.8)); slime.rotation.y = tr.H[i] + Math.PI / 2; g.add(slime);
      }
    }
    if (a === 0) this.arch(4, 'СТАРТ', 'start');
    if (!tr.endless && b >= tr.length - 6 && a < tr.length - 6) this.arch(tr.length - 6, 'ФИНИШ', 'finish');
    this.root.add(g);
    this.chunks.push({ a, b, g, theme });
  }
  arch(s, text, kind) {
    const tr = this.tr, i = Math.min(tr.N - 1, Math.round(s)), span = tr.W[i] + 3;
    const g = new THREE.Group(); g.position.set(...this.P(i, 0, 0)); g.rotation.y = tr.H[i];

    const ink = 0x235357, cream = 0xffedc4, gold = 0xf1b544;
    const paint = kind === 'checkpoint' ? 0xc8543f : kind === 'start' ? 0x23796e : ink;
    // Низ, окрашенные кольца и оголовки обеих стоек вместе с перекладиной.
    const sections = [
      [-0.2, 1.7, 0.32, ink], [1.7, 2.04, 0.32, cream], [2.04, 4.6, 0.27, paint],
      [4.6, 4.75, 0.29, gold], [4.75, 6.09, 0.26, paint], [6.09, 6.28, 0.31, cream],
      [6.28, 6.44, 0.27, gold],
    ];
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), lam(0xffffff, { transparent: true }), sections.length * 2 + 1);
    const transform = new THREE.Object3D(), color = new THREE.Color();
    let n = 0;
    for (const side of [-1, 1]) for (const [lo, hi, r, tint] of sections) {
      transform.position.set(side * span / 2, (lo + hi) / 2, 0);
      transform.scale.set(r, hi - lo, r); transform.updateMatrix();
      poles.setMatrixAt(n, transform.matrix); poles.setColorAt(n++, color.setHex(tint));
    }
    transform.position.set(0, 5.85, 0); transform.rotation.z = Math.PI / 2;
    transform.scale.set(0.10, span, 0.10); transform.updateMatrix();
    poles.setMatrixAt(n, transform.matrix); poles.setColorAt(n, color.setHex(ink));
    poles.castShadow = true;

    const width = Math.min(9.8, span - 1.5);
    const board = new THREE.BoxGeometry(width, 1.5, 0.32);
    // Торцы выбирают цвет канта из той же текстуры, лицевая и тыльная надписи читаются с обеих сторон.
    const uv = board.attributes.uv;
    for (const face of board.groups.slice(0, 4)) for (let k = face.start; k < face.start + face.count; k++) {
      uv.setXY(board.index.getX(k), 0.5, 0.99);
    }
    const sign = new THREE.Mesh(board, new THREE.MeshBasicMaterial({ map: gateSignTex(text, kind), transparent: true, toneMapped: false }));
    sign.position.set(0, 5.83, 0); sign.castShadow = true;
    const flags = new THREE.Mesh(pennantGeometry(span), new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, forceSinglePass: true, transparent: true, toneMapped: false,
    }));
    g.add(poles, sign, flags); this.root.add(g);
    this.arches.push({ g, mats: [poles.material, sign.material, flags.material], op: 1, s });
  }
  update(T, dt, camPos) {
    const L = this.L;
    for (const th of this.themes) { const M = TM(th); M.wmap.offset.y -= dt * L.current / 7; M.wnorm.offset.y -= dt * 0.05; M.wnorm.offset.x += dt * 0.012; M.ftex.offset.y -= dt * L.current / 4; }
    for (const o of this.obs) o.update(T, dt);
    if (camPos) for (const a of this.arches) {
      const d = Math.hypot(a.g.position.x - camPos.x, a.g.position.z - camPos.z);
      const want = d < 14 ? Math.max(0.12, (d - 6) / 8) : 1;
      if (Math.abs(want - a.op) > 0.01) { a.op += (want - a.op) * Math.min(1, dt * 8); for (const m of a.mats) { m.opacity = a.op; m.depthWrite = a.op > 0.95; } }
    }
  }
  dispose() {
    for (const arch of this.arches) releaseArch(arch);
    this.arches.length = 0;
    for (const obstacle of this.obs) releaseObstacle(obstacle);
    this.obs.length = 0;
    this.root.traverse(releaseGeometry);
  }
}

// ------------------------------------------------------------
//  Препятствия
// ------------------------------------------------------------
let OBM = null;
const sharedObstacleMaterials = new Set();
function obm() {
  if (OBM) return OBM;
  const W = woodTex(), Mt = metalTex(), R = rockTex(0x5d5f69), Bd = rockTex(0x8a7460), C = crocTex(), Rb = rubberTex();
  OBM = {
    rock: std(0xffffff, { map: R.map, normalMap: R.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.9 }),
    boulder: std(0xffffff, { map: Bd.map, normalMap: Bd.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.9 }),
    wood: std(0xffffff, { map: W.map, normalMap: W.normalMap, roughness: 0.75 }),
    woodDark: std(0x8a6a50, { map: W.map, normalMap: W.normalMap, roughness: 0.8 }),
    rubber: std(0xffffff, { map: Rb.map, normalMap: Rb.normalMap, roughness: 0.35 }),
    spikeWhite: std(0xfff0fa, { roughness: 0.3 }),
    hub: std(0x4fc3a1, { roughness: 0.45 }), gold: std(0xf2c14e, { roughness: 0.3, metalness: 0.5 }),
    metal: std(0xffffff, { map: Mt.map, normalMap: Mt.normalMap, metalness: 0.75, roughness: 0.32 }),
    darkMetal: std(0x6a707c, { map: Mt.map, normalMap: Mt.normalMap, metalness: 0.6, roughness: 0.4 }),
    croc: std(0xffffff, { map: C.map, normalMap: C.normalMap, roughness: 0.55 }), crocBelly: std(0xc9cf86, { roughness: 0.6 }),
    red: std(0xd8323a), teal: std(0x4fc3a1, { roughness: 0.5 }),
    mush: std(0xffffff, { map: mushTex(), roughness: 0.35 }),
  };
  for (const material of Object.values(OBM)) sharedObstacleMaterials.add(material);
  return OBM;
}
const coneSmall = new THREE.ConeGeometry(0.17, 0.5, 8);
function spikyCapsule(len, r) {
  const B = obm(), g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), B.rubber); body.rotation.x = Math.PI / 2; body.position.z = len / 2; body.castShadow = true; g.add(body);
  for (let z = 0.4; z <= len; z += 0.55) for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + z, c = new THREE.Mesh(coneSmall, B.spikeWhite), dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); c.position.set(dir.x * (r + 0.2), dir.y * (r + 0.2), z); g.add(c);
  }
  return g;
}
function spikeBall(r) {
  const B = obm(), g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 3), B.rubber); b.castShadow = true; g.add(b);
  const ico = new THREE.IcosahedronGeometry(1, 0).attributes.position, seen = new Set();
  for (let i = 0; i < ico.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(ico, i).normalize(), key = v.toArray().map(n => n.toFixed(2)).join(); if (seen.has(key)) continue; seen.add(key);
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), B.spikeWhite); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); c.position.copy(v).multiplyScalar(r + 0.2); g.add(c);
  }
  return g;
}
function lumpy(r, detail, seedS, mat) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, detail), mat);
  const pos = m.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const h = Math.sin(Math.round(x * 50) * 12.9898 + Math.round(y * 50) * 78.233 + Math.round(z * 50) * 37.719 + seedS) * 43758.5453; const k = 0.86 + (h - Math.floor(h)) * 0.28; pos.setXYZ(i, x * k, y * k, z * k); }
  m.geometry.computeVertexNormals(); m.castShadow = true; m.scale.setScalar(r); return m;
}

function makeObstacle(o, tr) {
  const B = obm(), T0 = obstacleState(o, tr, 0), res = { o, mesh: null, owned: new Set(), update() {} }, sh = [];
  switch (o.type) {
    case 'rock': {
      const g = new THREE.Group(), m = lumpy(1, 1, o.s * 13.7, B.rock);
      m.scale.set(o.r * 1.05, o.r * 1.15, o.r * 1.05); m.position.y = 0.3; m.rotation.set(0.3, o.s, 0.2); g.add(m);
      g.position.set(T0.x, T0.y, T0.z); res.mesh = g; break;
    }
    case 'buoy': {
      const g = new THREE.Group(), t = stripeTex('#ffffff', '#e8322a', 4);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.1, 1.3, 24), std(0xffffff, { map: t, roughness: 0.4 })); c.position.y = 0.4; c.castShadow = true; g.add(c);
      const top = new THREE.Mesh(new THREE.SphereGeometry(o.r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0xe8322a, { roughness: 0.4 })); top.position.y = 1.05; top.castShadow = true; g.add(top);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe14a })); lamp.position.y = 1.05 + o.r; g.add(lamp);
      g.position.set(T0.x, T0.y, T0.z); res.mesh = g;
      res.update = (T) => { g.position.y = T0.y + Math.sin(T * 2 + o.s) * 0.1; g.rotation.z = Math.sin(T * 1.7 + o.s) * 0.06; lamp.visible = Math.sin(T * 6 + o.s) > 0; };
      break;
    }
    case 'mush': {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.1, o.r * 1.25, 0.6, 24), B.teal); base.position.y = 0.1; base.castShadow = true; g.add(base);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(o.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), B.mush); cap.position.y = 0.4; cap.scale.y = 0.8; cap.castShadow = true; g.add(cap);
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * 6.28, el = k === 0 ? Math.PI / 2 : 0.45;
        const dir = k === 0 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), B.spikeWhite); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        c.position.set(dir.x * o.r * 0.95, 0.4 + dir.y * o.r * 0.8, dir.z * o.r * 0.95); g.add(c);
      }
      g.position.set(T0.x, T0.y, T0.z); res.mesh = g;
      res.update = (T) => { cap.scale.y = 0.8 + Math.sin(T * 3 + o.s) * 0.04; };
      break;
    }
    case 'ball': {
      const g = spikeBall(o.r); res.mesh = g;
      res.update = (T) => { const st = obstacleState(o, tr, T); g.position.set(st.x, st.y + 0.45, st.z); g.rotation.set(T * 1.3, T * 0.9, 0); };
      break;
    }
    case 'saw': {
      const g = new THREE.Group(), blade = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(o.r + 0.15, o.r + 0.15, 0.08, 36), B.metal); disc.rotation.x = Math.PI / 2; blade.add(disc);
      for (let k = 0; k < 18; k++) { const a = k / 18 * 6.28, t = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 4), B.metal); t.position.set(Math.cos(a) * (o.r + 0.28), Math.sin(a) * (o.r + 0.28), 0); t.rotation.z = a - Math.PI / 2 - 0.4; blade.add(t); }
      const hubm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.14, 16), B.red); hubm.rotation.x = Math.PI / 2; blade.add(hubm);
      blade.position.y = 0.35; blade.traverse(m => m.castShadow = true); g.add(blade);
      const f0 = frame(tr, o.s, 0), ht = hazardTex();
      const rail = new THREE.Mesh(new THREE.BoxGeometry(o.amp * 2 + 2.4, 0.18, 0.4), std(0xffffff, { map: ht })); rail.position.set(f0.x, f0.y, f0.z); rail.rotation.y = f0.h;
      res.mesh = new THREE.Group(); res.mesh.add(g, rail);
      res.update = (T) => { const st = obstacleState(o, tr, T); g.position.set(st.x, st.y, st.z); g.rotation.y = st.h; blade.rotation.z = -T * 14; };
      res.target = g;
      break;
    }
    case 'axe': {
      const f0 = frame(tr, o.s, 0), H = 7.5, grp = new THREE.Group(); grp.position.set(f0.x, f0.y, f0.z); grp.rotation.y = f0.h;
      const span = f0.w + 3.5;
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, H + 1, 0.5), B.woodDark); p.position.set(sx * span / 2, (H + 1) / 2, 0); p.castShadow = true; grp.add(p); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 0.5, 0.6), B.woodDark); beam.position.y = H + 0.6; beam.castShadow = true; grp.add(beam);
      const pend = new THREE.Group(); pend.position.y = H + 0.4; grp.add(pend);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, H - 0.2), B.darkMetal); rod.position.y = -(H - 0.2) / 2; pend.add(rod);
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.12, 28, 1, false, -0.9, 1.8), B.metal); blade.rotation.x = Math.PI / 2; blade.position.y = -H + 0.5; blade.castShadow = true; pend.add(blade);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.5), B.darkMetal); back.position.y = -H + 0.9; pend.add(back);
      res.mesh = grp;
      res.update = (T) => { const st = obstacleState(o, tr, T); pend.rotation.z = Math.asin(Math.max(-1, Math.min(1, st.dd / (H - 0.4)))); };
      break;
    }
    case 'croc': {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), B.croc); body.scale.set(0.9, 0.35, 1.6); body.position.set(0, -0.05, -1.2); body.castShadow = true; g.add(body);
      for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 4), B.croc); b.position.set(0, 0.3, -0.4 - k * 0.38); g.add(b); }
      const jawLow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 1.5), B.crocBelly); jawLow.position.set(0, 0.05, 0.65); g.add(jawLow);
      const upper = new THREE.Group(); upper.position.set(0, 0.2, -0.05); g.add(upper);
      const jawUp = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.32, 1.6), B.croc); jawUp.position.set(0, 0.12, 0.75); jawUp.castShadow = true; upper.add(jawUp);
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), std(0xf4f1a0)); eye.position.set(sx * 0.3, 0.38, 0.05); upper.add(eye);
        const pu = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.04), std(0x111111)); pu.position.set(sx * 0.3, 0.4, 0.21); upper.add(pu);
        for (let k = 0; k < 5; k++) {
          const t1 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), std(0xffffff)); t1.rotation.x = Math.PI; t1.position.set(sx * 0.4, -0.08, 0.2 + k * 0.28); upper.add(t1);
          const t2 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), std(0xffffff)); t2.position.set(sx * 0.38, 0.22, 0.15 + k * 0.28); g.add(t2);
        }
      }
      const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 1.1), std(0xd8576b)); tongue.position.set(0, 0.17, 0.6); g.add(tongue);
      const f0 = frame(tr, o.s, o.d);
      g.position.set(f0.x, f0.y, f0.z); g.rotation.y = f0.h + (o.d > 0 ? -Math.PI / 2 : Math.PI / 2); g.scale.setScalar(1.35);
      res.mesh = g;
      res.update = (T) => {
        const p = crocPhase(o, T);
        const open = p < 0.72 ? 0.15 + 0.85 * Math.min(1, p / 0.5) : p < 0.76 ? 1 - (p - 0.72) / 0.04 : p < 0.86 ? 0 : 0.15 * ((p - 0.86) / 0.14);
        upper.rotation.x = -open * 0.9; g.position.y = f0.y + Math.sin(T * 2 + o.s) * 0.05;
      };
      break;
    }
    case 'log': {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(o.r, o.len, 6, 16), B.wood); m.rotation.x = Math.PI / 2; m.castShadow = true; g.add(m);
      for (const z of [-o.len / 2, o.len / 2]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.72, 0.06, 6, 16), B.woodDark); ring.position.z = z; g.add(ring); }
      res.mesh = g;
      res.update = (T) => { sh.length = 0; obstacleShapes(o, tr, T, sh); const s = sh[0]; g.position.set((s.ax + s.bx) / 2, yAt(o.s) + 0.15, (s.az + s.bz) / 2); g.rotation.y = Math.atan2(s.bx - s.ax, s.bz - s.az); g.rotation.z = T * 1.5; };
      break;
    }
    case 'spin': {
      const g = new THREE.Group();
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 1.2, 24), B.hub); hub.position.y = 0.3; hub.castShadow = true; g.add(hub);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), B.gold); cap.position.y = 0.9; g.add(cap);
      for (let k = 0; k < o.arms; k++) {
        const arm = o.spike ? spikyCapsule(o.len - 0.8, o.r) : (() => { const a = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(o.r, o.len - 0.8, 6, 12), B.wood); m.rotation.x = Math.PI / 2; m.position.z = (o.len - 0.8) / 2; m.castShadow = true; a.add(m); return a; })();
        const holder = new THREE.Group(); holder.rotation.y = k * Math.PI * 2 / o.arms; arm.position.set(0, 0.35, 0.8); holder.add(arm); g.add(holder);
      }
      g.position.set(T0.x, T0.y, T0.z); res.mesh = g;
      res.update = (T) => { g.rotation.y = obstacleState(o, tr, T).a; };
      break;
    }
    case 'arc': {
      const g = new THREE.Group();
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.4, 16), B.teal); pillar.position.y = 0.8; pillar.castShadow = true; g.add(pillar);
      const rot = new THREE.Group(); rot.position.y = 0.45; g.add(rot);
      const tor = new THREE.Mesh(new THREE.TorusGeometry(o.R, o.r + 0.05, 12, 44, o.span), B.rubber); tor.rotation.x = -Math.PI / 2; tor.castShadow = true;
      const tg = new THREE.Group(); tg.add(tor); tg.rotation.y = -o.span / 2 - Math.PI / 2; rot.add(tg);
      for (let k = 0; k <= 8; k++) {
        const a = -o.span / 2 + o.span * k / 8;
        for (const el of [0.6, -0.1]) for (const sgn of [1, -1]) {
          const dir = new THREE.Vector3(Math.sin(a) * sgn, el, Math.cos(a) * sgn).normalize();
          const c = new THREE.Mesh(coneSmall, B.spikeWhite); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          c.position.set(Math.sin(a) * (o.R + 0.4 * sgn), 0.1 + el * 0.4, Math.cos(a) * (o.R + 0.4 * sgn)); rot.add(c);
        }
      }
      const armm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, o.R), B.darkMetal); armm.position.set(0, 0.45, o.R / 2); rot.add(armm);
      g.position.set(T0.x, T0.y, T0.z); res.mesh = g;
      res.update = (T) => { rot.rotation.y = obstacleState(o, tr, T).a; };
      break;
    }
    case 'door': {
      const g = new THREE.Group();
      const mat = o.spike ? std(0x4a505c, { map: metalTex().map, normalMap: metalTex().normalMap, metalness: 0.6, roughness: 0.4 }) : std(0xffffff, { map: hazardTex() });
      const parts = [0, 1].map(() => { const pg = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); b.castShadow = true; pg.add(b); g.add(pg); return { pg, b, spikes: [] }; });
      if (o.spike) for (const p of parts) for (let k = 0; k < 10; k++) { const c = new THREE.Mesh(coneSmall, B.spikeWhite); p.pg.add(c); p.spikes.push(c); }
      res.mesh = g;
      const place = (p, s) => {
        const L = Math.hypot(s.bx - s.ax, s.bz - s.az) + s.r * 2;
        p.b.scale.set(1.2, 1.8, Math.max(0.01, L)); p.pg.position.set((s.ax + s.bx) / 2, yAt(o.s) + 0.6, (s.az + s.bz) / 2); p.pg.rotation.y = Math.atan2(s.bx - s.ax, s.bz - s.az);
        p.spikes.forEach((c, k) => { const z = -L / 2 + (k + 0.5) * L / p.spikes.length; c.position.set(k % 2 ? 0.7 : -0.7, (k % 3 - 1) * 0.5, z); c.rotation.set(0, 0, k % 2 ? -Math.PI / 2 : Math.PI / 2); });
      };
      res.update = (T) => { sh.length = 0; obstacleShapes(o, tr, T, sh); place(parts[0], sh[0]); place(parts[1], sh[1]); };
      break;
    }
    case 'piston': {
      const g = new THREE.Group(), f0 = frame(tr, o.s, 0);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, o.wid + 0.6), B.darkMetal);
      const hp = frame(tr, o.s, o.side * (f0.w / 2 + 2.1)); housing.position.set(hp.x, hp.y + 1, hp.z); housing.rotation.y = f0.h; housing.castShadow = true; g.add(housing);
      const head = new THREE.Group(); g.add(head);
      const face = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.6, o.wid), std(0xffffff, { map: hazardTex() })); face.castShadow = true; head.add(face);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1, 12), B.metal); rod.rotation.z = Math.PI / 2; head.add(rod);
      res.mesh = g;
      res.update = (T) => {
        const st = obstacleState(o, tr, T), tip = o.side * (st.w / 2 + 1.2 - Math.max(0.01, st.ext)), p = frame(tr, o.s, tip + o.side * 0.1);
        head.position.set(p.x, p.y + 0.55, p.z); head.rotation.y = f0.h;
        const rl = Math.max(0.1, st.ext + 0.8); rod.scale.set(1, rl, 1); rod.position.set(o.side * (rl / 2 + 0.4), 0, 0);
      };
      break;
    }
    case 'boulder': {
      const g = new THREE.Group(), m = lumpy(o.r, 1, o.s * 7.1, B.boulder); g.add(m);
      res.mesh = g;
      res.update = (T) => { const st = obstacleState(o, tr, T); g.visible = st.active; g.position.set(st.x, st.y + o.r * 0.6, st.z); m.rotation.set(0, st.h, 0); m.rotateZ(-(st.dd || 0) / o.r); };
      break;
    }
    case 'whirl': {
      const m = new THREE.Mesh(new THREE.CircleGeometry(o.r + 0.8, 48), new THREE.MeshBasicMaterial({ map: swirlTex(), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(T0.x, T0.y + 0.03, T0.z); m.renderOrder = 1; res.mesh = m;
      res.update = (T) => { m.rotation.z = -T * 2.5 * o.str; };
      break;
    }
    case 'boost': {
      const t = arrowTex(); t.repeat.set(1, o.len / 2.5);
      res.owned.add(t); // Собственный рисунок с независимым смещением для каждой полосы.
      const m = new THREE.Mesh(new THREE.PlaneGeometry(o.wid, o.len), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      m.rotation.order = 'YXZ'; m.rotation.y = T0.h + Math.PI; m.rotation.x = -Math.PI / 2; m.position.set(T0.x, T0.y + 0.04, T0.z); m.renderOrder = 1; res.mesh = m;
      res.update = (T, dt) => { t.offset.y -= dt * 1.5; };
      break;
    }
    case 'geyser': {     // гейзер: камни по кругу, бурление, столб воды
      const g = new THREE.Group();
      for (let k = 0; k < 9; k++) { const a = k / 9 * 6.28, s = lumpy(0.35 + (k % 3) * 0.1, 0, k * 3.3 + o.s, B.rock); s.position.set(Math.cos(a) * (o.r + 0.2), 0, Math.sin(a) * (o.r + 0.2)); g.add(s); }
      const disk = new THREE.Mesh(new THREE.CircleGeometry(o.r, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false })); disk.rotation.x = -Math.PI / 2; disk.position.y = 0.04; disk.renderOrder = 1; g.add(disk);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.55, o.r * 0.8, 1, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.75, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
      col.position.y = 0.5; col.visible = false; g.add(col);
      const capm = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.7, 16, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.9 })); capm.visible = false; g.add(capm);
      g.position.set(T0.x, T0.y, T0.z); res.mesh = g;
      res.update = (T) => {
        const p = geyserPhase(o, T);
        const warn = p > 0.62 && p < 0.8, erupt = p >= 0.8 && p < 0.93;
        disk.material.opacity = warn ? 0.35 + Math.sin(T * 30) * 0.2 : erupt ? 0.8 : 0.18;
        disk.scale.setScalar(warn ? 1 + Math.sin(T * 22) * 0.06 : 1);
        const hgt = erupt ? 9 * Math.sin(Math.PI * (p - 0.8) / 0.13) : 0;
        col.visible = capm.visible = hgt > 0.2;
        col.scale.set(1, hgt, 1); col.position.y = hgt / 2; capm.position.y = hgt; capm.scale.setScalar(1 + Math.sin(T * 20) * 0.1);
      };
      res.erupting = () => { const p = geyserPhase(o, performance.now() / 1000); return p >= 0.8 && p < 0.93; };
      break;
    }
  }
  // Позже к мешу прикрепляются кляксы из общего пула. Фиксируем только то, что создала фабрика.
  res.mesh?.traverse(part => {
    if (part.geometry && part.geometry !== coneSmall) res.owned.add(part.geometry);
    if (part.material && !sharedObstacleMaterials.has(part.material)) res.owned.add(part.material);
  });
  if (!res.target) res.target = res.mesh;
  return res;
}

function releaseObstacle(obstacle) {
  obstacle.mesh?.removeFromParent();
  for (const resource of obstacle.owned) resource.dispose();
  obstacle.owned.clear();
}

// ------------------------------------------------------------
//  Прогрев: заранее создаём всё, что может впервые появиться посреди заезда
//  (новая местность и новые препятствия бесконечного режима), чтобы шейдеры
//  и текстуры подготовились при загрузке, а не во время игры.
// ------------------------------------------------------------
export function warmupKit(tr) {
  const kit = new THREE.Group(), box = new THREE.BoxGeometry(1, 1, 1);
  const themes = tr.endless ? Object.keys(THEMES) : [tr.themeAt(3)];
  const inst = (mat) => { const m = new THREE.InstancedMesh(box, mat, 1); m.setMatrixAt(0, new THREE.Matrix4()); return m; };
  for (const th of themes) {
    const M = TM(th);
    for (const k of ['water', 'foam', 'slope', 'top', 'fall', 'bumper', 'spikeTube']) kit.add(new THREE.Mesh(box, M[k]));
    for (const k of ['cone', 'trunk', 'crown', 'tuft', 'stone']) kit.add(inst(M[k]));
    if (M.glow) kit.add(inst(M.glow));
    kit.add(new THREE.InstancedMesh(box, M.mesa, 1));
  }
  if (tr.endless) {
    extendTrack(tr, 2600);                // к 2.6 км встречаются все виды препятствий
    const seen = new Set();
    for (const o of tr.L.obstacles) {
      const key = o.type + (o.spike ? '*' : '');
      if (seen.has(key)) continue; seen.add(key);
      const r = makeObstacle(o, tr); if (r.mesh) kit.add(r.mesh);
    }
  }
  return kit;
}
// для арены
const arenaThemeMats = new Map();
export function getThemeMats(theme) {
  if (arenaThemeMats.has(theme)) return arenaThemeMats.get(theme);
  const shared = TM(theme);
  // UV пруда занимают один квадрат, у трассы они уже повторяются через 7 м.
  const wmap = waterTex(theme, 7, 7), wnorm = waterNormal().clone();
  wnorm.repeat.set(12, 12);
  const water = shared.water.clone(); water.map = wmap; water.normalMap = wnorm;
  const slope = shared.slope.clone(); slope.map = worldSurfaceTex('bank', 42, 0.65);
  const top = shared.top.clone(); top.map = worldSurfaceTex('bank', 40, 40);
  const materials = { ...shared, water, wmap, wnorm, slope, top };
  arenaThemeMats.set(theme, materials);
  return materials;
}
export const obstacleMats = () => obm();
export { lumpy };
