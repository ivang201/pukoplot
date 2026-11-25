// ============================================================
//  Процедурные текстуры (рисуются на canvas при загрузке, без файлов)
// ============================================================
import * as THREE from 'three';
import { THEMES } from './shared.js';

export const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

// ---------- шум
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s, period) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = (v) => ((v % period) + period) % period;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, s = 1, oct = 4, period = 8) {
  let f = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < oct; i++) { f += vnoise(x * fr, y * fr, s + i * 17, period * fr) * amp; amp *= 0.5; fr *= 2; }
  return f;
}
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true, repeat = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; return t;
}

function worldImage(kind) {
  const url = new URL(`./art/materials/world-${kind}.webp`, import.meta.url).href;
  return once(url, () => new THREE.ImageLoader().loadAsync(url).catch(() => null));
}

// Варианты UV используют один декодированный рисунок и один GPU-источник.
export function worldSurfaceTex(kind, repeatX = 1, repeatY = 1) {
  return once(`surface-${kind}-${repeatX}-${repeatY}`, () => {
    const white = once('empty-surface', () => {
      const c = canvas(1), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
      return tex(c);
    });
    const texture = white.clone();
    texture.repeat.set(repeatX, repeatY);
    worldImage(kind).then(image => {
      if (!image) return;
      texture.dispose(); // GPU-хранилище заглушки имеет размер 1×1.
      texture.source = once('surface-source-' + kind, () => new THREE.Source(image));
      texture.needsUpdate = true;
    });
    return texture;
  });
}
// карта нормалей из карты высот (Float32Array S×S)
export function normalFromHeight(hgt, S, strength = 2) {
  const c = canvas(S), x = c.getContext('2d'), img = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = hgt[j * S + ((i + 1) % S)] - hgt[j * S + ((i - 1 + S) % S)], dy = hgt[((j + 1) % S) * S + i] - hgt[((j - 1 + S) % S) * S + i];
    const nx = -dx * strength, ny = -dy * strength, l = Math.hypot(nx, ny, 1), k = (j * S + i) * 4;
    img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}
function fromFn(S, fn, seed) {     // fn(u,v) → {r,g,b,h}
  const c = canvas(S), x = c.getContext('2d'), img = x.createImageData(S, S), hgt = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const o = fn(i / S, j / S, seed), k = (j * S + i) * 4;
    img.data[k] = o.r; img.data[k + 1] = o.g; img.data[k + 2] = o.b; img.data[k + 3] = o.a ?? 255; hgt[j * S + i] = o.h ?? 0;
  }
  x.putImageData(img, 0, 0);
  return { c, hgt };
}

