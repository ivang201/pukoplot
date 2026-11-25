// ============================================================
//  Бегемот (со всем гардеробом), подписи и плот
// ============================================================
import * as THREE from 'three';
import { SKINS, RIM_R, shapeOf, rimR } from './shared.js';
import { BODIES, RSKINS } from './cosmetics.js';
import { skinTex, plankTex, ringTex, metalTex, hex, splatTex, bodyPatTex, ringSkinTex } from './textures.js';

export const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...extra });

// ---------- эмблемы маек
export function drawEmblem(ctx, kind, color, S = 256) {
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.save(); ctx.translate(S / 2, S / 2); ctx.scale(S / 256, S / 256);
  const P = (pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b))); ctx.closePath(); ctx.fill(); };
  if (kind === 'flame') {
    ctx.beginPath(); ctx.moveTo(0, -95);
    ctx.bezierCurveTo(40, -45, 70, -10, 62, 35); ctx.bezierCurveTo(55, 75, 25, 95, 0, 95);
    ctx.bezierCurveTo(-35, 95, -65, 70, -62, 30); ctx.bezierCurveTo(-60, 0, -35, -15, -30, -45);
    ctx.bezierCurveTo(-10, -25, -5, -10, -8, 10); ctx.bezierCurveTo(10, -10, 15, -50, 0, -95); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.ellipse(0, 55, 22, 30, 0, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'puk') {
    ctx.font = 'bold 118px "Arial Black", Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ПУК', 0, 8);
    ctx.beginPath(); ctx.lineWidth = 9; for (let i = 0; i < 3; i++) { ctx.moveTo(-80 + i * 55, -70); ctx.quadraticCurveTo(-60 + i * 55, -95, -40 + i * 55, -75); } ctx.stroke();
  } else if (kind === 'star') {
    ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 42 : 100, a = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill();
  } else if (kind === 'bolt') {
    P([[25, -105], [-55, 15], [-5, 15], [-30, 105], [60, -20], [8, -20], [40, -105]]);
  } else if (kind === 'drop') {
    ctx.beginPath(); ctx.moveTo(0, -100); ctx.bezierCurveTo(30, -50, 70, 0, 70, 35); ctx.arc(0, 35, 70, 0, Math.PI); ctx.bezierCurveTo(-70, 0, -30, -50, 0, -100); ctx.fill();
  } else if (kind === 'swirl') {
    ctx.lineWidth = 22; ctx.lineCap = 'round'; ctx.beginPath(); for (let t = 0; t < 1; t += 0.01) { const a = t * 11, r = 8 + t * 82; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.stroke();
  } else if (kind === 'wave') {
    ctx.lineWidth = 20; ctx.lineCap = 'round';
    for (const yy of [-45, 0, 45]) { ctx.beginPath(); for (let xx = -90; xx <= 90; xx += 4) ctx.lineTo(xx, yy + Math.sin(xx / 18) * 14); ctx.stroke(); }
  } else if (kind === 'paw') {
    ctx.beginPath(); ctx.ellipse(0, 30, 52, 44, 0, 0, 6.28); ctx.fill();
    for (const [a, b, r] of [[-62, -30, 22], [-24, -62, 22], [24, -62, 22], [62, -30, 22]]) { ctx.beginPath(); ctx.ellipse(a, b, r, r * 1.2, 0, 0, 6.28); ctx.fill(); }
  }
  ctx.restore();
}
export const printMats = SKINS.map((sk) => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  drawEmblem(c.getContext('2d'), sk.emblem, hex(sk.print));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return std(0xffffff, { map: tex, transparent: true, alphaTest: 0.05, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.9 });
});
const clubPrints = SKINS.map(sk => `art/shirts/${sk.emblem}.webp`);
export const shirtImages = [...clubPrints];
export async function loadShirtPrints(overrides = SKINS.map((_, i) => i + 1)) {
  const loader = new THREE.TextureLoader();
  await Promise.all(clubPrints.map(async (club, i) => {
    let url = overrides.includes(i + 1) ? `shirts/${i + 1}.png` : club;
    let texture;
    try { texture = await loader.loadAsync(url); }
    catch {
      if (url === club) return;
      url = club;
      try { texture = await loader.loadAsync(url); } catch { return; }
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    printMats[i].map.dispose();
    printMats[i].map = texture;
    printMats[i].needsUpdate = true;
    shirtImages[i] = url;
  }));
}

// ---------- геометрии
function deform(geo, fn) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  geo.computeVertexNormals(); return geo;
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const G = {
  ball: new THREE.SphereGeometry(1, 20, 14),
  ballHi: new THREE.SphereGeometry(1, 28, 20),
  // туловище-груша: шире внизу
  torso: deform(new THREE.SphereGeometry(1, 36, 28), v => { const k = 1 + 0.16 * smooth(0.3, -0.9, v.y); v.x *= k; v.z *= k; }),
  // попа: одна форма с ложбинкой и складкой снизу
  butt: deform(new THREE.SphereGeometry(1, 48, 36), v => {
    const back = smooth(0.1, -0.6, v.z);                                  // сзади (-Z)
    v.z += 0.34 * Math.exp(-(v.x * v.x) / 0.018) * back * smooth(-0.95, -0.2, v.y) * smooth(0.95, 0.3, v.y);   // ложбинка
    v.y -= 0.12 * smooth(-0.2, -1, v.y) * (0.6 + 0.4 * Math.abs(v.x));   // «сидячая» складка
    v.x *= 1 + 0.12 * smooth(0.4, -0.6, v.y);                              // шире книзу
  }),
  shirt: new THREE.SphereGeometry(1, 36, 22, 0, Math.PI * 2, Math.PI * 0.28, Math.PI * 0.5),
  print: new THREE.SphereGeometry(1, 16, 12, Math.PI / 2 - 0.62, 1.24, Math.PI * 0.34, Math.PI * 0.30),
  printBack: new THREE.SphereGeometry(1, 16, 12, -Math.PI / 2 - 0.55, 1.1, Math.PI * 0.32, Math.PI * 0.27),
  limb: new THREE.CapsuleGeometry(0.13, 0.42, 6, 12),
  thigh: new THREE.CapsuleGeometry(0.16, 0.36, 6, 12),
  ring: new THREE.TorusGeometry(0.12, 0.022, 8, 24),
  stick: new THREE.CylinderGeometry(0.018, 0.018, 1, 6),
  strap: new THREE.BoxGeometry(0.11, 0.42, 0.06),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
  cone: new THREE.ConeGeometry(1, 1, 16),
  box: new THREE.BoxGeometry(1, 1, 1),
  torus: new THREE.TorusGeometry(1, 0.15, 10, 32),
  heart: (() => { const s = new THREE.Shape(); s.moveTo(0, -0.3); s.bezierCurveTo(-1.2, 0.5, -0.5, 1.3, 0, 0.6); s.bezierCurveTo(0.5, 1.3, 1.2, 0.5, 0, -0.3); return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }); })(),
  star: (() => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.45 : 1, a = Math.PI / 2 + i * Math.PI / 5; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }); })(),
};
const M = {
  dark: std(0x2b2f36), white: std(0xffffff, { roughness: 0.3 }), black: std(0x111111, { roughness: 0.3 }), pink: std(0xd09090), tooth: std(0xfff8e0),
  stain: std(0x5a3815, { roughness: 0.35 }), mouth: std(0x4a1a22), gold: std(0xf2c14e, { metalness: 0.75, roughness: 0.25 }), metal: std(0xb8c0cc, { metalness: 0.7, roughness: 0.3, map: metalTex().map }),
  star: new THREE.MeshBasicMaterial({ color: 0xffe14a }), x: std(0x1a1a1a),
};
const shirtMats = SKINS.map(sk => std(sk.shirt, { roughness: 0.92 }));

