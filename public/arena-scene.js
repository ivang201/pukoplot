// ============================================================
//  Сцена арены: круглый пруд, борт с шипами, препятствия,
//  золотой круг «Царя горы», ворота и мяч Пукобола, облака вони.
// ============================================================
import * as THREE from 'three';
import { ARENA_R, ARENA_MODES, KING_R, BALL_R, GOAL_HALF, arenaLayout, LAP_GATES, ISLAND_R, lapGateAng } from './arena.js';
import { getThemeMats, obstacleMats, lumpy } from './level.js';
import { stripeTex, swirlTex } from './textures.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });
const WALL_R = ARENA_R + 0.45;
const flagPoleMaterial = std(0xfff0cd);
const flagClothMaterial = std(0xffffff, { side: THREE.DoubleSide });

function cloudTex() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.28, r = 26 + (i % 3) * 6, px = 64 + Math.cos(a) * 22, py = 64 + Math.sin(a) * 22;
    const g = x.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 6.28); x.fill();
  }
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 50); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function paintedTexture(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const cream = '#fff1ce';
function ballTex() {
  const texture = paintedTexture(256, 128, ctx => {
    const panels = [cream, '#f05a2c', cream, '#195d9b', cream, '#ef7138', cream, '#178e93'];
    ctx.fillStyle = cream;
    ctx.fillRect(0, 0, 256, 128);
    // Начинаем за левым краем холста, чтобы витые панели сходились на стыке UV.
    for (let i = -2; i < panels.length; i++) {
      const left = i * 32, right = left + 32;
      ctx.beginPath();
      ctx.moveTo(left, 0);
      ctx.bezierCurveTo(left + 4, 40, left + 50, 88, left + 54, 128);
      ctx.lineTo(right + 54, 128);
      ctx.bezierCurveTo(right + 50, 88, right + 4, 40, right, 0);
      ctx.closePath();
      ctx.fillStyle = panels[(i + panels.length) % panels.length];
      ctx.fill();
      ctx.strokeStyle = '#dba573'; ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const y of [0, 118]) {
      ctx.fillStyle = '#20545a'; ctx.fillRect(0, y, 256, 10);
      ctx.fillStyle = cream; ctx.fillRect(0, y === 0 ? 0 : 120, 256, 8);
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function goalMaterials(color, bands) {
  const frame = paintedTexture(8, 128, ctx => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, 8, 128);
    ctx.fillStyle = cream;
    for (const start of [12, 100]) {
      if (bands === 1) ctx.fillRect(0, start + 3, 8, 12);
      else for (const offset of [0, 11]) ctx.fillRect(0, start + offset, 8, 7);
    }
  });
  const apron = paintedTexture(256, 64, ctx => {
    ctx.globalAlpha = 0.53; ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 64);
    ctx.globalAlpha = 1; ctx.fillRect(0, 54, 256, 10);
    ctx.strokeStyle = cream; ctx.lineWidth = 5;
    for (const x of [53, 128, 203]) {
      for (let k = 0; k < bands; k++) {
        const y = (bands === 1 ? 19 : 10) + k * 17;
        ctx.beginPath(); ctx.moveTo(x - 17, y); ctx.lineTo(x, y + 13); ctx.lineTo(x + 17, y); ctx.stroke();
      }
    }
  });
  return {
    frame: std(0xffffff, { map: frame, roughness: 0.55 }),
    apron: new THREE.MeshBasicMaterial({ map: apron, transparent: true, depthWrite: false }),
  };
}

// Эти рисунки общие для всех матчей и не зависят от зерна арены.
let ballMaterials;
function getBallMaterials() {
  return ballMaterials ??= {
    ball: std(0xffffff, { map: ballTex(), roughness: 0.52 }),
    net: new THREE.LineBasicMaterial({ color: 0xffedca, transparent: true, opacity: 0.77, depthWrite: false }),
    teams: [goalMaterials('#ff8a1f', 1), goalMaterials('#2b9be0', 2)],
  };
}

function goalNet(width) {
  const coords = [];
  const front = 0.1, back = 2.7, top = 3.2, rearTop = 2.55, half = width / 2;
  const segment = (x0, y0, z0, x1, y1, z1) => coords.push(x0, y0, z0, x1, y1, z1);
  for (let col = 0; col <= 15; col++) {
    const x = -half + col * width / 15;
    segment(x, 0, back, x, rearTop, back);
    segment(x, rearTop, back, x, top, front);
  }
  for (let row = 0; row <= 4; row++) {
    const t = row / 4;
    const z = front + t * (back - front), roofY = top + t * (rearTop - top);
    segment(-half, roofY, z, half, roofY, z);
    if (row < 4) segment(-half, rearTop * t, back, half, rearTop * t, back);
    for (const x of [-half, half]) {
      if (row < 4) segment(x, top * t, front, x, rearTop * t, back);
      if (row > 0 && row < 4) segment(x, 0, z, x, roofY, z);
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
}

// За воротами мяч уходит за борт на 2.5 м. Отодвигаем здесь и откос,
// и кромку пляжа, чтобы склон не закрывал мяч и заднюю стенку сетки.
function goalBankOffset(x, z) {
  return Math.sign(x) * 3.5 * (1 - THREE.MathUtils.smoothstep(Math.abs(z), 6, 10));
}
function makeGoalRecess(geometry, flat) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    // У кольца земли внешняя кромка остаётся на месте.
    if (Math.abs(x) > ARENA_R + 4) continue;
    p.setX(i, x + goalBankOffset(x, flat ? -p.getY(i) : p.getZ(i)));
  }
  if (!flat) geometry.computeVertexNormals();
}

export class ArenaScene {
  constructor(mode, seed, quality = 2) {
    this.mode = mode; this.M = ARENA_MODES[mode]; this.theme = this.M.theme; this.L = arenaLayout(mode, seed);
    const TM = getThemeMats(this.theme), B = obstacleMats();
    this.TM = TM;
    const root = this.root = new THREE.Group();
    // вода
    const water = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R + 3, 72), TM.water); water.rotation.x = -Math.PI / 2; water.position.y = -0.05; water.receiveShadow = true; root.add(water);
    const foam = new THREE.Mesh(new THREE.RingGeometry(ARENA_R - 1.2, ARENA_R + 0.1, 96), TM.foam); foam.rotation.x = -Math.PI / 2; foam.position.y = 0; foam.renderOrder = 1; root.add(foam);
    // берег и земля вокруг
    const slope = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R + 3.2, ARENA_R + 1.0, 1.5, 96, 1, true), TM.slope); slope.position.y = 0.7; root.add(slope);
    const ground = new THREE.Mesh(new THREE.RingGeometry(ARENA_R + 3.1, ARENA_R + 70, 96, 1), TM.top); ground.rotation.x = -Math.PI / 2; ground.position.y = 1.45; ground.receiveShadow = true; root.add(ground);
    if (mode === 'ball') {
      makeGoalRecess(water.geometry, true);
      makeGoalRecess(slope.geometry, false);
      makeGoalRecess(ground.geometry, true);
    }
    // борт: мягкий вал, на нём шипастые участки; у Пукобола — разрывы под ворота
    const goals = mode === 'ball' ? [-Math.PI / 2, Math.PI / 2] : [];
    const arcs = [];
    if (goals.length) { arcs.push([goals[0] + GOAL_HALF, goals[1] - GOAL_HALF], [goals[1] + GOAL_HALF, goals[0] + Math.PI * 2 - GOAL_HALF]); }
    else if (!this.L.allSpikes) arcs.push([0, Math.PI * 2]);
    for (const [a0, a1] of arcs) {
      const g = new THREE.TorusGeometry(WALL_R, 0.5, 14, 120, a1 - a0); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, TM.bumper); m.rotation.y = a0 - Math.PI / 2; m.position.y = 0.3; m.castShadow = true; m.receiveShadow = true; root.add(m);
    }
    const coneData = [];
    for (const sp of this.L.spikes) {
      const g = new THREE.TorusGeometry(WALL_R, 0.56, 14, 30, sp.a1 - sp.a0); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, TM.spikeTube); m.rotation.y = sp.a0 - Math.PI / 2; m.position.y = 0.3; m.castShadow = true; root.add(m);
      for (let a = sp.a0; a <= sp.a1; a += 0.045) for (const el of [-0.7, 0, 0.7]) coneData.push({ a, el });
    }
    if (coneData.length) {
      const inst = new THREE.InstancedMesh(new THREE.ConeGeometry(0.26, 0.8, 10), TM.cone, coneData.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
      coneData.forEach((c, k) => {
        const inx = -Math.sin(c.a), inz = -Math.cos(c.a), dir = new THREE.Vector3(inx * Math.cos(c.el), Math.sin(c.el), inz * Math.cos(c.el)).normalize();
        q.setFromUnitVectors(up, dir); m4.compose(new THREE.Vector3(Math.sin(c.a) * WALL_R, 0.3, Math.cos(c.a) * WALL_R).addScaledVector(dir, 0.72), q, one); inst.setMatrixAt(k, m4);
      });
      inst.castShadow = true; root.add(inst);
    }
    // «Последний на плаву»: сплошной колючий забор, который сжимается (собран из кусочков, чтобы двигать)
    if (this.L.allSpikes) {
      this.ringN = 150; this.coneN = 150 * 3;
      this.ringSeg = new THREE.InstancedMesh(new THREE.SphereGeometry(0.56, 10, 8), TM.spikeTube, this.ringN);
      this.ringCones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.26, 0.8, 8), TM.cone, this.coneN);
      this.ringSeg.castShadow = this.ringCones.castShadow = true; this.ringSeg.frustumCulled = this.ringCones.frustumCulled = false;
      root.add(this.ringSeg, this.ringCones); this.ringR = -1; this.setRing(ARENA_R);
    }
    // грязь на воде: холст поверх пруда — следы выстрелов и брызг остаются до конца раунда
    const MS = 1024; this.messCv = document.createElement('canvas'); this.messCv.width = this.messCv.height = MS;
    this.messCtx = this.messCv.getContext('2d'); this.messScale = MS / ((ARENA_R + 1) * 2);
    this.messTex = new THREE.CanvasTexture(this.messCv); this.messTex.colorSpace = THREE.SRGBColorSpace;
    const mess = new THREE.Mesh(new THREE.PlaneGeometry((ARENA_R + 1) * 2, (ARENA_R + 1) * 2), new THREE.MeshBasicMaterial({ map: this.messTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mess.rotation.x = -Math.PI / 2; mess.position.y = 0.015; mess.renderOrder = 2; root.add(mess);
    this.messDirty = false;
    // скалы и деревья вокруг
    let sd = (seed * 31 + 7) | 0; const rnd = () => { sd = (sd * 16807) % 2147483647; if (sd <= 0) sd += 2147483646; return sd / 2147483647; };
    const mesas = [], trees = [];
    for (let i = 0; i < 46; i++) { const a = i / 46 * Math.PI * 2 + rnd() * 0.1, r = ARENA_R + 11 + rnd() * 18, h = 4 + rnd() * 14; mesas.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, y: 1.45 + h / 2 - 1, sx: 5 + rnd() * 7, sy: h, sz: 5 + rnd() * 7, ry: rnd() * 3 }); }
    for (let i = 0; i < (quality >= 1 ? 40 : 14); i++) { const a = rnd() * Math.PI * 2, r = ARENA_R + 4.5 + rnd() * 6; trees.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, s: 0.8 + rnd() * 0.7, r: rnd() * 6 }); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3();
    const mi = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), TM.mesa, mesas.length);
    mesas.forEach((r, k) => { q.setFromEuler(e.set(0, r.ry, 0)); m4.compose(v.set(r.x, r.y, r.z), q, sv.set(r.sx, r.sy, r.sz)); mi.setMatrixAt(k, m4); });
    mi.receiveShadow = true; root.add(mi);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6), TM.trunk, trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), TM.crown, trees.length);
    trees.forEach((t, k) => {
      const x = t.x + (mode === 'ball' ? goalBankOffset(t.x, t.z) : 0);
      q.setFromEuler(e.set(0, t.r, 0));
      m4.compose(v.set(x, 1.45 + 1.1 * t.s, t.z), q, sv.set(t.s, t.s, t.s)); trunk.setMatrixAt(k, m4);
      m4.compose(v.set(x, 1.45 + 2.5 * t.s, t.z), q, sv.set(1.3 * t.s, 1.1 * t.s, 1.3 * t.s)); crown.setMatrixAt(k, m4);
    });
    trunk.castShadow = crown.castShadow = true; root.add(trunk, crown);
    // флажки по кругу — арена всё-таки
    const flagCols = mode === 'ball' ? [0xf77d32, 0x2469a0] : [0xff5a3c, 0xffd23f, 0x3cc6ff, 0x8ee04a];
    const pennant = new THREE.BufferGeometry();
    pennant.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0.275, 0,  0.94, 0.19, 0.08,  0.7, -0.03, 0.06,  0.94, -0.27, 0.08,  0, -0.275, 0,
    ], 3));
    pennant.setIndex([0, 4, 2, 0, 2, 1, 2, 4, 3]); pennant.computeVertexNormals();
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), flagPoleMaterial, 24);
    const flags = new THREE.InstancedMesh(pennant, flagClothMaterial, 24), flagColor = new THREE.Color();
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, r = ARENA_R + 2.6, z = Math.cos(a) * r;
      let x = Math.sin(a) * r;
      if (mode === 'ball') x += goalBankOffset(x, z);
      poles.setMatrixAt(i, m4.makeTranslation(x, 3, z));
      flags.setMatrixAt(i, m4.makeRotationY(a + Math.PI / 2).setPosition(x, 4.25, z));
      flags.setColorAt(i, flagColor.setHex(flagCols[i % flagCols.length]));
    }
    root.add(poles, flags);
    // препятствия
    for (const o of this.L.obstacles) {
      let m;
      if (o.kind === 'rock') { m = lumpy(1, 1, o.x * 7 + o.z, B.boulder); m.scale.set(o.r * 1.05, o.r * 1.15, o.r * 1.05); m.position.set(o.x, 0.3, o.z); }
      else if (o.kind === 'buoy') {
        m = new THREE.Group();
        const c = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.1, 1.3, 24), std(0xffffff, { map: stripeTex('#ffffff', '#e8322a', 4), roughness: 0.4 })); c.position.y = 0.4; c.castShadow = true; m.add(c);
        const top = new THREE.Mesh(new THREE.SphereGeometry(o.r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0xe8322a, { roughness: 0.4 })); top.position.y = 1.05; m.add(top);
        m.position.set(o.x, 0, o.z);
      } else {
        m = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.1, o.r * 1.25, 0.6, 24), B.teal); base.position.y = 0.1; m.add(base);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(o.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), B.mush); cap.position.y = 0.4; cap.scale.y = 0.8; cap.castShadow = true; m.add(cap);
        for (let k = 0; k < 9; k++) {
          const a = k / 8 * 6.28, el = k === 8 ? Math.PI / 2 : 0.45, dir = k === 8 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 8), B.spikeWhite); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); c.position.set(dir.x * o.r * 0.95, 0.4 + dir.y * o.r * 0.8, dir.z * o.r * 0.95); m.add(c);
        }
        m.position.set(o.x, 0, o.z);
      }
      m.traverse(c => { if (c.isMesh) c.castShadow = true; });
      root.add(m);
    }
    // Царь горы: золотой круг
    if (mode === 'king') {
      const ringM = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false });
      this.kingRing = new THREE.Mesh(new THREE.RingGeometry(KING_R - 0.35, KING_R, 72), ringM); this.kingRing.rotation.x = -Math.PI / 2; this.kingRing.position.y = 0.03; this.kingRing.renderOrder = 2; root.add(this.kingRing);
      this.kingDisc = new THREE.Mesh(new THREE.CircleGeometry(KING_R - 0.35, 72), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.12, depthWrite: false })); this.kingDisc.rotation.x = -Math.PI / 2; this.kingDisc.position.y = 0.02; this.kingDisc.renderOrder = 1; root.add(this.kingDisc);
      const crown = new THREE.Group();
      const gold = std(0xf2c14e, { metalness: 0.7, roughness: 0.25, emissive: new THREE.Color(0x5a3a00) });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.4, 24, 1, true), gold); band.material.side = THREE.DoubleSide; crown.add(band);
      for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28, c = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 6), gold); c.position.set(Math.sin(a) * 0.68, 0.4, Math.cos(a) * 0.68); crown.add(c); }
      crown.position.y = 6; this.crown = crown; root.add(crown);
    }
    // Кольцевая гонка: ворота — линии буйков от острова к берегу, флаги, номер
    if (mode === 'laps') {
      this.gates = [];
      const flagCols = [0xffffff, 0xff5a3c, 0xffd23f, 0x3cc6ff, 0x8ee04a, 0xb06cff];
      for (let i = 0; i < LAP_GATES; i++) {
        const a = lapGateAng(i), g = new THREE.Group(), col = flagCols[i];
        const bm = std(col, { roughness: 0.4 }), n = 9;
        for (let k = 0; k < n; k++) { const r = ISLAND_R + 1.2 + k * (ARENA_R - ISLAND_R - 2.2) / (n - 1); const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), k % 2 ? bm : std(0x1a2238)); b.position.set(Math.sin(a) * r, 0.12, Math.cos(a) * r); g.add(b); }
        for (const r of [ISLAND_R + 0.8, ARENA_R - 0.6]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), std(0xdddddd)); pole.position.set(Math.sin(a) * r, 1.6, Math.cos(a) * r); pole.castShadow = true; g.add(pole);
          const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshStandardMaterial({ color: i === 0 ? 0xffffff : col, map: i === 0 ? stripeTex('#ffffff', '#1a2238', 4) : null, side: THREE.DoubleSide })); fl.position.set(Math.sin(a) * r + Math.cos(a) * 0.55, 2.8, Math.cos(a) * r - Math.sin(a) * 0.55); fl.rotation.y = a + Math.PI / 2; g.add(fl);
        }
        const lineM = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.0, depthWrite: false });
        const line = new THREE.Mesh(new THREE.PlaneGeometry(0.9, ARENA_R - ISLAND_R - 1), lineM); line.rotation.x = -Math.PI / 2; line.rotation.z = -a;
        const mid = (ISLAND_R + ARENA_R) / 2; line.position.set(Math.sin(a) * mid, 0.04, Math.cos(a) * mid); line.renderOrder = 2; g.add(line);
        root.add(g); this.gates.push({ g, line });
      }
      this.nextGate = -1;
    }
    // события: водоворот
    this.swirl = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshBasicMaterial({ map: swirlTex(), transparent: true, opacity: 0, depthWrite: false, color: 0xbfe8ff }));
    this.swirl.rotation.x = -Math.PI / 2; this.swirl.position.y = 0.05; this.swirl.renderOrder = 2; root.add(this.swirl);
    // Пукобол: ворота и мяч
    if (mode === 'ball') {
      const materials = getBallMaterials(), w = Math.sin(GOAL_HALF) * WALL_R * 2;
      goals.forEach((a, i) => {
        const g = new THREE.Group(), team = materials.teams[i];
        const frame = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), team.frame, 3);
        for (let j = 0; j < 2; j++) {
          frame.setMatrixAt(j, m4.makeScale(0.22, 3.4, 0.22).setPosition((j - 0.5) * w, 1.5, 0));
        }
        q.setFromEuler(e.set(0, 0, Math.PI / 2));
        frame.setMatrixAt(2, m4.compose(v.set(0, 3.2, 0), q, sv.set(0.2, w, 0.2)));
        frame.castShadow = true;
        const net = new THREE.LineSegments(goalNet(w), materials.net);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(w, 3), team.apron);
        pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.03, -1.3); pad.renderOrder = 1;
        g.add(frame, net, pad);
        g.position.set(Math.sin(a) * WALL_R, 0, Math.cos(a) * WALL_R); g.rotation.y = a; root.add(g);
      });
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, quality ? 32 : 20, quality ? 20 : 12), materials.ball);
      this.ball.castShadow = true; this.ball.position.y = BALL_R * 0.6; root.add(this.ball);
      this.ballAxis = new THREE.Vector3();
    }
    // облака вони (опасные зоны): плоское пятно на воде + клубы
    this.cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex(), color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false });
    const cg = new THREE.PlaneGeometry(2, 2); cg.rotateX(-Math.PI / 2);
    this.clouds = new THREE.InstancedMesh(cg, this.cloudMat, 140); this.clouds.count = 0; this.clouds.frustumCulled = false; this.clouds.renderOrder = 3;
    this.clouds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(140 * 3), 3);
    root.add(this.clouds);
    this.tmpC = new THREE.Color();
  }
  setNextGate(i) {
    if (!this.gates) return;
    this.nextGate = i;
  }
  update(T, dt, sn, extra = 0) {
    const TM = this.TM;
    if (this.gates) this.gates.forEach((gt, i) => { gt.line.material.opacity = i === this.nextGate ? 0.45 + Math.sin(T * 6) * 0.2 : 0.08; });
    const ev = sn && sn.evt, whirl = ev && ev[0] === 'whirl';
    this.swirl.material.opacity += ((whirl ? 0.55 : 0) - this.swirl.material.opacity) * Math.min(1, dt * 2);
    this.swirl.rotation.z += dt * 1.6; this.swirl.visible = this.swirl.material.opacity > 0.01;
    if (sn && typeof sn.rad === 'number') this.setRing(sn.rad);
    this.flushMess();
    TM.wmap.offset.y -= dt * 0.05; TM.wnorm.offset.y -= dt * 0.04; TM.wnorm.offset.x += dt * 0.02; TM.ftex.offset.x += dt * 0.03;
    if (this.crown) { this.crown.rotation.y += dt; this.crown.position.y = 6 + Math.sin(T * 2) * 0.3; }
    if (this.kingRing && sn) {
      const kt = sn.kt ?? -1;
      this.kingRing.material.color.setHex(kt >= 0 ? 0x8ee04a : kt === -2 ? 0xff5a3c : 0xffd23f);
      this.kingDisc.material.opacity = 0.1 + (kt >= 0 ? 0.12 + Math.sin(T * 8) * 0.05 : 0);
      this.kingRing.scale.setScalar(1 + Math.sin(T * 3) * 0.015);
    }
    // облака: позиции из снимка, чуть вперёд по их скорости
    if (sn && sn.bl) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
      let n = 0;
      for (const b of sn.bl) {
        if (n >= 140) break;
        const [x, z, r, vx, vz, big, age] = b, k = Math.exp(-1.6 * extra);
        q.setFromEuler(e.set(0, (x * 3 + z) % 6.28, 0));
        m4.compose(v.set(x + vx * extra * k, 0.06 + n * 0.0005, z + vz * extra * k), q, s.set(r, 1, r));
        this.clouds.setMatrixAt(n, m4);
        const fade = 1 - age;
        this.tmpC.setRGB(0.62 + 0.18 * (1 - fade), (big ? 0.45 : 0.56) + 0.2 * (1 - fade), 0.2 + 0.35 * (1 - fade)); this.clouds.setColorAt(n, this.tmpC);
        n++;
      }
      this.clouds.count = n; this.clouds.instanceMatrix.needsUpdate = true; if (this.clouds.instanceColor) this.clouds.instanceColor.needsUpdate = true;
    }
  }
  setRing(r) {
    if (!this.ringSeg || Math.abs(r - this.ringR) < 0.01) return;
    this.ringR = r;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), dir = new THREE.Vector3();
    const R = r + 0.45;
    for (let i = 0; i < this.ringN; i++) {
      const a = i / this.ringN * Math.PI * 2;
      m4.compose(v.set(Math.sin(a) * R, 0.3, Math.cos(a) * R), q.identity(), one); this.ringSeg.setMatrixAt(i, m4);
      for (let k = 0; k < 3; k++) {
        const el = (k - 1) * 0.7, aa = a + (k === 1 ? Math.PI / this.ringN : 0);
        dir.set(-Math.sin(aa) * Math.cos(el), Math.sin(el), -Math.cos(aa) * Math.cos(el)).normalize();
        q.setFromUnitVectors(up, dir); m4.compose(v.set(Math.sin(aa) * R, 0.3, Math.cos(aa) * R).addScaledVector(dir, 0.72), q, one); this.ringCones.setMatrixAt(i * 3 + k, m4);
      }
    }
    this.ringSeg.instanceMatrix.needsUpdate = true; this.ringCones.instanceMatrix.needsUpdate = true;
  }
  // координаты пруда → пиксели холста
  mx(x) { return (x + ARENA_R + 1) * this.messScale; }
  mz(z) { return (z + ARENA_R + 1) * this.messScale; }
  paintStroke(x0, z0, x1, z1, w = 0.45, a = 0.3) {
    const c = this.messCtx, L = Math.hypot(x1 - x0, z1 - z0);
    c.strokeStyle = `rgba(104,64,26,${a})`; c.lineWidth = w * this.messScale * (0.8 + Math.random() * 0.4); c.lineCap = 'round';
    c.beginPath(); c.moveTo(this.mx(x0), this.mz(z0)); c.lineTo(this.mx(x1), this.mz(z1)); c.stroke();
    // капли по краям следа
    if (Math.random() < Math.min(1, L * 1.5)) { const k = Math.random(), px = x0 + (x1 - x0) * k + (Math.random() - 0.5) * 0.6, pz = z0 + (z1 - z0) * k + (Math.random() - 0.5) * 0.6; c.fillStyle = `rgba(96,58,24,${a + 0.15})`; c.beginPath(); c.arc(this.mx(px), this.mz(pz), (0.06 + Math.random() * 0.1) * this.messScale, 0, 6.28); c.fill(); }
    this.messDirty = true;
  }
  paintBlob(x, z, r = 0.6, a = 0.75) {
    const c = this.messCtx, px = this.mx(x), pz = this.mz(z), pr = r * this.messScale;
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * 6.28, d = Math.random() * pr * 0.6, rr = pr * (0.35 + Math.random() * 0.5);
      const g = c.createRadialGradient(px + Math.cos(ang) * d, pz + Math.sin(ang) * d, 0, px + Math.cos(ang) * d, pz + Math.sin(ang) * d, rr);
      g.addColorStop(0, `rgba(92,56,22,${a})`); g.addColorStop(0.7, `rgba(110,70,30,${a * 0.7})`); g.addColorStop(1, 'rgba(110,70,30,0)');
      c.fillStyle = g; c.beginPath(); c.arc(px + Math.cos(ang) * d, pz + Math.sin(ang) * d, rr, 0, 6.28); c.fill();
    }
    this.messDirty = true;
  }
  clearMess() { this.messCtx.clearRect(0, 0, this.messCv.width, this.messCv.height); this.messDirty = true; }
  flushMess() { if (this.messDirty) { this.messTex.needsUpdate = true; this.messDirty = false; } }
  placeBall(x, z, dt) {
    if (!this.ball) return;
    const b = this.ball, dx = x - b.position.x, dz = z - b.position.z, d = Math.hypot(dx, dz);
    if (d > 0.0001 && d < 4) b.rotateOnWorldAxis(this.ballAxis.set(dz / d, 0, -dx / d), d / BALL_R);
    b.position.set(x, BALL_R * 0.6 + Math.sin(performance.now() / 400) * 0.05, z);
  }
  dispose() { this.root.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.geometry) o.geometry.dispose(); }); }
}

