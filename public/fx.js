// ============================================================
//  Эффекты: облака газа, пена, брызги, огонь, кольца на воде, лужи
// ============================================================
import * as THREE from 'three';

function puffTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const blobs = [[64, 66, 40], [44, 58, 26], [84, 56, 28], [56, 82, 26], [80, 82, 24], [64, 44, 24]];
  for (const [bx, by, r] of blobs) {
    const g = x.createRadialGradient(bx - r * 0.3, by - r * 0.35, r * 0.1, bx, by, r);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(225,225,225,0.95)'); g.addColorStop(1, 'rgba(190,190,190,0)');
    x.fillStyle = g; x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
  }
  // мягкий край
  x.globalCompositeOperation = 'destination-in';
  const m = x.createRadialGradient(64, 64, 30, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = m; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); return t;
}
function dotTexture() {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S); return new THREE.CanvasTexture(c);
}

const VERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aRot;
uniform float uScale;
varying float vAlpha; varying vec3 vColor; varying float vRot; varying float vDepth;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  vAlpha = aAlpha; vColor = aColor; vRot = aRot; vDepth = -mv.z;
}`;
const FRAG = `
uniform sampler2D uTex; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uShade;
varying float vAlpha; varying vec3 vColor; varying float vRot; varying float vDepth;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = mat2(c, -s, s, c) * p + 0.5;
  vec4 t = texture2D(uTex, p);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  vec3 col = vColor * mix(1.0, t.r, uShade);
  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vDepth));
  gl_FragColor = vec4(col, a);
}`;

// Система частиц-«билбордов» на CPU
export class Particles {
  constructor(max, { additive = false, shade = 0.55, tex = 'puff' } = {}) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.size0 = new Float32Array(max); this.size1 = new Float32Array(max);
    this.age = new Float32Array(max); this.life = new Float32Array(max);
    this.alpha0 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.rotV = new Float32Array(max); this.floor = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aColor', this.aColor); g.setAttribute('aRot', this.aRot);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: tex === 'dot' ? dotTexture() : puffTexture() }, uScale: { value: 600 }, uFog: { value: new THREE.Color(0xffffff) }, uFogNear: { value: 80 }, uFogFar: { value: 200 }, uShade: { value: shade } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.attributes = Object.values(g.attributes);
    this.geo = g;
  }
  setView(scale, fog) {
    this.mat.uniforms.uScale.value = scale;
    if (fog) { this.mat.uniforms.uFog.value.copy(fog.color); this.mat.uniforms.uFogNear.value = fog.near; this.mat.uniforms.uFogFar.value = fog.far; }
  }
  emit(x, y, z, vx, vy, vz, size0, size1, life, color, { alpha = 1, drag = 2.2, grav = 0.3, floor = -999 } = {}) {
    let i;
    if (this.count < this.max) i = this.count++;
    else { // заменяем самую старую по кругу
      this._rr = ((this._rr || 0) + 1) % this.max; i = this._rr;
    }
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.size0[i] = size0; this.size1[i] = size1; this.age[i] = 0; this.life[i] = life;
    this.alpha0[i] = alpha; this.drag[i] = drag; this.grav[i] = grav; this.floor[i] = floor;
    this.rotV[i] = (Math.random() - 0.5) * 1.5;
    this.aRot.array[i] = Math.random() * 6.28;
    const c = this.aColor.array; c[i3] = color.r; c[i3 + 1] = color.g; c[i3 + 2] = color.b;
  }
  update(dt) {
    const P = this.aPos.array, S = this.aSize.array, A = this.aAlpha.array, R = this.aRot.array, C = this.aColor.array;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {         // удаляем: переносим последнюю на место i
        const j = --n;
        if (i !== j) {
          const i3 = i * 3, j3 = j * 3;
          for (let k = 0; k < 3; k++) { this.pos[i3 + k] = this.pos[j3 + k]; this.vel[i3 + k] = this.vel[j3 + k]; C[i3 + k] = C[j3 + k]; }
          this.size0[i] = this.size0[j]; this.size1[i] = this.size1[j]; this.age[i] = this.age[j]; this.life[i] = this.life[j];
          this.alpha0[i] = this.alpha0[j]; this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j]; this.rotV[i] = this.rotV[j]; R[i] = R[j]; this.floor[i] = this.floor[j];
        }
        i--; continue;
      }
      const i3 = i * 3, k = this.age[i] / this.life[i];
      const dmp = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dmp; this.vel[i3 + 2] *= dmp;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dmp + this.grav[i] * dt;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < this.floor[i]) { this.pos[i3 + 1] = this.floor[i]; this.vel[i3 + 1] = 0; }
      P[i3] = this.pos[i3]; P[i3 + 1] = this.pos[i3 + 1]; P[i3 + 2] = this.pos[i3 + 2];
      const grow = 1 - (1 - k) * (1 - k);
      S[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * grow;
      A[i] = this.alpha0[i] * Math.min(1, k * 8) * (1 - k * k * k);
      R[i] += this.rotV[i] * dt;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (!n) return;
    for (const attribute of this.attributes) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, n * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
}

// Расходящиеся кольца на воде
export class Rings {
  constructor(scene, n = 40) {
    this.list = [];
    const geo = new THREE.RingGeometry(0.86, 1, 48);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 2; scene.add(m);
      this.list.push({ m, age: 1, life: 1, s0: 1, s1: 3, a0: 0.6 });
    }
    this.i = 0;
  }
  spawn(x, y, z, s0 = 1.6, s1 = 4.5, life = 1.6, a0 = 0.55, color = 0xffffff) {
    const r = this.list[this.i]; this.i = (this.i + 1) % this.list.length;
    Object.assign(r, { age: 0, life, s0, s1, a0 });
    r.m.position.set(x, y, z); r.m.material.color.setHex(color); r.m.visible = true;
  }
  update(dt) {
    for (const r of this.list) {
      if (!r.m.visible) continue;
      r.age += dt; const k = r.age / r.life;
      if (k >= 1) { r.m.visible = false; continue; }
      const s = r.s0 + (r.s1 - r.s0) * (1 - (1 - k) * (1 - k));
      r.m.scale.set(s, 1, s); r.m.material.opacity = r.a0 * (1 - k);
    }
  }
}

// Лужи после «щелчка»
function puddleTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * 6.28, r = 10 + Math.random() * 26;
    const px = 64 + Math.cos(a) * Math.random() * 26, py = 64 + Math.sin(a) * Math.random() * 26;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(110,70,30,0.95)'); g.addColorStop(0.7, 'rgba(95,60,25,0.8)'); g.addColorStop(1, 'rgba(90,55,20,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 6.28); x.fill();
  }
  return new THREE.CanvasTexture(c);
}
export class Puddles {
  constructor(scene) { this.scene = scene; this.items = new Map(); this.tex = puddleTexture(); this.tex.colorSpace = THREE.SRGBColorSpace; }
  add(pd, y, nowServer) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(pd.r * 1.15, 24), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6.28; m.position.set(pd.x, y + 0.04, pd.z); m.renderOrder = 1;
    this.scene.add(m);
    this.items.set(pd.id, { m, until: pd.until, born: nowServer });
  }
  update(T) {
    for (const [id, p] of this.items) {
      const left = p.until - T, k = Math.min(1, (T - p.born) * 3);
      p.m.material.opacity = Math.max(0, Math.min(0.9, left / 2)) * k;
      p.m.scale.setScalar(0.4 + 0.6 * k);
      if (left <= 0) this.remove(id, p);
    }
  }
  remove(id, p) {
    this.scene.remove(p.m);
    p.m.geometry.dispose();
    p.m.material.dispose();
    this.items.delete(id);
  }
  clear() { for (const [id, p] of this.items) this.remove(id, p); }
}

// Плавающие следы кала на воде (во время «брызг»): дрейфуют по течению и тают
export class Traces {
  constructor(scene, n = 160) {
    this.items = []; this.i = 0;
    const tex = puddleTexture(); tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.CircleGeometry(1, 10); geo.rotateX(-Math.PI / 2);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      m.visible = false; m.renderOrder = 1; scene.add(m);
      this.items.push({ m, age: 0, life: 1, vx: 0, vz: 0, s: 1 });
    }
  }
  spawn(x, y, z, vx, vz, s = 0.35, life = 9) {
    const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
    Object.assign(it, { age: 0, life, vx, vz, s });
    it.m.position.set(x, y + 0.035, z); it.m.rotation.y = Math.random() * 6.28; it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.age += dt; const k = it.age / it.life;
      if (k >= 1) { it.m.visible = false; continue; }
      it.m.position.x += it.vx * dt; it.m.position.z += it.vz * dt;
      const sc = it.s * (0.5 + Math.min(1, it.age * 4) * 0.5 + k * 0.6);
      it.m.scale.set(sc, 1, sc * 0.8);
      it.m.material.opacity = Math.min(0.95, (1 - k) * 1.6);
    }
  }
  clear() { for (const it of this.items) it.m.visible = false; }
}

// ------------------------------------------------------------
//  Грязь на окружении: вода, стены и препятствия остаются грязными до конца заезда
// ------------------------------------------------------------
import { splatTex } from './textures.js';
export class Stains {
  constructor(scene, max = 600) {
    this.scene = scene; this.max = max;
    const mk = (k) => new THREE.MeshBasicMaterial({ map: splatTex(k), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
    this.mats = [mk(0), mk(1), mk(2)];
    const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
    const wall = new THREE.PlaneGeometry(1, 1);
    this.water = this.inst(flat, this.mats[0]); this.wall = this.inst(wall, this.mats[1]);
    this.objs = []; this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.plane = new THREE.PlaneGeometry(1, 1);
  }
  inst(geo, mat) {
    const m = new THREE.InstancedMesh(geo, mat, this.max); m.count = 0; m.frustumCulled = false; m.renderOrder = 2;
    this.scene.add(m); return { m, n: 0 };
  }
  push(I, m4) { I.m.setMatrixAt(I.n % this.max, m4); I.n++; I.m.count = Math.min(I.n, this.max); I.m.instanceMatrix.needsUpdate = true; }
  addWater(x, y, z, size) {
    this.q.setFromEuler(this.e.set(0, Math.random() * 6.28, 0));
    this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(size, 1, size * (0.7 + Math.random() * 0.5)));
    this.push(this.water, this.m4);
  }
  addWall(x, y, z, heading, side, size) {      // плоскость смотрит к центру русла
    this.q.setFromEuler(this.e.set(0, heading + (side > 0 ? -Math.PI / 2 : Math.PI / 2), Math.random() * 6.28, 'YXZ'));
    this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(size, size, 1));
    this.push(this.wall, this.m4);
  }
  addOn(target, p, n, size) {                 // прилипает к препятствию и ездит вместе с ним
    const m = new THREE.Mesh(this.plane, this.mats[(Math.random() * 3) | 0]);
    m.position.copy(p).addScaledVector(n, 0.03); m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z); m.rotateZ(Math.random() * 6.28);
    m.scale.setScalar(size); m.renderOrder = 2;
    this.scene.add(m); target.attach(m);
    this.objs.push(m);
    if (this.objs.length > 120) { const o = this.objs.shift(); o.parent && o.parent.remove(o); }
  }
  get total() { return this.water.m.count + this.wall.m.count + this.objs.length; }
  clear() {
    this.water.n = this.wall.n = 0; this.water.m.count = this.wall.m.count = 0;
    for (const o of this.objs) o.parent && o.parent.remove(o);
    this.objs.length = 0;
  }
}