// Позиции пятен грязи на теле (общие для всех бегемотов)
const DIRT_SPOTS = (() => {
  const out = []; let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 18; i++) {
    const part = i % 3; const a = r() * Math.PI * 2, y = r() * 2 - 1;
    if (part === 0) out.push({ p: 'chest', x: Math.cos(a) * 0.58 * Math.sqrt(1 - y * y * 0.6), y: y * 0.5, z: Math.sin(a) * 0.52 * Math.sqrt(1 - y * y * 0.6), s: 0.07 + r() * 0.07 });
    else if (part === 1) out.push({ p: 'butt', x: (r() - 0.5) * 0.7, y: (r() - 0.6) * 0.4, z: -0.3 - r() * 0.05, s: 0.07 + r() * 0.08 });
    else out.push({ p: 'head', x: (r() - 0.5) * 0.6, y: 0.1 + r() * 0.3, z: 0.25 + r() * 0.2, s: 0.05 + r() * 0.05 });
  }
  return out;
})();

// ------------------------------------------------------------
//  Бегемот: сидит на кромке лицом к центру (+Z), попа наружу (-Z)
// ------------------------------------------------------------
export function makeHippo(skinIdx, look = {}) {
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const sk = Math.min(Math.max(skinIdx | 0, 0), SKINS.length - 1);
  const B = BODIES.find(b => b.id === look.body) || BODIES[0];
  const skin = skinTex(), pat = B.pat ? bodyPatTex(B.pat) : null;
  const bodyMat = std(pat ? 0xffffff : B.body, { roughness: B.metal ? 0.28 : B.gloss ? 0.1 : 0.62, metalness: B.metal ? 0.6 : B.gloss ? 0.15 : 0, map: pat ? pat.map : skin.map, normalMap: skin.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
  if (pat && pat.glow) { bodyMat.emissive = new THREE.Color(B.pat === 'lava' ? 0xff6a10 : 0xffffff); bodyMat.emissiveMap = pat.glow; bodyMat.emissiveIntensity = B.pat === 'lava' ? 1.6 : 0.9; }
  if (B.glow) { bodyMat.emissive = new THREE.Color(B.glow); bodyMat.emissiveIntensity = 0.35; }
  const snoutMat = std(B.snout, { roughness: B.gloss ? 0.1 : 0.6, map: skin.map, metalness: B.metal ? 0.5 : 0 });
  const cheekMat = bodyMat.clone(); cheekMat.emissive = new THREE.Color(0xff3300); cheekMat.emissiveIntensity = 0; cheekMat.emissiveMap = null;
  const baseCol = new THREE.Color(pat ? 0xffffff : B.body), dirtCol = new THREE.Color(0x6b4a2a);
  const anim = [];          // анимации вещей: fn(t, dt, farting)
  if (B.anim === 'rainbow') anim.push((t) => { baseCol.setHSL((t * 0.12) % 1, 0.75, 0.62); bodyMat.color.copy(baseCol).lerp(dirtCol, (g.userData.dirtK || 0) * 0.45); snoutMat.color.copy(baseCol).offsetHSL(0.04, 0, 0.08); });
  const mk = (geo, mat, parent, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
  const shirtColor = shirtMats[sk];

  // ноги внутрь плота
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.22, 0.18, 0.12); inner.add(leg);
    mk(G.thigh, bodyMat, leg, 0, -0.18, 0.2, 1, 1, 1).rotation.x = 1.0;
    mk(G.ball, M.dark, leg, 0, -0.5, 0.48, 0.17, 0.09, 0.22);
    legs.push(leg);
  }
  // попа над водой
  const cheeks = new THREE.Group(); cheeks.position.set(0, 0.3, -0.26); inner.add(cheeks);
  mk(G.butt, cheekMat, cheeks, 0, 0, -0.06, 0.48, 0.36, 0.34);
  mk(G.ball, bodyMat, cheeks, 0, 0.24, -0.38, 0.06, 0.06, 0.09);          // хвостик
  const stain = mk(G.ball, M.stain, cheeks, 0, -0.1, -0.33, 0.3, 0.17, 0.08); stain.visible = false;
  // корпус
  const chest = new THREE.Group(); chest.position.set(0, 0.64, 0.02); chest.rotation.x = 0.28; inner.add(chest);
  mk(G.torso, bodyMat, chest, 0, 0, 0, 0.56, 0.6, 0.5);
  mk(G.shirt, shirtColor, chest, 0, 0, 0, 0.585, 0.615, 0.53);
  mk(G.print, printMats[sk], chest, 0, 0, 0, 0.595, 0.625, 0.54);
  mk(G.printBack, printMats[sk], chest, 0, 0, 0, 0.595, 0.625, 0.54);
  for (const sx of [-1, 1]) for (const sz of [1, -1]) { const st = mk(G.strap, shirtColor, chest, sx * 0.27, 0.42, sz * 0.16, 1, 1, 1); st.rotation.x = -sz * 0.45; st.rotation.z = sx * 0.12; }
  // руки держатся за кромку
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.55, 0.92, 0.12); inner.add(sh);
    mk(G.limb, bodyMat, sh, sx * 0.06, -0.38, 0.04, 1, 1, 1).rotation.z = sx * 0.15;
    mk(G.ball, M.dark, sh, sx * 0.1, -0.72, 0.08, 0.15, 0.1, 0.17);
    arms.push(sh);
  }
  // голова
  const head = new THREE.Group(); head.position.set(0, 1.2, 0.28); head.rotation.x = 0.12; inner.add(head);
  mk(G.ballHi, bodyMat, head, 0, 0.12, -0.02, 0.42, 0.38, 0.44);
  mk(G.ballHi, snoutMat, head, 0, -0.02, 0.33, 0.47, 0.3, 0.32);
  for (const sx of [-1, 1]) mk(G.ball, M.dark, head, sx * 0.15, 0.17, 0.56, 0.065, 0.045, 0.05);
  for (const sx of [-1, 1]) mk(G.ball, M.tooth, head, sx * 0.14, -0.2, 0.55, 0.05, 0.06, 0.04);
  const mouth = mk(G.ball, M.mouth, head, 0, -0.16, 0.6, 0.16, 0.02, 0.05);
  const lids = [], pupils = [], xEyes = [];
  for (const sx of [-1, 1]) {
    mk(G.ball, M.white, head, sx * 0.2, 0.36, 0.2, 0.1, 0.1, 0.09);
    pupils.push(mk(G.ball, M.black, head, sx * 0.2, 0.37, 0.28, 0.05, 0.055, 0.03));
    lids.push(mk(G.ball, bodyMat, head, sx * 0.21, 0.42, 0.21, 0.12, 0.06, 0.1));
    const xg = new THREE.Group(); xg.position.set(sx * 0.2, 0.36, 0.29); xg.visible = false; head.add(xg);
    for (const r of [0.8, -0.8]) { const b = mk(G.box, M.x, xg, 0, 0, 0, 0.16, 0.03, 0.02); b.rotation.z = r; }
    xEyes.push(xg);
    const ear = mk(G.ball, bodyMat, head, sx * 0.3, 0.46, -0.08, 0.1, 0.12, 0.06); ear.rotation.z = sx * 0.4;
    mk(G.ball, M.pink, head, sx * 0.3, 0.46, -0.05, 0.06, 0.08, 0.03).rotation.z = sx * 0.4;
  }
  // звёздочки над головой (обморок)
  const stars = new THREE.Group(); stars.position.set(0, 0.85, 0.05); stars.visible = false; head.add(stars);
  for (let k = 0; k < 4; k++) { const st = mk(G.star, M.star, stars, Math.cos(k * 1.57) * 0.38, 0, Math.sin(k * 1.57) * 0.38, 0.08, 0.08, 0.08); st.castShadow = false; }
  addHat(head, look.hat, shirtColor, mk, anim);
  addGlasses(head, look.glasses, mk, anim);
  const extra = addExtra(head, chest, look.extra, mk, anim);
  // грязь
  const parts = { chest, butt: cheeks, head };
  const Z = new THREE.Vector3(0, 0, 1);
  const dirt = DIRT_SPOTS.map(d => {
    const m = mk(G.ball, M.stain, parts[d.p], d.x, d.y, d.z, d.s * 1.2, d.s, d.s * 0.28);   // плоская клякса по поверхности
    m.quaternion.setFromUnitVectors(Z, new THREE.Vector3(d.x, d.p === 'head' ? d.y - 0.1 : d.y, d.p === 'butt' ? d.z + 0.06 : d.z).normalize());
    m.visible = false; m.castShadow = false; return m;
  });

  g.scale.setScalar(0.85);
  g.userData = { anim, inner, head, arms, legs, cheeks, cheekMat, bodyMat, stain, lids, pupils, xEyes, stars, chest, mouth, dirt, extra, baseCol, dirtCol, butt: new THREE.Vector3(0, 0.3, -0.66), mouthPos: new THREE.Vector3(0, 1.08, 0.95) };
  return g;
}