// ------------------------------------------------------------
//  Бонусы на воде: боб, золотой боб, перец, прищепка
// ------------------------------------------------------------
const PK_MATS = {};
function pkMat(k) {
  if (PK_MATS[k]) return PK_MATS[k];
  const m = {
    bean: std(0x8c3b22, { roughness: 0.35, emissive: new THREE.Color(0x2a0a00) }),
    gold: std(0xf2c14e, { roughness: 0.2, metalness: 0.8, emissive: new THREE.Color(0x6a4a00) }),
    pepper: std(0xd8262a, { roughness: 0.25, emissive: new THREE.Color(0x3a0000) }),
    stem: std(0x3f8f2a, { roughness: 0.6 }),
    wood: std(0xd8b27a, { roughness: 0.7 }),
    metal: std(0xb8c0c8, { roughness: 0.3, metalness: 0.8 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
  }[k];
  PK_MATS[k] = m; return m;
}
const PK_GLOW = { bean: 0xffb36b, gold: 0xffe14a, pepper: 0xff5a3c, clip: 0x7fe0ff, stink: 0x9a7a3a, magnet: 0x5a8cff };
export function makePickupMesh(kind) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  if (kind === 'bean' || kind === 'gold') {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.32, 6, 14), pkMat(kind)); b.rotation.z = Math.PI / 2; b.scale.set(1, 1, 0.8); body.add(b);
    if (kind === 'gold') for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), pkMat('gold')); sp.position.set(Math.cos(i * 1.57) * 0.55, 0.25, Math.sin(i * 1.57) * 0.55); body.add(sp); }
  } else if (kind === 'pepper') {
    const p = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 14), pkMat('pepper')); p.rotation.z = Math.PI * 0.85; body.add(p);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.25, 8), pkMat('stem')); st.position.set(0.32, 0.38, 0); st.rotation.z = -0.5; body.add(st);
  } else if (kind === 'stink') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), std(0x5a3815, { roughness: 0.5 })); body.add(b);
    for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), std(0x9acd32, { transparent: true, opacity: 0.7, emissive: new THREE.Color(0x2a4a00) })); p.position.set(Math.cos(i * 2.1) * 0.3, 0.35 + i * 0.12, Math.sin(i * 2.1) * 0.3); body.add(p); }
  } else if (kind === 'magnet') {
    const red = std(0xd8262a, { roughness: 0.3 }), steel = std(0xd8dde4, { metalness: 0.7, roughness: 0.3 });
    const u = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 10, 20, Math.PI), red); u.rotation.z = Math.PI; body.add(u);
    for (const sx of [-1, 1]) { const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10), steel); tip.position.set(sx * 0.3, 0.09, 0); body.add(tip); }
  } else {
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.8), pkMat('wood')); w.position.x = sx * 0.07; w.rotation.y = sx * 0.12; body.add(w); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16), pkMat('metal')); ring.rotation.y = Math.PI / 2; ring.position.z = 0.05; body.add(ring);
  }
  body.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const glowMat = pkMat('glow').clone(); glowMat.color.setHex(PK_GLOW[kind] || 0xffffff);
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 32), glowMat); glow.rotation.x = -Math.PI / 2; glow.position.y = -0.55; glow.renderOrder = 2; g.add(glow);
  g.userData = { body, glow, kind, seed: Math.random() * 6 };
  return g;
}
export function animatePickup(g, t) {
  const U = g.userData;
  U.body.position.y = Math.sin(t * 2.5 + U.seed) * 0.12; U.body.rotation.y = t * 1.6 + U.seed;
  U.glow.scale.setScalar(1 + Math.sin(t * 4 + U.seed) * 0.12); U.glow.material.opacity = 0.4 + Math.sin(t * 4 + U.seed) * 0.15;
}