// ---------- дерево: волокна, сучки
export const woodTex = () => once('wood', () => {
  const S = 256;
  const { c, hgt } = fromFn(S, (u, v) => {
    const n = fbm(u * 2, v * 8, 3, 4, 2 * 4);
    const ring = Math.sin((u * 26 + n * 6) * Math.PI) * 0.5 + 0.5;
    const knot = Math.max(0, 1 - Math.hypot((u - 0.3) * 4, (v - 0.6) * 1.6)) ** 3;
    const t = 0.55 + ring * 0.25 + n * 0.2 - knot * 0.4;
    return { r: 120 + t * 70, g: 74 + t * 45, b: 38 + t * 22, h: ring * 0.6 + n * 0.4 - knot };
  }, 3);
  return { map: tex(c), normalMap: normalFromHeight(hgt, S, 2.5) };
});
// ---------- металл: шлифовка, царапины, заклёпки
export const metalTex = () => once('metal', () => {
  const S = 256;
  const { c, hgt } = fromFn(S, (u, v) => {
    const streak = fbm(u * 1, v * 40, 7, 3, 40) * 0.6 + fbm(u * 6, v * 6, 9, 3, 6) * 0.4;
    const t = 0.55 + streak * 0.4;
    return { r: 150 + t * 80, g: 158 + t * 80, b: 168 + t * 80, h: streak };
  }, 5);
  const x = c.getContext('2d');
  x.strokeStyle = 'rgba(60,60,70,0.35)'; x.lineWidth = 1;
  for (let i = 0; i < 40; i++) { const px = Math.random() * S, py = Math.random() * S; x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 50, py + (Math.random() - 0.5) * 12); x.stroke(); }
  for (let i = 0; i < 6; i++) { const px = 20 + i * 42, py = 12; for (const yy of [py, S - py]) { const g = x.createRadialGradient(px - 2, yy - 2, 1, px, yy, 7); g.addColorStop(0, '#f4f6fa'); g.addColorStop(1, '#5c6370'); x.fillStyle = g; x.beginPath(); x.arc(px, yy, 6, 0, 6.28); x.fill(); } }
  return { map: tex(c), normalMap: normalFromHeight(hgt, S, 1.2) };
});
// ---------- камень: пятнистый, с трещинами
export const rockTex = (tint = 0x6a6c76) => once('rock' + tint, () => {
  const S = 256, col = new THREE.Color(tint);
  const { c, hgt } = fromFn(S, (u, v) => {
    const n = fbm(u * 4, v * 4, 11, 5, 4);
    const crack = Math.abs(fbm(u * 3, v * 3, 23, 3, 3) - 0.5) < 0.018 ? 1 : 0;
    const t = 0.6 + n * 0.7 - crack * 0.45;
    return { r: col.r * 255 * t, g: col.g * 255 * t, b: col.b * 255 * t, h: n - crack * 0.6 };
  }, 7);
  return { map: tex(c), normalMap: normalFromHeight(hgt, S, 4) };
});
// ---------- чешуя крокодила
export const crocTex = () => once('croc', () => {
  const S = 256, cells = 10;
  const { c, hgt } = fromFn(S, (u, v) => {
    const x = u * cells, y = v * cells * 1.4, row = Math.floor(y), off = row % 2 ? 0.5 : 0;
    const fx = (x + off) % 1, fy = y % 1;
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
    const bump = Math.min(1, edge * 6);
    const n = fbm(u * 8, v * 8, 31, 3, 8);
    const t = 0.55 + bump * 0.35 + n * 0.2;
    return { r: 60 * t + 10, g: 120 * t + 15, b: 50 * t + 5, h: bump };
  }, 9);
  return { map: tex(c), normalMap: normalFromHeight(hgt, S, 3) };
});
// ---------- резина шипов (розово-фиолетовая, с кольцами)
export const rubberTex = () => once('rubber', () => {
  const S = 128;
  const { c, hgt } = fromFn(S, (u, v) => {
    const ring = Math.pow(Math.abs(Math.sin(v * Math.PI * 8)), 8);
    const n = fbm(u * 4, v * 4, 41, 3, 4);
    const t = 0.88 + n * 0.15 - ring * 0.12;
    return { r: 205 * t, g: 70 * t, b: 180 * t, h: -ring };
  }, 13);
  return { map: tex(c), normalMap: normalFromHeight(hgt, S, 1.5) };
});
// ---------- шляпка гриба с белыми пятнами
export const mushTex = () => once('mush', () => {
  const c = canvas(256, 128), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#d63a4a'); g.addColorStop(1, '#9c1f30');
  x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 18; i++) { const px = (i * 53) % 256 + Math.random() * 10, py = 15 + Math.random() * 70, r = 6 + Math.random() * 9; x.fillStyle = '#fff6ee'; x.beginPath(); x.ellipse(px, py, r, r * 0.8, 0, 0, 6.28); x.fill(); }
  return tex(c);
});
// ---------- кожа бегемота (белёсая — умножается на цвет окраса)
export const skinTex = () => once('skin', () => {
  const S = 256;
  const { c, hgt } = fromFn(S, (u, v) => {
    const n = fbm(u * 6, v * 6, 51, 4, 6), pores = hash((u * 128) | 0, (v * 128) | 0, 3) > 0.93 ? 1 : 0;
    const t = 0.86 + n * 0.22 - pores * 0.06;
    return { r: 255 * t, g: 255 * t, b: 255 * t, h: n * 0.6 - pores * 0.3 };
  }, 17);
  return { map: tex(c), normalMap: normalFromHeight(hgt, S, 1.2) };
});
// ---------- кирпич (канализация)
export const brickTex = () => once('brick', () => {
  const c = canvas(256), x = c.getContext('2d');
  x.fillStyle = '#3a332e'; x.fillRect(0, 0, 256, 256);
  const cols = ['#7a5a48', '#6b4e3e', '#86644f', '#5e4436', '#70503f'];
  for (let r = 0; r < 16; r++) for (let k = -1; k < 5; k++) {
    const bx = k * 64 + (r % 2 ? 32 : 0), by = r * 16;
    x.fillStyle = cols[(r * 7 + k * 3 + 100) % cols.length]; x.fillRect(bx + 2, by + 2, 60, 12);
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(bx + 2, by + 11, 60, 3);
  }
  for (let i = 0; i < 30; i++) { x.fillStyle = 'rgba(80,110,40,0.35)'; x.beginPath(); x.ellipse(Math.random() * 256, 200 + Math.random() * 56, 6 + Math.random() * 14, 3 + Math.random() * 5, 0, 0, 6.28); x.fill(); }
  return tex(c);
});
// Кирпичная кладка и светящиеся жилы сохраняют цвет под слоем рисованного камня.
export const cliffTex = (theme) => once('cliff' + theme, () => {
  const T = THEMES[theme] || THEMES.day;
  const c = canvas(512), x = c.getContext('2d');
  if (T.brick) {
    x.drawImage(brickTex().image, 0, 0, 512, 512);
  } else {
    let y = 0, k = 0;
    while (y < 512) {
      const h = 20 + Math.random() * 52;
      x.fillStyle = hex(T.cliff[k++ % T.cliff.length]); x.fillRect(0, y, 512, h);
      if (T.glow && Math.random() < 0.35) { x.fillStyle = '#ff7a2a'; x.fillRect(0, y + h - 3, 512, 3); }
      y += h;
    }
  }
  const texture = tex(c);
  worldImage('rock').then(image => {
    if (!image) return;
    x.globalCompositeOperation = 'multiply';
    x.globalAlpha = T.brick ? 0.65 : 0.9;
    x.drawImage(image, 0, 0, 512, 512);
    texture.needsUpdate = true;
  });
  return texture;
});
// ---------- доски пола плота
export const plankTex = () => once('plank', () => {
  const S = 256, c = canvas(S), x = c.getContext('2d');
  const cols = ['#7cc04a', '#73b843', '#82c650', '#78bd47'];
  for (let i = 0; i < 8; i++) { x.fillStyle = cols[i % 4]; x.fillRect(i * 32, 0, 32, S); }
  for (let i = 0; i < 600; i++) { x.fillStyle = `rgba(30,60,10,${Math.random() * 0.12})`; x.fillRect(Math.random() * S, Math.random() * S, 1, 6 + Math.random() * 20); }
  x.strokeStyle = 'rgba(40,80,20,0.55)'; x.lineWidth = 3;
  for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * 32, 0); x.lineTo(i * 32, S); x.stroke(); }
  for (let i = 0; i < 16; i++) { x.fillStyle = 'rgba(60,40,20,0.5)'; x.beginPath(); x.arc((i % 8) * 32 + 16, i < 8 ? 30 : 226, 2.5, 0, 6.28); x.fill(); }
  return tex(c);
});
// ---------- надувной круг (кремовая резина с швами)
export const ringTex = () => once('ring', () => {
  const c = canvas(256, 64), x = c.getContext('2d');
  x.fillStyle = '#f3d6b6'; x.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(160,110,60,${Math.random() * 0.08})`; x.fillRect(Math.random() * 256, Math.random() * 64, 2, 2); }
  x.fillStyle = 'rgba(160,110,60,0.25)'; for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 2, 64);
  return tex(c);
});
// ---------- вода
function waterArtwork(theme) {
  const T = THEMES[theme] || THEMES.day;
  const c = canvas(512), x = c.getContext('2d');
  x.fillStyle = hex(T.water); x.fillRect(0, 0, 512, 512);
  const gr = x.createLinearGradient(0, 0, 512, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.18, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,30,80,0.14)'); gr.addColorStop(0.82, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.18)');
  x.fillStyle = gr; x.fillRect(0, 0, 512, 512);
  x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineCap = 'round';
  for (let i = 0; i < 34; i++) {
    const px = 30 + Math.random() * 452, py = Math.random() * 512, L = 30 + Math.random() * 90, wv = (Math.random() - 0.5) * 18;
    x.lineWidth = 1.2 + Math.random() * 2.2;
    for (const off of [0, -512, 512]) { x.beginPath(); x.moveTo(px, py + off); x.bezierCurveTo(px + wv, py + off + L * 0.33, px - wv, py + off + L * 0.66, px + wv * 0.5, py + off + L); x.stroke(); }
  }
  const map = tex(c, { aniso: 8 });
  const pixels = once('water-art-pixels', () => worldImage('water').then(image => {
    if (!image) return null;
    const src = canvas(512).getContext('2d');
    src.drawImage(image, 0, 0, 512, 512);
    return src.getImageData(0, 0, 512, 512).data;
  }));
  const ready = pixels.then(source => {
    if (!source) return;
    // Глубина, основной тон и светлая пена сохраняют характер воды в каждой теме.
    const palette = new Uint8ClampedArray(256 * 3);
    const deep = new THREE.Color(T.deep), water = new THREE.Color(T.water);
    const crest = water.clone().lerp(new THREE.Color(0xf1fff7), T.stars || T.brick ? 0.16 : 0.42);
    const tint = new THREE.Color();
    for (let value = 0; value < 256; value++) {
      if (value < 174) tint.lerpColors(deep, water, THREE.MathUtils.clamp((value - 130) / 44, 0, 1));
      else tint.lerpColors(water, crest, THREE.MathUtils.smoothstep(value, 174, 251));
      tint.convertLinearToSRGB();
      palette[value * 3] = tint.r * 255;
      palette[value * 3 + 1] = tint.g * 255;
      palette[value * 3 + 2] = tint.b * 255;
    }
    const out = x.createImageData(512, 512);
    for (let i = 0; i < source.length; i += 4) {
      const shade = source[i] * 3;
      out.data[i] = palette[shade]; out.data[i + 1] = palette[shade + 1];
      out.data[i + 2] = palette[shade + 2]; out.data[i + 3] = 255;
    }
    x.putImageData(out, 0, 0);
  });
  return { map, ready };
}

export function waterTex(theme, repeatX = 1, repeatY = 1) {
  const art = once('water' + theme, () => waterArtwork(theme));
  const map = art.map.clone();
  map.repeat.set(repeatX, repeatY);
  art.ready.then(() => { map.needsUpdate = true; });
  return map;
}
export const waterNormal = () => once('wnorm', () => {
  const S = 256, hgt = new Float32Array(S * S);
  const waves = []; for (let i = 0; i < 14; i++) waves.push([Math.floor(Math.random() * 6 + 1), Math.floor(Math.random() * 6 + 1), Math.random() * 6.28, 0.5 + Math.random()]);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { let h = 0; for (const [a, b, p, w] of waves) h += Math.sin((i * a + j * b) / S * Math.PI * 2 + p) * w; hgt[j * S + i] = h; }
  return normalFromHeight(hgt, S, 0.6);
});
export const foamTex = () => once('foam', () => {
  const c = canvas(64, 256), x = c.getContext('2d');
  for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`; x.beginPath(); x.ellipse(Math.random() * 40, Math.random() * 256, 2 + Math.random() * 6, 3 + Math.random() * 9, 0, 0, 6.28); x.fill(); }
  const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  return tex(c, { srgb: false });
});
export function stripeTex(a, b, n = 8, vertical = false) {
  return once(`stripe${a}${b}${n}${vertical}`, () => {
    const c = canvas(64), x = c.getContext('2d');
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? b : a; vertical ? x.fillRect(i * 64 / n, 0, 64 / n, 64) : x.fillRect(0, i * 64 / n, 64, 64 / n); }
    return tex(c);
  });
}
export const hazardTex = () => once('hazard', () => {
  const c = canvas(64), x = c.getContext('2d'); x.fillStyle = '#ffc21a'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#222'; for (let i = -64; i < 128; i += 22) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 11, 0); x.lineTo(i + 75, 64); x.lineTo(i + 64, 64); x.closePath(); x.fill(); }
  for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(60,40,20,${Math.random() * 0.25})`; x.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
  return tex(c);
});
export function bannerTex(text, bg = '#ff5a3c', fg = '#fff', checker = false) {
  const c = canvas(512, 96), x = c.getContext('2d');
  if (checker) { for (let i = 0; i < 32; i++) for (let j = 0; j < 6; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 16, j * 16, 16, 16); } }
  else { x.fillStyle = bg; x.fillRect(0, 0, 512, 96); x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 0, 512, 10); x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, 86, 512, 10); }
  x.font = 'bold 54px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,.6)'; x.strokeText(text, 256, 50); x.fillStyle = fg; x.fillText(text, 256, 50);
  return tex(c, { repeat: false });
}

// У каждой арки своя табличка, включая номер контрольной точки в бесконечном режиме.
export function gateSignTex(text, kind) {
  const c = canvas(768, 128), ctx = c.getContext('2d');
  const ink = '#123b42', cream = '#fff1cc', gold = '#f7bc59';
  const paper = kind === 'checkpoint' ? cream : kind === 'start' ? '#096258' : ink;
  const type = kind === 'checkpoint' ? ink : cream;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, c.width, c.height);

  for (const offset of [0, c.width - 84]) {
    ctx.save();
    ctx.translate(offset, 0);
    ctx.beginPath();
    ctx.rect(0, 0, 84, c.height);
    ctx.clip();
    ctx.fillStyle = cream;
    ctx.fillRect(0, 0, 84, c.height);
    if (kind === 'finish') {
      ctx.fillStyle = ink;
      for (let row = 0; row < 6; row++) for (let col = row % 2; col < 4; col += 2) {
        ctx.fillRect(col * 21, row * 24, 21, 24);
      }
    } else {
      ctx.fillStyle = kind === 'checkpoint' ? '#db6342' : '#218579';
      for (let x = -128; x < 84; x += 46) {
        ctx.beginPath();
        ctx.moveTo(x, 128); ctx.lineTo(x + 23, 128);
        ctx.lineTo(x + 89, 0); ctx.lineTo(x + 66, 0);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
  // Латунный кант и тонкие линии оставляют середину поля свободной для надписи.
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 768, 6); ctx.fillRect(0, 122, 768, 6);
  ctx.fillStyle = gold;
  ctx.fillRect(0, 6, 768, 3); ctx.fillRect(0, 119, 768, 3);
  for (const x of [84, 680]) ctx.fillRect(x, 9, 4, 110);
  ctx.fillStyle = type;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 78px "Arial Black", Arial, sans-serif';
  ctx.fillText(text, 384, 69, 568);
  return tex(c, { repeat: false });
}
export const swirlTex = () => once('swirl', () => {
  const c = canvas(256), x = c.getContext('2d'); x.translate(128, 128);
  const gr = x.createRadialGradient(0, 0, 0, 0, 0, 128); gr.addColorStop(0, 'rgba(5,40,90,0.7)'); gr.addColorStop(0.7, 'rgba(10,60,120,0.25)'); gr.addColorStop(1, 'rgba(10,60,120,0)');
  x.fillStyle = gr; x.beginPath(); x.arc(0, 0, 128, 0, 6.28); x.fill();
  for (let k = 0; k < 5; k++) { x.beginPath(); for (let t = 0; t < 1; t += 0.01) { const a = k * Math.PI * 2 / 5 + t * 5, r = t * 118; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 7; x.stroke(); }
  return tex(c, { repeat: false });
});
export const arrowTex = () => {
  const c = canvas(64, 128), x = c.getContext('2d'); x.fillStyle = 'rgba(255,220,40,0.95)';
  for (let k = 0; k < 2; k++) { const y = k * 64; x.beginPath(); x.moveTo(6, y + 50); x.lineTo(32, y + 14); x.lineTo(58, y + 50); x.lineTo(46, y + 58); x.lineTo(32, y + 38); x.lineTo(18, y + 58); x.closePath(); x.fill(); }
  return tex(c, { srgb: false });
};
// ---------- коричневые кляксы (лужи, следы, грязь)
export const splatTex = (k = 0) => once('splat' + k, () => {
  const S = 128, c = canvas(S), x = c.getContext('2d');
  const rnd = (() => { let s = 1234 + k * 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.28, r = 10 + rnd() * 26, px = 64 + Math.cos(a) * rnd() * 26, py = 64 + Math.sin(a) * rnd() * 26;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(105,66,28,0.95)'); g.addColorStop(0.7, 'rgba(92,57,22,0.85)'); g.addColorStop(1, 'rgba(85,52,18,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, 6.28); x.fill();
  }
  for (let i = 0; i < 10; i++) { const a = rnd() * 6.28, d = 40 + rnd() * 20; x.fillStyle = 'rgba(95,58,22,0.9)'; x.beginPath(); x.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + rnd() * 4, 0, 6.28); x.fill(); }
  return tex(c, { repeat: false });
});

// ---------- узоры кожи для окрасов из подарков (цветные, материал белый)
export const bodyPatTex = (pat) => once('bpat' + pat, () => {
  const S = 256, c = canvas(S), x = c.getContext('2d');
  let glow = null;
  const rnd = (() => { let s = 1234 + pat.length * 77; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const blob = (cx, cy, r, col) => { x.fillStyle = col; x.beginPath(); for (let k = 0; k <= 16; k++) { const a = k / 16 * Math.PI * 2, rr = r * (0.7 + rnd() * 0.5); x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.fill(); };
  const wrapBlob = (cx, cy, r, col) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) blob(cx + dx, cy + dy, r, col); };
  if (pat === 'zebra') {
    x.fillStyle = '#f2f2f2'; x.fillRect(0, 0, S, S); x.fillStyle = '#1c1c22';
    for (let i = 0; i < 9; i++) { const y0 = i * S / 9; x.beginPath(); x.moveTo(0, y0); for (let u = 0; u <= S; u += 8) x.lineTo(u, y0 + Math.sin(u / 26 + i) * 7); for (let u = S; u >= 0; u -= 8) x.lineTo(u, y0 + 11 + Math.sin(u / 21 + i * 2) * 5); x.fill(); }
  } else if (pat === 'cow') {
    x.fillStyle = '#f4f0e6'; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) wrapBlob(rnd() * S, rnd() * S, 18 + rnd() * 22, '#22201e');
  } else if (pat === 'camo') {
    x.fillStyle = '#7d8c5c'; x.fillRect(0, 0, S, S);
    for (const col of ['#5a6a3c', '#a39568', '#3c4630']) for (let i = 0; i < 12; i++) wrapBlob(rnd() * S, rnd() * S, 12 + rnd() * 18, col);
  } else if (pat === 'galaxy') {
    const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#1a1440'); g.addColorStop(0.5, '#3a1f66'); g.addColorStop(1, '#14204a');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    for (let i = 0; i < 7; i++) { const r = x.createRadialGradient(rnd() * S, rnd() * S, 2, rnd() * S, rnd() * S, 60); r.addColorStop(0, `rgba(${180 + rnd() * 70 | 0},90,220,0.35)`); r.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = r; x.fillRect(0, 0, S, S); }
    const gc = canvas(S), gx = gc.getContext('2d'); gx.fillStyle = '#000'; gx.fillRect(0, 0, S, S);
    for (let i = 0; i < 140; i++) { const px = rnd() * S, py = rnd() * S, r = rnd() < 0.1 ? 2.2 : 1; for (const ctx of [x, gx]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, r, 0, 6.28); ctx.fill(); } }
    glow = tex(gc);
  } else if (pat === 'lava') {
    x.fillStyle = '#2e1f1b'; x.fillRect(0, 0, S, S);
    const gc = canvas(S), gx = gc.getContext('2d'); gx.fillStyle = '#000'; gx.fillRect(0, 0, S, S);
    for (const ctx of [x, gx]) { ctx.strokeStyle = '#ff7a1a'; ctx.lineCap = 'round'; }
    for (let i = 0; i < 26; i++) {
      let px = rnd() * S, py = rnd() * S; const w = 2 + rnd() * 3;
      const pts = [[px, py]]; for (let k = 0; k < 6; k++) { px += (rnd() - 0.5) * 50; py += (rnd() - 0.5) * 50; pts.push([px, py]); }
      for (const ctx of [x, gx]) { ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([a, b], k) => k ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.stroke(); }
    }
    glow = tex(gc);
  }
  return { map: tex(c), glow };
});
// ---------- раскраска надувной кромки
export const ringSkinTex = (sk) => once('rsk' + sk.id, () => {
  const c = canvas(256, 64), x = c.getContext('2d');
  x.fillStyle = sk.a; x.fillRect(0, 0, 256, 64);
  if (sk.pat === 'stripes') { x.fillStyle = sk.b; for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 14, 64); }
  if (sk.pat === 'spots') { x.fillStyle = sk.b; for (let i = 0; i < 40; i++) { x.beginPath(); x.ellipse(Math.random() * 256, Math.random() * 64, 6 + Math.random() * 9, 4 + Math.random() * 5, Math.random() * 3, 0, 6.28); x.fill(); } }
  if (sk.pat === 'sprinkles') {
    x.fillStyle = '#d99a5a'; x.fillRect(0, 44, 256, 20);
    const cols = ['#ffffff', '#3d8fe0', '#ffd23f', '#4fb35f', '#e8456b'];
    for (let i = 0; i < 160; i++) { x.save(); x.translate(Math.random() * 256, Math.random() * 42); x.rotate(Math.random() * 3); x.fillStyle = cols[i % cols.length]; x.fillRect(-3, -1, 6, 2); x.restore(); }
  }
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; x.fillRect(Math.random() * 256, Math.random() * 64, 2, 2); }
  x.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 8; i++) x.fillRect(i * 32, 0, 2, 64);
  return tex(c);
});