export function setHippoDirt(h, d) {
  const U = h.userData, n = Math.round(d * U.dirt.length); U.dirtK = d;
  U.dirt.forEach((m, i) => { m.visible = i < n; });
  U.bodyMat.color.copy(U.baseCol).lerp(U.dirtCol, d * 0.45);
  U.cheekMat.color.copy(U.baseCol).lerp(U.dirtCol, d * 0.6);
  U.stain.visible = d > 0.25;
}

function addHat(head, id, shirtMat, mk, anim) {
  if (!id || id === 'none') return;
  const g = new THREE.Group(); g.position.set(0, 0.48, -0.02); head.add(g);
  const C = (geo, mat, x, y, z, sx, sy, sz) => mk(geo, mat, g, x, y, z, sx, sy, sz);
  switch (id) {
    case 'cap': {
      const mat = shirtMat;
      const dome = C(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0, -0.02, 0, 0.34, 0.24, 0.36);
      C(G.cyl, mat, 0, 0, 0.36, 0.26, 0.02, 0.2).rotation.x = -0.15;
      C(G.ball, M.white, 0, 0.21, 0, 0.04, 0.03, 0.04); break;
    }
    case 'cowboy': {
      const brown = std(0x8b5a2b, { roughness: 0.85 });
      C(G.cyl, brown, 0, 0.02, 0, 0.6, 0.03, 0.62);
      C(G.cyl, brown, 0, 0.17, 0, 0.3, 0.3, 0.3).scale.set(0.3, 0.3, 0.34);
      C(G.cyl, std(0x3a2414), 0, 0.07, 0, 0.31, 0.06, 0.35); break;
    }
    case 'ushanka': {
      const fur = std(0x6b5a4a, { roughness: 1 }), top = std(0x3c3a44);
      C(G.ballHi, top, 0, 0.02, 0, 0.36, 0.22, 0.38);
      C(G.cyl, fur, 0, -0.02, 0, 0.4, 0.1, 0.42);
      for (const sx of [-1, 1]) C(G.box, fur, sx * 0.38, -0.2, -0.02, 0.06, 0.3, 0.26);
      C(G.box, fur, 0, 0.08, 0.38, 0.3, 0.14, 0.05); break;
    }
    case 'bandana': {
      const red = std(0xc8202e, { roughness: 0.8 });
      C(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), red, 0, -0.06, 0, 0.4, 0.22, 0.42);
      C(G.ball, red, 0, -0.04, -0.42, 0.07, 0.07, 0.07);
      for (const sx of [-1, 1]) C(G.box, red, sx * 0.07, -0.16, -0.44, 0.06, 0.18, 0.02).rotation.z = sx * 0.4; break;
    }
    case 'propeller': {
      const a = std(0xf2c14e), b = std(0x3d8fe0);
      C(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), a, 0, -0.03, 0, 0.36, 0.24, 0.38);
      C(G.stick, M.dark, 0, 0.28, 0, 1, 0.12, 1);
      const prop = new THREE.Group(); prop.position.y = 0.34; g.add(prop);
      for (const r of [0, Math.PI]) { const bl = mk(G.box, b, prop, Math.cos(r) * 0.16, 0, Math.sin(r) * 0.16, 0.3, 0.015, 0.07); bl.rotation.y = -r; }
      g.userData.spin = prop; break;
    }
    case 'tophat': {
      const blk = std(0x18181e, { roughness: 0.5 });
      C(G.cyl, blk, 0, 0.0, 0, 0.5, 0.03, 0.5);
      C(G.cyl, blk, 0, 0.26, 0, 0.29, 0.5, 0.29);
      C(G.cyl, std(0xc8202e), 0, 0.06, 0, 0.3, 0.07, 0.3); break;
    }
    case 'bucket': {
      const tin = std(0xa9b2bd, { metalness: 0.7, roughness: 0.35, map: metalTex().map });
      C(new THREE.CylinderGeometry(0.3, 0.4, 0.5, 20, 1, true), tin, 0, 0.16, 0, 1, 1, 1).material.side = THREE.DoubleSide;
      C(G.cyl, tin, 0, 0.41, 0, 0.3, 0.02, 0.3);
      const hd = C(G.torus, tin, 0, 0.08, 0, 0.42, 0.42, 0.2); hd.rotation.y = Math.PI / 2; break;
    }
    case 'chef': {
      const w = std(0xffffff, { roughness: 0.9 });
      C(G.cyl, w, 0, 0.1, 0, 0.3, 0.22, 0.3);
      for (const [x, z] of [[0, 0], [0.14, 0.08], [-0.14, 0.06], [0.05, -0.14], [-0.08, -0.1]]) C(G.ballHi, w, x, 0.32, z, 0.2, 0.17, 0.2); break;
    }
    case 'viking': {
      const steel = std(0x9aa3ae, { metalness: 0.8, roughness: 0.35 }), horn = std(0xf2ead8);
      C(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, -0.04, 0, 0.4, 0.3, 0.42);
      C(G.cyl, std(0x8b5a2b), 0, -0.03, 0, 0.41, 0.05, 0.43);
      for (const sx of [-1, 1]) { const h = C(G.cone, horn, sx * 0.44, 0.12, 0, 0.08, 0.36, 0.08); h.rotation.z = -sx * 1.0; } break;
    }
    case 'laurel': {
      const leaf = std(0x5f9e3a, { roughness: 0.6 });
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 1.7 - Math.PI * 0.85 + Math.PI; const l = C(G.ball, leaf, Math.sin(a) * 0.36, -0.02 + (k % 2) * 0.03, Math.cos(a) * 0.38, 0.06, 0.03, 0.12); l.rotation.y = a + 0.6; l.rotation.z = 0.4; }
      break;
    }
    case 'beanie': {
      const k = std(0x2f7fd0, { roughness: 1 }), w = std(0xffffff, { roughness: 1 });
      C(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), k, 0, -0.06, 0, 0.4, 0.34, 0.42);
      C(G.cyl, w, 0, -0.04, 0, 0.41, 0.1, 0.43);
      C(G.ballHi, w, 0, 0.3, 0, 0.11, 0.11, 0.11); break;
    }
    case 'party': {
      const tex = std(0xff4fa0, { roughness: 0.6 }), dots = std(0xffe14a);
      const c = C(G.cone, tex, 0.05, 0.22, 0, 0.2, 0.5, 0.2); c.rotation.z = -0.25;
      for (let k = 0; k < 6; k++) { const a = k * 1.1, y = 0.06 + k * 0.06; C(G.ball, dots, 0.05 + Math.sin(a) * (0.17 - k * 0.025) + y * 0.25, y, Math.cos(a) * (0.17 - k * 0.025), 0.03, 0.03, 0.03); }
      C(G.ball, std(0x3d8fe0), -0.05, 0.47, 0, 0.06, 0.06, 0.06); break;
    }
    case 'santa': {
      const red = std(0xd02a2a, { roughness: 0.85 }), w = std(0xffffff, { roughness: 1 });
      C(G.cyl, w, 0, -0.02, 0, 0.4, 0.1, 0.42);
      const c = C(G.cone, red, 0, 0.2, -0.04, 0.36, 0.45, 0.38); c.rotation.x = -0.45;
      C(G.ballHi, w, 0, 0.32, -0.3, 0.08, 0.08, 0.08); break;
    }
    case 'pirate': {
      const blk = std(0x231a14, { roughness: 0.75 });
      const br = C(new THREE.CylinderGeometry(1, 1, 1, 3), blk, 0, 0.03, -0.02, 0.6, 0.1, 0.6); br.rotation.y = Math.PI;
      const tr = C(new THREE.TorusGeometry(1, 0.06, 6, 3), M.gold, 0, 0.08, -0.02, 0.6, 0.6, 0.6); tr.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      C(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), blk, 0, 0.05, 0, 0.33, 0.28, 0.35);
      C(G.ball, M.white, 0, 0.2, 0.29, 0.07, 0.07, 0.03);
      for (const sx of [-1, 1]) C(G.box, M.white, sx * 0.05, 0.13, 0.31, 0.12, 0.025, 0.02).rotation.z = sx * 0.6;
      break;
    }
    case 'sombrero': {
      const straw = std(0xd9b26a, { roughness: 0.9 }), band = std(0xd8323a);
      C(G.cyl, straw, 0, 0.0, 0, 0.85, 0.03, 0.85);
      C(G.torus, straw, 0, 0.03, 0, 0.85, 0.85, 0.5).rotation.x = Math.PI / 2;
      C(new THREE.CylinderGeometry(0.16, 0.3, 0.42, 20), straw, 0, 0.22, 0, 1, 1, 1);
      C(G.cyl, band, 0, 0.09, 0, 0.29, 0.07, 0.29); break;
    }
    case 'wizard': {
      const blue = std(0x2a3a8f, { roughness: 0.7 }), star = std(0xffe14a, { emissive: 0xffc400, emissiveIntensity: 0.4 });
      C(G.cyl, blue, 0, 0.0, 0, 0.55, 0.03, 0.55);
      const c = C(G.cone, blue, 0, 0.42, -0.04, 0.32, 0.85, 0.32); c.rotation.x = -0.12;
      for (const [x, y, z] of [[0.18, 0.2, 0.18], [-0.12, 0.4, 0.14], [0.06, 0.6, 0.1]]) { const st = C(G.star, star, x, y, z, 0.06, 0.06, 0.06); st.lookAt(st.position.x * 4, st.position.y, st.position.z * 4 + 2); }
      break;
    }
    case 'horns': {
      const red = std(0xc81e2e, { roughness: 0.4 });
      for (const sx of [-1, 1]) { const h = C(G.cone, red, sx * 0.22, 0.05, 0.12, 0.07, 0.24, 0.07); h.rotation.z = -sx * 0.35; h.rotation.x = 0.2; }
      break;
    }
    case 'unicorn': {
      const pearl = std(0xfff0f8, { roughness: 0.25, metalness: 0.2 }), gold = M.gold;
      const hg = new THREE.Group(); hg.position.set(0, 0.02, 0.3); hg.rotation.x = 0.55; g.add(hg);
      mk(G.cone, pearl, hg, 0, 0.22, 0, 0.09, 0.48, 0.09);
      for (let k = 0; k < 4; k++) mk(G.torus, gold, hg, 0, 0.06 + k * 0.1, 0, 0.08 - k * 0.016, 0.08 - k * 0.016, 0.2).rotation.x = Math.PI / 2 + 0.3;
      for (const [c, x] of [[0xff7fb0, -0.18], [0x7fd0ff, 0.18]]) mk(G.ball, std(c), g, x, -0.02, 0.05, 0.08, 0.05, 0.12);
      break;
    }
    case 'halo': {
      const gold = new THREE.MeshBasicMaterial({ color: 0xffe066 });
      const ring = C(G.torus, gold, 0, 0.32, 0, 0.32, 0.32, 0.45); ring.rotation.x = Math.PI / 2; ring.castShadow = false;
      const glow = C(new THREE.TorusGeometry(1, 0.35, 8, 32), new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.25, depthWrite: false }), 0, 0.32, 0, 0.32, 0.32, 0.5); glow.rotation.x = Math.PI / 2; glow.castShadow = false;
      anim.push((t) => { ring.position.y = glow.position.y = 0.32 + Math.sin(t * 2.2) * 0.04; glow.material.opacity = 0.18 + Math.sin(t * 4) * 0.08; });
      break;
    }
    case 'astro': {
      g.position.set(0, 0, 0);
      const glass = new THREE.MeshStandardMaterial({ color: 0xcfefff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide });
      const dome = C(G.ballHi, glass, 0, 0.16, 0.14, 0.66, 0.62, 0.7); dome.castShadow = false; dome.renderOrder = 3;
      C(G.torus, std(0xf2f2f2, { roughness: 0.5 }), 0, -0.22, 0.1, 0.6, 0.6, 0.9).rotation.x = Math.PI / 2;
      C(G.stick, M.metal, 0.3, 0.78, 0, 1, 0.3, 1);
      const tip = C(G.ball, new THREE.MeshBasicMaterial({ color: 0xff3b3b }), 0.3, 0.94, 0, 0.04, 0.04, 0.04);
      anim.push((t) => { tip.visible = Math.floor(t * 2) % 2 === 0; });
      break;
    }
    case 'crown': {
      C(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 20, 1, true), M.gold, 0, 0.05, 0, 1, 1, 1).material.side = THREE.DoubleSide;
      for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; C(G.cone, M.gold, Math.sin(a) * 0.29, 0.2, Math.cos(a) * 0.29, 0.05, 0.14, 0.05); }
      for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.3; C(G.ball, std([0xd8323a, 0x3d8fe0, 0x4fb35f, 0x9b55db][k], { roughness: 0.2 }), Math.sin(a) * 0.31, 0.05, Math.cos(a) * 0.31, 0.04, 0.04, 0.03); }
      break;
    }
  }
  head.userData.hat = g;
}

function addGlasses(head, id, mk, anim) {
  if (!id || id === 'none') return;
  switch (id) {
    case 'round':
      for (const sx of [-1, 1]) { mk(G.ring, M.black, head, sx * 0.2, 0.36, 0.33, 1, 1, 1); mk(G.stick, M.black, head, sx * 0.34, 0.37, 0.18, 1, 0.3, 1).rotation.x = Math.PI / 2; }
      mk(G.stick, M.black, head, 0, 0.38, 0.33, 1, 0.16, 1).rotation.z = Math.PI / 2; break;
    case 'sun': {
      const lens = std(0x111318, { roughness: 0.1, metalness: 0.4 });
      for (const sx of [-1, 1]) mk(G.box, lens, head, sx * 0.19, 0.36, 0.33, 0.2, 0.12, 0.03);
      mk(G.box, M.black, head, 0, 0.4, 0.33, 0.46, 0.025, 0.03); break;
    }
    case 'nerd': {
      const fr = std(0xffffff), r = std(0xe8303a, { transparent: true, opacity: 0.75 }), b = std(0x2bc8e8, { transparent: true, opacity: 0.75 });
      mk(G.box, fr, head, 0, 0.36, 0.32, 0.5, 0.15, 0.025);
      mk(G.box, r, head, -0.12, 0.36, 0.335, 0.18, 0.1, 0.01); mk(G.box, b, head, 0.12, 0.36, 0.335, 0.18, 0.1, 0.01); break;
    }
    case 'heart': {
      const pink = std(0xff3c7a, { roughness: 0.2, transparent: true, opacity: 0.85 });
      for (const sx of [-1, 1]) { const m = mk(G.heart, pink, head, sx * 0.2, 0.37, 0.34, 0.11, 0.11, 0.1); m.rotation.z = Math.PI; }
      mk(G.stick, M.black, head, 0, 0.38, 0.33, 1, 0.12, 1).rotation.z = Math.PI / 2; break;
    }
    case 'eyepatch': {
      mk(G.ball, M.black, head, 0.2, 0.36, 0.31, 0.11, 0.1, 0.04);
      for (const [x, y, z, rz] of [[0.06, 0.47, 0.3, 1.2], [0.33, 0.3, 0.2, 1.9]]) { const st = mk(G.stick, M.black, head, x, y, z, 1.2, 0.3, 1.2); st.rotation.z = rz; }
      break;
    }
    case 'star': {
      const y = std(0xffd23f, { roughness: 0.3, emissive: 0xffa000, emissiveIntensity: 0.2 });
      for (const sx of [-1, 1]) { const m = mk(G.star, y, head, sx * 0.2, 0.36, 0.32, 0.13, 0.13, 0.1); m.rotation.y = 0; }
      break;
    }
    case 'visor': {
      const lens = std(0xff8a1f, { roughness: 0.05, metalness: 0.7 }), strap = std(0x222222);
      const v = mk(new THREE.SphereGeometry(1, 24, 10, -0.9, 1.8, 1.25, 0.6), lens, head, 0, 0.42, 0.0, 0.42, 0.42, 0.4); v.rotation.y = 0;
      v.material.side = THREE.DoubleSide;
      const st = mk(G.torus, strap, head, 0, 0.38, -0.02, 0.43, 0.43, 0.15); st.rotation.x = Math.PI / 2; break;
    }
    case 'cyber': {
      const glow = new THREE.MeshBasicMaterial({ color: 0x29e6ff });
      const bar = mk(G.box, glow, head, 0, 0.36, 0.34, 0.5, 0.07, 0.03); bar.castShadow = false;
      mk(G.box, M.dark, head, 0, 0.36, 0.325, 0.56, 0.12, 0.03);
      for (const sx of [-1, 1]) mk(G.box, M.dark, head, sx * 0.3, 0.37, 0.2, 0.03, 0.08, 0.26);
      anim.push((t) => { glow.color.setHSL(0.52 + Math.sin(t * 3) * 0.03, 1, 0.55 + Math.sin(t * 9) * 0.1); });
      break;
    }
    case 'laser': {
      const red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
      for (const sx of [-1, 1]) { mk(G.cyl, M.dark, head, sx * 0.19, 0.36, 0.32, 0.12, 0.05, 0.12).rotation.x = Math.PI / 2; const l = mk(G.cyl, red, head, sx * 0.19, 0.36, 0.35, 0.09, 0.02, 0.09); l.rotation.x = Math.PI / 2; l.castShadow = false; }
      mk(G.box, M.dark, head, 0, 0.38, 0.33, 0.14, 0.03, 0.03);
      anim.push((t) => { red.color.setRGB(1, 0.1 + Math.max(0, Math.sin(t * 7)) * 0.3, 0.1); });
      break;
    }
    case 'monocle':
      mk(G.ring, M.gold, head, 0.2, 0.36, 0.33, 1, 1, 1);
      mk(G.stick, M.gold, head, 0.27, 0.1, 0.32, 1, 0.5, 1).rotation.z = 0.25; break;
    case 'gasmask': {
      const rub = std(0x3e4a3a, { roughness: 0.8 });
      mk(G.ballHi, rub, head, 0, 0.1, 0.4, 0.42, 0.33, 0.28);
      for (const sx of [-1, 1]) mk(G.cyl, std(0xcfe8f0, { roughness: 0.05, metalness: 0.3 }), head, sx * 0.17, 0.36, 0.33, 0.1, 0.03, 0.1).rotation.x = Math.PI / 2;
      const f = mk(G.cyl, M.metal, head, 0, -0.05, 0.68, 0.13, 0.14, 0.13); f.rotation.x = Math.PI / 2; break;
    }
  }
}

function addExtra(head, chest, id, mk, anim) {
  if (!id || id === 'none') return null;
  switch (id) {
    case 'mustache': {
      const hair = std(0x2a1a10, { roughness: 1 });
      for (const sx of [-1, 1]) { const m = mk(new THREE.CapsuleGeometry(0.04, 0.16, 4, 8), hair, head, sx * 0.1, 0.06, 0.62, 1, 1, 1); m.rotation.z = sx * 1.2; }
      return null;
    }
    case 'bowtie': {
      const red = std(0xc8202e);
      for (const sx of [-1, 1]) { const c = mk(G.cone, red, chest, sx * 0.09, 0.55, 0.27, 0.07, 0.14, 0.07); c.rotation.z = sx * Math.PI / 2; }
      mk(G.ball, red, chest, 0, 0.55, 0.28, 0.04, 0.04, 0.04); return null;
    }
    case 'clothespin': {
      const wood = std(0xd8b27a);
      mk(G.box, wood, head, -0.03, 0.15, 0.62, 0.05, 0.05, 0.3).rotation.x = -0.2;
      mk(G.box, wood, head, 0.03, 0.15, 0.62, 0.05, 0.05, 0.3).rotation.x = -0.2;
      mk(G.cyl, M.metal, head, 0, 0.15, 0.58, 0.05, 0.08, 0.05).rotation.z = Math.PI / 2; return null;
    }
    case 'scarf': {
      const red = std(0xd8323a, { roughness: 1 }), w = std(0xf4f4f4, { roughness: 1 });
      const t1 = mk(G.torus, red, chest, 0, 0.5, 0.0, 0.36, 0.36, 0.9); t1.rotation.x = Math.PI / 2 + 0.25;
      for (let k = 0; k < 3; k++) mk(G.box, k % 2 ? w : red, chest, 0.16, 0.36 - k * 0.12, 0.36 - k * 0.02, 0.12, 0.12, 0.05).rotation.z = 0.15;
      return null;
    }
    case 'flower': {
      const pet = std(0xff6fa8, { roughness: 0.6 }), mid = std(0xffd23f);
      const fg = new THREE.Group(); fg.position.set(0.34, 0.42, 0.04); fg.rotation.set(0, 0.9, 0.3); head.add(fg);
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; mk(G.ball, pet, fg, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0, 0.06, 0.06, 0.025); }
      mk(G.ball, mid, fg, 0, 0, 0.015, 0.04, 0.04, 0.03); return null;
    }
    case 'tie': {
      const blue = std(0x2b4fa0, { roughness: 0.6 });
      mk(G.box, blue, chest, 0, 0.5, 0.42, 0.08, 0.07, 0.05).rotation.x = 0.3;
      const t = mk(G.cone, blue, chest, 0, 0.24, 0.5, 0.08, 0.42, 0.03); t.rotation.x = 0.25; return null;
    }
    case 'pacifier': {
      const pink = std(0xff9ec4, { roughness: 0.4 }), ring = std(0x7fd0ff, { roughness: 0.3 });
      mk(G.cyl, pink, head, 0, -0.14, 0.64, 0.14, 0.03, 0.1).rotation.x = Math.PI / 2;
      const r = mk(G.torus, ring, head, 0, -0.14, 0.69, 0.08, 0.08, 0.3); return null;
    }
    case 'snorkel': {
      const o = std(0xff7a1a, { roughness: 0.4 });
      mk(G.cyl, o, head, 0.32, 0.45, 0.2, 0.04, 0.6, 0.04);
      const b = mk(G.cyl, o, head, 0.2, -0.12, 0.48, 0.04, 0.3, 0.04); b.rotation.z = Math.PI / 2 - 0.3;
      mk(G.cyl, o, head, 0.3, 0.05, 0.36, 0.04, 0.35, 0.04).rotation.x = -0.6;
      mk(G.ball, std(0x222222), head, 0, -0.14, 0.62, 0.07, 0.05, 0.04); return null;
    }
    case 'wings': {
      const w = std(0xffffff, { roughness: 0.6 }), ws = [];
      for (const sx of [-1, 1]) {
        const wg = new THREE.Group(); wg.position.set(sx * 0.18, 0.25, -0.42); chest.add(wg); ws.push([wg, sx]);
        for (let k = 0; k < 3; k++) mk(G.ball, w, wg, sx * (0.16 + k * 0.1), 0.06 - k * 0.07, -0.02, 0.16 - k * 0.02, 0.07, 0.03).rotation.z = sx * (0.35 + k * 0.15);
      }
      anim.push((t, dt, f) => { for (const [wg, sx] of ws) wg.rotation.y = sx * (0.35 + Math.sin(t * (f ? 22 : 5)) * (f ? 0.5 : 0.2)); });
      return null;
    }
    case 'jetpack': {
      const body = std(0x9aa3ae, { metalness: 0.6, roughness: 0.35 }), red = std(0xd8323a), fire = new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 });
      const fl = [];
      for (const sx of [-1, 1]) {
        mk(G.cyl, body, chest, sx * 0.14, 0.05, -0.52, 0.11, 0.48, 0.11);
        mk(G.cone, red, chest, sx * 0.14, 0.38, -0.52, 0.11, 0.16, 0.11);
        mk(G.cyl, M.dark, chest, sx * 0.14, -0.23, -0.52, 0.08, 0.08, 0.08);
        const f = mk(G.cone, fire, chest, sx * 0.14, -0.4, -0.52, 0.07, 0.28, 0.07); f.rotation.x = Math.PI; f.castShadow = false; fl.push(f);
      }
      anim.push((t, dt, f) => { for (const x of fl) { x.visible = f; x.scale.y = 0.2 + Math.random() * 0.15; } });
      return null;
    }
    case 'cape': {
      const red = std(0xc81e2e, { roughness: 0.7, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(0.8, 0.75, 6, 6); geo.translate(0, -0.37, 0);
      const cape = new THREE.Mesh(geo, red); cape.position.set(0, 0.45, -0.46); cape.rotation.x = 0.35; cape.castShadow = true; chest.add(cape);
      mk(G.ball, M.gold, chest, -0.25, 0.47, -0.36, 0.05, 0.05, 0.03); mk(G.ball, M.gold, chest, 0.25, 0.47, -0.36, 0.05, 0.05, 0.03);
      const P = geo.attributes.position, base = Float32Array.from(P.array);
      anim.push((t, dt, f) => { for (let i = 0; i < P.count; i++) { const y = base[i * 3 + 1], x = base[i * 3]; P.setZ(i, base[i * 3 + 2] - Math.sin(t * (f ? 14 : 4) + x * 4 + y * 3) * 0.05 * -y * (f ? 2.5 : 1)); } P.needsUpdate = true; });
      return null;
    }
    case 'chain': {
      const c = mk(G.torus, M.gold, chest, 0, 0.45, 0.05, 0.36, 0.36, 0.5); c.rotation.x = Math.PI / 2 + 0.3;
      const p = mk(G.cyl, M.gold, chest, 0, 0.2, 0.5, 0.09, 0.02, 0.09); p.rotation.x = Math.PI / 2; return null;
    }
    case 'medal': {
      const rib = std(0x3d8fe0);
      mk(G.box, rib, chest, 0, 0.32, 0.47, 0.08, 0.2, 0.02);
      const d = mk(G.cyl, M.gold, chest, 0, 0.18, 0.5, 0.09, 0.02, 0.09); d.rotation.x = Math.PI / 2; return null;
    }
  }
  return null;
}

export function makeLabel(text, color = '#fff', sub = '') {
  const c = document.createElement('canvas'); c.width = 320; c.height = 96;
  const x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  x.font = '800 34px Rubik, "Segoe UI", system-ui, sans-serif';
  x.lineWidth = 7; x.strokeStyle = 'rgba(20,24,40,0.85)'; x.strokeText(text, 160, 36); x.fillStyle = color; x.fillText(text, 160, 36);
  if (sub) { x.font = '700 20px Rubik, "Segoe UI", sans-serif'; x.lineWidth = 5; x.strokeText(sub, 160, 72); x.fillStyle = '#ffd166'; x.fillText(sub, 160, 72); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(0.2, 0.06, 1); sp.renderOrder = 10; return sp;
}

// ------------------------------------------------------------
//  Плот
// ------------------------------------------------------------
// точки кромки по кругу (в осях плота): для круглого — окружность, для остальных — скруглённый многоугольник
function rimCurve(S, a0 = 0, a1 = Math.PI * 2, n = 96, closed = true) {
  const pts = [];
  for (let k = 0; k <= n; k++) { if (closed && k === n) break; const th = a0 + (a1 - a0) * k / n, r = rimR(S, th); pts.push(new THREE.Vector3(Math.sin(th) * r, 0, Math.cos(th) * r)); }
  return new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
}
const ringMatCache = new Map();
const grabHandleMaterial = std(0xa83924, { roughness: 0.54 });
let deckMaterial, fabricRoughness;
const raftArt = new THREE.TextureLoader();
function applyRaftArt(material, file) {
  raftArt.load(`art/materials/${file}.webp`, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
  });
}
export function makeRaft(shapeId = 'round', skinId = 'classic') {
  const S = shapeOf(shapeId), g = new THREE.Group(), SK = RSKINS.find(k => k.id === skinId) || RSKINS[0];
  if (!fabricRoughness) {
    fabricRoughness = raftArt.load('art/materials/world-rubber.webp');
    fabricRoughness.wrapS = fabricRoughness.wrapT = THREE.RepeatWrapping;
    fabricRoughness.repeat.set(4, 1);
  }
  if (!ringMatCache.has(SK.id)) {
    const material = std(0xffffff, { map: SK.id === 'classic' ? ringTex() : ringSkinTex(SK),
      roughnessMap: fabricRoughness, roughness: SK.metal ? 0.38 : 0.66, metalness: SK.metal ? 0.65 : 0 });
    if (SK.id === 'classic') applyRaftArt(material, 'classic-tube');
    ringMatCache.set(SK.id, material);
  }
  const ringMat = ringMatCache.get(SK.id);
  let ring;
  if (!S.N) { ring = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.4, 24, 72), ringMat); ring.rotation.x = Math.PI / 2; }
  else ring = new THREE.Mesh(new THREE.TubeGeometry(rimCurve(S), 160, 0.4, 20, true), ringMat);
  ring.castShadow = true; ring.receiveShadow = true; g.add(ring);
  const seamMat = std(0xe2bd96, { roughness: 0.4 });
  if (!S.N) { const seam = new THREE.Mesh(new THREE.TorusGeometry(RIM_R + 0.4, 0.035, 6, 72), seamMat); seam.rotation.x = Math.PI / 2; g.add(seam); }
  // пол из досок по форме плота
  const shp = new THREE.Shape();
  for (let k = 0; k <= 72; k++) { const th = k / 72 * Math.PI * 2, r = rimR(S, th) - 0.05; const x = Math.sin(th) * r, z = Math.cos(th) * r; if (k === 0) shp.moveTo(x, -z); else shp.lineTo(x, -z); }
  const floorGeo = new THREE.ShapeGeometry(shp, 4);
  floorGeo.computeBoundingBox();
  const { min, max } = floorGeo.boundingBox;
  const deckSpan = 2 * Math.max(-min.x, -min.y, max.x, max.y);
  const uv = floorGeo.attributes.uv, vertices = floorGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, vertices.getX(i) / deckSpan + 0.5, vertices.getY(i) / deckSpan + 0.5);
  if (!deckMaterial) {
    deckMaterial = std(0xffffff, { map: plankTex(), roughness: 0.8 });
    applyRaftArt(deckMaterial, 'raft-deck');
  }
  const floor = new THREE.Mesh(floorGeo, deckMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.1; floor.receiveShadow = true; g.add(floor);
  const grip = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.21, 0, 0), new THREE.Vector3(-0.16, 0.15, 0.04),
    new THREE.Vector3(0.16, 0.15, 0.04), new THREE.Vector3(0.21, 0, 0),
  ]);
  const handles = new THREE.InstancedMesh(new THREE.TubeGeometry(grip, 12, 0.055, 6, false), grabHandleMaterial, 8);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < handles.count; i++) {
    const a = (i + 0.5) * Math.PI / 4, r = rimR(S, a) + 0.28;
    matrix.makeRotationY(a).setPosition(Math.sin(a) * r, 0.26, Math.cos(a) * r);
    handles.setMatrixAt(i, matrix);
  }
  handles.castShadow = true; g.add(handles);
  const sectors = new THREE.Group(); g.add(sectors);
  // грязь на плоту
  const smat = new THREE.MeshBasicMaterial({ map: splatTex(1), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const dirt = [];
  for (let i = 0; i < 22; i++) {
    const a = (i * 2.399) % (Math.PI * 2), onRing = i % 2 === 0, r = onRing ? rimR(S, a) : 0.3 + (i % 5) * 0.2 * (S.N === 3 ? 0.6 : 1);
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.22 + (i % 3) * 0.1, 12), smat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = i; m.position.set(Math.sin(a) * r, onRing ? 0.415 : -0.085, Math.cos(a) * r);
    m.visible = false; g.add(m); dirt.push(m);
  }
  if (SK.duck) {        // голова уточки спереди, хвостик сзади
    const y = std(0xffd23f, { roughness: 0.35 }), r0 = rimR(S, 0) + 0.3;
    const hd = new THREE.Group(); hd.position.set(0, 0.55, r0); g.add(hd);
    const m = (geo, mat, x, yy, z, sx, sy, sz) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, yy, z); o.scale.set(sx, sy, sz); o.castShadow = true; hd.add(o); return o; };
    m(G.ball, y, 0, -0.2, -0.1, 0.4, 0.45, 0.4); m(G.ballHi, y, 0, 0.35, 0.05, 0.42, 0.4, 0.42);
    m(G.ball, std(0xff8a1f), 0, 0.28, 0.45, 0.2, 0.08, 0.22);
    for (const sx of [-1, 1]) { m(G.ball, M.white, sx * 0.2, 0.45, 0.3, 0.09, 0.1, 0.06); m(G.ball, M.black, sx * 0.21, 0.46, 0.35, 0.05, 0.06, 0.03); }
    const tl = new THREE.Mesh(G.cone, y); const rb = rimR(S, Math.PI) + 0.2; tl.position.set(0, 0.45, -rb); tl.scale.set(0.2, 0.4, 0.2); tl.rotation.x = -0.8; g.add(tl);
  }
  g.userData = { ring, sectors, key: '', dirt, S, shape: S.id, skin: SK.id };
  return g;
}
export function setRaftDirt(raft, d) { const D = raft.userData.dirt, n = Math.round(d * D.length); D.forEach((m, i) => m.visible = i < n); }

export function setRaftSectors(raft, seats, n, half, centerFn, centerColor = null) {
  const S = raft.userData.S || shapeOf('round');
  const key = seats.map(s => s.seat + ':' + s.color).join(',') + '/' + n + '/' + centerColor;
  if (raft.userData.key === key) return;
  raft.userData.key = key;
  const grp = raft.userData.sectors;
  while (grp.children.length) { const c = grp.children.pop(); c.geometry && c.geometry.dispose(); }
  if (centerColor) {     // место пятого — кружок в центре плота
    const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.62, 32), new THREE.MeshBasicMaterial({ color: centerColor, transparent: true, opacity: 0.7, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = -0.07; grp.add(m);
  }
  if (n <= 1) return;
  for (const s of seats) {
    const c = centerFn(s.seat, n);
    let geo;
    if (!S.N) { geo = new THREE.TorusGeometry(RIM_R, 0.412, 10, 28, half * 2); geo.rotateX(-Math.PI / 2); }
    else geo = new THREE.TubeGeometry(rimCurve(S, c - half, c + half, 28, false), 40, 0.412, 10, false);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: s.color, transparent: true, opacity: 0.55, roughness: 0.4, depthWrite: false }));
    if (!S.N) m.rotation.y = (c - half) - Math.PI / 2;
    grp.add(m);
  }
  const knob = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10), km = std(0x8e2a2a, { roughness: 0.4 });
  for (let k = 0; k < n; k++) {
    const b = centerFn(k, n) + Math.PI / n, r = rimR(S, b), m = new THREE.Mesh(knob, km);
    m.position.set(Math.sin(b) * r, 0.44, Math.cos(b) * r); m.rotation.set(Math.PI / 2, b + Math.PI / 2, 0, 'YXZ'); m.castShadow = true; grp.add(m);
  }
}
