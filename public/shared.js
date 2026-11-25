// ============================================================
//  ПУКОПЛОТ — общий модуль (сервер + браузер)
//  Трассы, препятствия, геометрия, физические константы.
// ============================================================

export const VERSION = 2;
export const RAFT_R = 1.9;       // радиус плота для столкновений
export const RIM_R = 1.55;       // радиус кромки, на которой сидят бегемоты
export const MAX_PLAYERS = 5;      // четверо на кромке + пятый в центре плота
export const RIM_SEATS = 4;
export const CENTER_SEAT = 4;      // пятый бегемот сидит посередине и крутится как хочет
export const rimCount = (n) => Math.min(n, RIM_SEATS);
export const isCenter = (seat) => seat === CENTER_SEAT;
export const SLOPE = 0.035;

// Майки. Свой принт: public/shirts/1.png … 4.png
export const SKINS = [
  { name: 'Чёрная',    shirt: 0x1c1e24, print: 0xffffff, emblem: 'flame', css: '#23262e' },
  { name: 'Оранжевая', shirt: 0xff6a13, print: 0xffffff, emblem: 'puk',   css: '#ff6a13' },
  { name: 'Белая',     shirt: 0xf2efe8, print: 0xd62828, emblem: 'star',  css: '#f2efe8' },
  { name: 'Красная',   shirt: 0xc8102e, print: 0xffd23f, emblem: 'bolt',  css: '#c8102e' },
  { name: 'Синяя',     shirt: 0x1f5fd1, print: 0xffffff, emblem: 'drop',  css: '#1f5fd1' },
  { name: 'Зелёная',   shirt: 0x2f9e44, print: 0xfff3c4, emblem: 'swirl', css: '#2f9e44' },
  { name: 'Жёлтая',    shirt: 0xf5c518, print: 0x1a2238, emblem: 'wave',  css: '#f5c518' },
  { name: 'Фиолетовая', shirt: 0x7a3fc2, print: 0xffe066, emblem: 'paw',  css: '#7a3fc2' },
];
export const HIPPO = { body: 0x7b838f, belly: 0x9aa2ad, dark: 0x4e555f, snout: 0x8c939e };

export const DT = 1 / 60;
export const PHYS = {
  waterDrag: 0.48,        // 1/с, сопротивление на малой скорости
  waveDrag: 0.065,        // 1/м, волновое сопротивление растёт с квадратом скорости
  angDrag: 1.15,
  inertia: 1.4,
  thrust: 6.6,            // тяга одного пука
  burstMult: 2.35,        // короткий стартовый толчок
  burstTime: 0.18,
  crawlSpeed: 2.3,        // скорость перебирания руками по кромке (рад/с)
  crawlReact: 0.10,       // плот чуть проворачивается в обратную сторону
  leanMax: 0.47,          // наклон при движении → закрутка (рад)
  gasDrain: 0.17, gasRegen: 0.2, gasRegenDelay: 0.35,   // полный газ ≈ 6 с: перегрев (≈4 с) теперь достижим раньше щелчка
  heatRise: 0.24, heatStart: 0.05, heatCool: 0.42, overheatTime: 2.2,
  sprayGas: 0.085,        // за ~0.5 с до конца газа начинаются брызги, на нуле — «щелчок»
  shitStun: 1.8,
  ejectSoft: 8.5,         // скорость удара о мягкий бортик, после которой летят за борт
  ejectHard: 5.8,         // то же для камней и железа
  smashSpeed: 12.5,       // удар такой силы о камень — плот разбивается
  offTime: 3.2,           // сколько бегемот плывёт обратно
  maxSpeed: 14, maxSpin: 7.2, // м/с, рад/с («Карусель» открывается при 6 рад/с)
  wallBounce: 0.70,
  syncWindow: 0.3, syncTime: 1.3,
  puddleR: 2.4, puddleTime: 10,
  // холостой с жидким: вместо реактивного пука — обделался и ненадолго отключился
  misfireFaint: 1.6,
  // облака вони: коричневый газ, попавший в лицо, вырубает на faintTime секунд (настраивается)
  blobEvery: 0.12, blobLife: 2.6, blobR0: 0.7, blobR1: 2.3, faintCooldown: 4,
  burpPerSec: 1 / 75,
  centerSpin: 3.2,
  // Щелчок: стрельба калом
  shotCost: 0.12, shotEvery: 0.55, shotHeat: 0.07, shotKick: 1.3, shotSpeed: 15, shotLife: 1.1, shotHitR: 0.85, shotFaint: 2.2,        // скорость поворота центрального бегемота (рад/с)
  spikeReach: 0.7,        // насколько шипы на стенах торчат внутрь русла
  spikePad: 0.3,          // то же для шипастых препятствий (визуальные шипы длиннее тела)      // в среднем раз в 75 с — редкая отрыжка
};

// Центровой целится прямо. Струя с борта качается, а ход по ободу задаёт
// более сильный постоянный наклон. Фаза берётся из общих часов симуляции.
function jetCant(h, time, center = false) {
  if (center) return 0;
  const steering = Math.max(-PHYS.leanMax, Math.min(PHYS.leanMax, -h.vel * 0.22));
  return steering + 0.18 * Math.sin(time * 9 + h.seat * 2.15);
}

export function addRaftJet(r, h, time, force, theta, arm) {
  const cant = jetCant(h, time, arm === 0), angle = theta + Math.PI + cant;
  r.fx += Math.sin(angle) * force; r.fz += Math.cos(angle) * force;
  r.tq -= arm * force * Math.sin(cant);
  r.totalThrust += force;
}

export function limitRaftSpeed(r) {
  const speed2 = r.vx * r.vx + r.vz * r.vz;
  if (speed2 > PHYS.maxSpeed * PHYS.maxSpeed) {
    const k = PHYS.maxSpeed / Math.sqrt(speed2);
    r.vx *= k; r.vz *= k;
  }
  r.w = Math.max(-PHYS.maxSpin, Math.min(PHYS.maxSpin, r.w));
}

// X/Z — мировые метры; a растёт от +Z к +X. Снос измеряется относительно
// воды и суммарной тяги: у круглого плота нет фиксированного носа.
export function moveRaft(r, shape, time, waterScale, flowX = 0, flowZ = 0, sticky = false) {
  const vx = r.vx - flowX, vz = r.vz - flowZ;
  let fx = r.fx, fz = r.fz, torque = r.tq;
  const drive = Math.hypot(fx, fz), power = Math.min(1, drive / PHYS.thrust);
  const drag = (PHYS.waterDrag + PHYS.waveDrag * Math.hypot(vx, vz) + 0.14 * power) * shape.drag * waterScale;
  // Встречные струи раскачивают плот попеременно влево и вправо.
  // Сонаправленная команда отдаёт всю тягу в разгон.
  const opposed = r.totalThrust - drive;
  if (opposed > 0.001) torque += opposed * 0.95 * Math.sin(time * 5.4);
  if (drive > 0.001) {
    const rightX = fz / drive, rightZ = -fx / drive;
    const slip = vx * rightX + vz * rightZ;
    // При смене курса часть бокового скольжения переходит во вращение.
    const skid = Math.min(1, Math.abs(slip) / 2.5);
    torque -= skid * slip * Math.min(drive, 2 * PHYS.thrust) * 0.105;
    const grip = slip * power * 0.33 * shape.drag * waterScale;
    fx -= rightX * grip; fz -= rightZ * grip;
  }
  r.vx += (fx - vx * drag) * DT; r.vz += (fz - vz * drag) * DT;
  r.w += torque / (PHYS.inertia * shape.inertia) * DT;
  r.w *= Math.exp(-(PHYS.angDrag * shape.angDrag + Math.abs(r.w) * 0.16) * DT);
  if (sticky) {
    const brake = Math.exp(-2.2 * DT);
    r.vx *= brake; r.vz *= brake; r.w *= brake;
  }
  limitRaftSpeed(r);
  r.x += r.vx * DT; r.z += r.vz * DT; r.a = wrapAngle(r.a + r.w * DT);
}

// Касательная скорость самой точки контакта включает вращение плота.
export function bounceRaft(r, shape, nx, nz, obstacleVx, obstacleVz, restitution, vn) {
  const arm = supportDir(shape, r.a, -nx, -nz), inertia = PHYS.inertia * shape.inertia;
  const slip = (r.vx - obstacleVx) * nz - (r.vz - obstacleVz) * nx - arm * r.w;
  const friction = -0.76 * slip / (1 + arm * arm / inertia);
  r.vx += -(1 + restitution) * vn * nx + friction * nz;
  r.vz += -(1 + restitution) * vn * nz - friction * nx;
  r.w -= arm * friction / inertia;
  limitRaftSpeed(r);
}

export function kickRaft(r, shape, h, time, kick, center = false) {
  const cant = jetCant(h, time, center), angle = r.a + h.pos + cant;
  r.vx -= Math.sin(angle) * kick; r.vz -= Math.cos(angle) * kick;
  if (!center) r.w -= Math.sin(cant) * rimR(shape, h.pos) * kick / (PHYS.inertia * shape.inertia);
  limitRaftSpeed(r);
}

// Правила заезда (меняет хост)
export const DEFAULT_RULES = { faint: true, faintTime: 3, misfire: 0.015, burps: true, lives: 5, raft: 'round', pickups: true, perks: true, ult: true };
export const MISFIRE_LEVELS = [{ v: 0, name: 'Выкл' }, { v: 0.015, name: 'Редко' }, { v: 0.05, name: 'Часто' }];

// Сектора кромки: на N бегемотов — N равных частей
// ------------------------------------------------------------
//  Формы плота. rim — где сидят бегемоты (расстояние от центра по направлению),
//  hull — внешний контур для столкновений (= rim + толщина борта).
//  Круглый — золотая середина; квадратный — устойчивый и тяжёлый; треугольный — юркий и вертлявый.
// ------------------------------------------------------------
export const RAFT_SHAPES = {
  round:  { id: 'round', name: 'Круглый', icon: '⭕', desc: 'Золотая середина: ровно крутится, ровно плывёт.', N: 0, ap: RIM_R, inertia: 1, angDrag: 1, drag: 1, eject: 1 },
  square: { id: 'square', name: 'Квадратный', icon: '⬜', desc: 'Тяжёлый и устойчивый: почти не крутится, с него труднее вылететь, но он медленнее. Вчетвером — по бегемоту на сторону.', N: 4, ap: 1.32, cut: 1.75, mid0: 0, inertia: 1.55, angDrag: 1.45, drag: 1.12, eject: 1.18 },
  tri:    { id: 'tri', name: 'Треугольный', icon: '🔺', desc: 'Юркий и быстрый, но вертится от любого пука, а острые углы цепляют всё подряд. Втроём — по бегемоту на сторону.', N: 3, ap: 1.02, cut: 1.85, mid0: Math.PI, inertia: 0.72, angDrag: 0.8, drag: 0.86, eject: 0.9 },
};
export const RAFT_SHAPE_IDS = Object.keys(RAFT_SHAPES);
export const shapeOf = (id) => RAFT_SHAPES[id] || RAFT_SHAPES.round;
const HULL_PAD = 0.35;          // RAFT_R - RIM_R
// радиус кромки в направлении th (в осях плота)
export function rimR(S, th) {
  if (!S.N) return RIM_R;
  const step = Math.PI * 2 / S.N;
  let d = (th - S.mid0) % step; if (d < 0) d += step; if (d > step / 2) d -= step;
  return Math.min(S.cut, S.ap / Math.cos(d));
}
// опорная функция корпуса: насколько плот выступает в направлении phi (в осях плота)
const SUPPORT = new Map();
export function hullSupport(S, phi) {
  if (!S.N) return RAFT_R;
  let tab = SUPPORT.get(S.id);
  if (!tab) {
    tab = new Float32Array(360);
    for (let k = 0; k < 360; k++) { const ph = k * Math.PI / 180; let mx = 0; for (let j = 0; j < 360; j++) { const th = j * Math.PI / 180, v = (rimR(S, th) + HULL_PAD) * Math.cos(th - ph); if (v > mx) mx = v; } tab[k] = mx; }
    SUPPORT.set(S.id, tab);
  }
  let k = Math.round(phi * 180 / Math.PI) % 360; if (k < 0) k += 360;
  return tab[k];
}
// опора в мировом направлении (dx, dz) для плота с поворотом a
export const supportDir = (S, a, dx, dz) => S.N ? hullSupport(S, Math.atan2(dx, dz) - a) : RAFT_R;

export function sectorCenter(k, n) { return Math.PI + k * (Math.PI * 2) / Math.max(1, n); }
export function sectorHalf(n) { return n <= 1 ? Math.PI : Math.PI / n - 0.1; }

// ------------------------------------------------------------
//  Трассы
//  segs: [длина, поворот°, ширина в конце]; side: +1 левая стенка (для камеры), -1 правая
// ------------------------------------------------------------
export const LEVELS = [
  {
    name: 'Тёплый ручеёк', desc: 'Разминка: буйки, брёвна, камни. Учимся пукать вместе.',
    theme: 'day', current: 2.3, startW: 13,
    segs: [[30, 0, 13], [35, 40, 12], [25, 0, 12], [40, -60, 11], [30, 0, 9], [30, 30, 11], [40, 0, 12], [30, -30, 8], [25, 0, 10], [30, 0, 12]],
    checkpoints: [40, 95, 160, 205, 262],
    spikes: [{ s0: 196, s1: 222, side: 1 }],
    gaps: [],
    obstacles: [
      { type: 'buoy', s: 52, d: 0, r: 1.1 },
      { type: 'buoy', s: 72, d: -3.2, r: 0.9 },
      { type: 'buoy', s: 82, d: 3.0, r: 0.9 },
      { type: 'rock', s: 102, d: 3.6, r: 1.6 },
      { type: 'log', s: 118, d: 0, amp: 2.6, per: 4.2, ph: 0, len: 4.5, r: 0.55 },
      { type: 'log', s: 140, d: 0, amp: 2.4, per: 3.6, ph: 2.0, len: 4.0, r: 0.55 },
      { type: 'spin', s: 178, d: 0, len: 3.9, spd: 0.9, arms: 2, r: 0.45, spike: false, ph: 0 },
      { type: 'whirl', s: 232, d: -1.5, r: 3.6, str: 1.0 },
      { type: 'mush', s: 250, d: 2.6, r: 1.2 },
      { type: 'boost', s: 275, d: 0, len: 7, wid: 4 },
      { type: 'buoy', s: 292, d: 2.5, r: 0.9 },
    ],
  },
  {
    name: 'Каменный порог', desc: 'Камни, пилы и поршни. Тут летают за борт.',
    theme: 'day', current: 2.4, startW: 12,
    segs: [[25, 0, 12], [30, 30, 11], [30, 0, 11], [30, -45, 12], [35, 0, 10], [30, 40, 11], [30, 0, 12], [35, -35, 10], [30, 0, 11], [30, 0, 12]],
    checkpoints: [60, 118, 170, 215, 270],
    spikes: [{ s0: 60, s1: 88, side: -1 }, { s0: 120, s1: 150, side: 1 }, { s0: 198, s1: 240, side: -1 }, { s0: 252, s1: 276, side: 1 }],
    gaps: [],
    obstacles: [
      { type: 'rock', s: 34, d: -3.0, r: 1.5 },
      { type: 'rock', s: 47, d: 3.2, r: 1.4 },
      { type: 'mush', s: 72, d: 2.3, r: 1.3 },
      { type: 'piston', s: 95, side: 1, len: 5.0, per: 3.2, ph: 0, wid: 2.0 },
      { type: 'piston', s: 107, side: -1, len: 5.0, per: 3.2, ph: 0.5, wid: 2.0 },
      { type: 'saw', s: 132, d: 0, amp: 3.0, per: 3.0, ph: 0, r: 0.9 },
      { type: 'rock', s: 150, d: 2.8, r: 1.3 },
      { type: 'rock', s: 159, d: -2.6, r: 1.3 },
      { type: 'door', s: 186, hole: 6.8, amp: 2.0, per: 4.5, ph: 0 },
      { type: 'piston', s: 226, side: 1, len: 5.0, per: 2.8, ph: 0.2, wid: 2.0 },
      { type: 'mush', s: 258, d: -2.5, r: 1.2 },
      { type: 'saw', s: 285, d: 0, amp: 3.0, per: 3.4, ph: 0.4, r: 0.9 },
      { type: 'boost', s: 296, d: 0, len: 6, wid: 4 },
    ],
  },
  {
    name: 'Шипастое ущелье', desc: 'Шипы, топоры-маятники и обрыв. Дружба трещит.',
    theme: 'day', current: 2.5, startW: 12,
    segs: [[25, 0, 12], [30, -35, 11], [30, 0, 10], [35, 50, 10], [30, 0, 8], [30, -40, 11], [40, 0, 12], [30, 60, 10], [30, 0, 9], [35, -30, 11], [30, 0, 12], [30, 0, 12]],
    checkpoints: [58, 98, 115, 172, 245, 290, 335],
    spikes: [{ s0: 28, s1: 55, side: -1 }, { s0: 85, s1: 120, side: 1 }, { s0: 136, s1: 152, side: -1 }, { s0: 152, s1: 175, side: 1 },
             { s0: 215, s1: 245, side: -1 }, { s0: 250, s1: 280, side: 1 }, { s0: 285, s1: 315, side: -1 }],
    gaps: [{ s0: 180, s1: 210, side: 1 }],
    obstacles: [
      { type: 'rock', s: 40, d: 2.5, r: 1.7 },
      { type: 'spin', s: 72, d: -2.9, len: 2.4, spd: 0.8, arms: 4, r: 0.45, spike: true, ph: 0.4 },
      { type: 'axe', s: 92, amp: 3.0, per: 4.0, ph: 0, r: 0.7 },
      { type: 'ball', s: 105, d: 0, amp: 3.0, per: 3.2, ph: 0, r: 0.8 },
      { type: 'ball', s: 128, d: 0, amp: 2.5, per: 3.8, ph: Math.PI, r: 0.8 },
      { type: 'arc', s: 142, side: 1, R: 3.2, span: 2.0, spd: 1.0, ph: 0, r: 0.4 },
      { type: 'log', s: 160, d: 0, amp: 2.2, per: 3.4, ph: 1.0, len: 4.5, r: 0.55 },
      { type: 'whirl', s: 195, d: 0.5, r: 4.0, str: 1.3 },
      { type: 'door', s: 232, hole: 6.6, amp: 2.0, per: 5.0, ph: 0 },
      { type: 'spin', s: 268, d: 2.7, len: 2.1, spd: -1.0, arms: 2, r: 0.45, spike: true, ph: 0 },
      { type: 'rock', s: 302, d: -2.8, r: 1.4 },
      { type: 'axe', s: 320, amp: 3.2, per: 3.8, ph: 1.2, r: 0.7 },
      { type: 'boost', s: 345, d: 0, len: 8, wid: 4 },
    ],
  },
  {
    name: 'Крокодилья заводь', desc: 'Крокодилы кусаются, валуны катятся. Не зевайте.',
    theme: 'swamp', current: 2.4, startW: 13,
    segs: [[25, 0, 13], [30, -40, 12], [30, 0, 11], [35, 50, 12], [30, 0, 10], [30, -30, 12], [35, 0, 11], [30, 45, 10], [30, 0, 12], [30, -35, 11], [30, 0, 12], [25, 0, 12]],
    checkpoints: [30, 85, 145, 195, 250, 312],
    spikes: [{ s0: 55, s1: 82, side: 1 }, { s0: 120, s1: 142, side: -1 }, { s0: 215, s1: 245, side: 1 }, { s0: 320, s1: 340, side: -1 }],
    gaps: [{ s0: 165, s1: 190, side: -1 }],
    obstacles: [
      { type: 'croc', s: 45, d: 3.0, per: 3.0, ph: 0 },
      { type: 'croc', s: 70, d: -3.0, per: 3.0, ph: 0.5 },
      { type: 'boulder', s: 102, per: 5.0, ph: 0, r: 1.4, dir: 1 },
      { type: 'whirl', s: 130, d: 1.5, r: 3.6, str: 1.2 },
      { type: 'saw', s: 158, d: 0, amp: 3.0, per: 3.2, ph: 0, r: 0.9 },
      { type: 'croc', s: 205, d: 3.2, per: 2.6, ph: 0.2 },
      { type: 'door', s: 230, hole: 7.0, amp: 1.5, per: 4.0, ph: 0, spike: true },
      { type: 'boulder', s: 263, per: 4.4, ph: 0.3, r: 1.3, dir: -1 },
      { type: 'croc', s: 290, d: -3.0, per: 2.4, ph: 0 },
      { type: 'croc', s: 300, d: 3.0, per: 2.4, ph: 0.5 },
      { type: 'mush', s: 325, d: -2.4, r: 1.2 },
      { type: 'boost', s: 345, d: 0, len: 7, wid: 4 },
    ],
  },
  {
    name: 'Бурлящий хаос', desc: 'Всё сразу. Выбирайте друзей осторожно.',
    theme: 'sunset', current: 2.7, startW: 12,
    segs: [[25, 0, 12], [30, 45, 11], [25, 0, 9], [30, -60, 10], [30, 0, 8], [25, 0, 12], [35, 70, 11], [30, 0, 10], [35, -45, 9], [30, 0, 12],
           [30, 50, 10], [30, 0, 8], [30, -40, 11], [35, 0, 12], [25, 0, 12]],
    checkpoints: [35, 88, 109, 135, 195, 250, 292, 365, 410],
    spikes: [{ s0: 25, s1: 55, side: 1 }, { s0: 55, s1: 80, side: -1 }, { s0: 80, s1: 110, side: 1 }, { s0: 110, s1: 140, side: -1 },
             { s0: 165, s1: 200, side: 1 }, { s0: 230, s1: 260, side: -1 }, { s0: 260, s1: 300, side: 1 }, { s0: 340, s1: 370, side: -1 }, { s0: 370, s1: 400, side: 1 }],
    gaps: [{ s0: 142, s1: 162, side: -1 }, { s0: 205, s1: 228, side: -1 }, { s0: 305, s1: 330, side: -1 }],
    obstacles: [
      { type: 'spin', s: 45, d: -2.8, len: 2.6, spd: 1.0, arms: 4, r: 0.45, spike: true, ph: 0 },
      { type: 'door', s: 70, hole: 6.8, amp: 1.4, per: 4.0, ph: 0, spike: true },
      { type: 'ball', s: 95, d: 0, amp: 3.0, per: 2.8, ph: 0, r: 0.8 },
      { type: 'ball', s: 102, d: 0, amp: 3.0, per: 2.8, ph: Math.PI, r: 0.8 },
      { type: 'axe', s: 116, amp: 2.9, per: 3.6, ph: 0.5, r: 0.7 },
      { type: 'log', s: 126, d: 0, amp: 2.6, per: 3.0, ph: 0, len: 4.5, r: 0.55 },
      { type: 'whirl', s: 150, d: 1.5, r: 3.8, str: 1.5 },
      { type: 'spin', s: 182, d: 2.8, len: 2.6, spd: -0.9, arms: 3, r: 0.45, spike: true, ph: 0 },
      { type: 'rock', s: 215, d: 2.5, r: 1.5 },
      { type: 'door', s: 240, hole: 6.4, amp: 1.4, per: 4.4, ph: 1.5 },
      { type: 'piston', s: 260, side: 1, len: 4.5, per: 3.0, ph: 0, wid: 2.0 },
      { type: 'spin', s: 278, d: -2.9, len: 2.3, spd: 1.1, arms: 2, r: 0.45, spike: true, ph: 1.0 },
      { type: 'whirl', s: 318, d: 2.0, r: 3.5, str: 1.6 },
      { type: 'croc', s: 340, d: -3.0, per: 2.6, ph: 0 },
      { type: 'ball', s: 352, d: 0, amp: 3.0, per: 3.4, ph: 0, r: 0.9 },
      { type: 'spin', s: 385, d: 2.8, len: 2.6, spd: 0.8, arms: 4, r: 0.45, spike: true, ph: 0.6 },
      { type: 'boulder', s: 400, per: 4.6, ph: 0, r: 1.3, dir: 1 },
      { type: 'boost', s: 420, d: 0, len: 8, wid: 4 },
    ],
  },
];

export const THEMES = {
  day:    { sky: [0x54afbc, 0xffe6bc], fog: 0xe2d8b4, water: 0x249f97, deep: 0x125d66, cliff: [0xd97b4d, 0xaf593f, 0xeba168, 0x97513d], top: 0xdab879, sand: 0xd59d5a, grass: 0x537f56, sun: 0xffebc8, light: 1 },
  swamp:  { sky: [0x7cc5c9, 0xe9f5e3], fog: 0xd4ead8, water: 0x2fa58f, deep: 0x13705f, cliff: [0x9a7b5b, 0x8a6b4d, 0xb08a64, 0x7d6448], top: 0x8fb35a, sand: 0xc49a5c, grass: 0x6fae3c, sun: 0xfff4d6, light: 1 },
  sunset: { sky: [0x6c63c9, 0xffc48a], fog: 0xf5c9a8, water: 0x2a8fe0, deep: 0x13509b, cliff: [0xd8655f, 0xc5524f, 0xe98267, 0xb84a4f], top: 0xf2a066, sand: 0xe88b45, grass: 0x9ccf4a, sun: 0xffc98a, light: 0.95 },
  ice:    { sky: [0x7fc4f5, 0xf2fbff], fog: 0xe3f2ff, water: 0x4fc1ec, deep: 0x1d86c4, cliff: [0xdff1ff, 0xc5e3f7, 0xb3d7ef, 0xeaf7ff], top: 0xf8fcff, sand: 0xcfe6f5, grass: 0xeaf6ff, sun: 0xffffff, light: 1.05 },
  sewer:  { sky: [0x2f3542, 0x6b6f5c], fog: 0x585c4c, water: 0x5f7d3a, deep: 0x3c5424, cliff: [0x7a5a48, 0x6b4e3e, 0x86644f, 0x5e4436], top: 0x4f4a44, sand: 0x6b6157, grass: 0x55663e, sun: 0xd8e0b0, light: 0.7, brick: true },
  jungle: { sky: [0x4fae9c, 0xe6f2d0], fog: 0xc9e3c0, water: 0x5c8a52, deep: 0x35603a, cliff: [0x7a9a4a, 0x6a8a3e, 0x8aaa58, 0x5e7a36], top: 0x4f8f2e, sand: 0x9c7a4c, grass: 0x3f8f2a, sun: 0xfff4cc, light: 0.95, dense: true },
  lava:   { sky: [0x2e1a24, 0xff8a4a], fog: 0x8a4434, water: 0x2f7fb0, deep: 0x154870, cliff: [0x3a2a2e, 0x4a3036, 0x2e2226, 0x5c3438], top: 0x3a2a2a, sand: 0x6a3a2a, grass: 0xff6a1a, sun: 0xffb070, light: 0.85, glow: 0xff5a1a },
  night:  { sky: [0x070b24, 0x2a3a70], fog: 0x1a2246, water: 0x1f4f8f, deep: 0x0d2a55, cliff: [0x3a4060, 0x30365a, 0x454c70, 0x2a2f50], top: 0x2f3a5a, sand: 0x4a4a6a, grass: 0x3f6a5a, sun: 0xaab8ff, light: 0.55, stars: true },
};

// ------------------------------------------------------------
//  Построение трассы (сэмплы через 1 м). Трасса умеет расти — для бесконечного режима.
// ------------------------------------------------------------
const trackCache = new Map();

function newTrack(def, key) {
  const tr = { key, L: def, N: 1, X: [0], Z: [0], H: [0], W: [def.startW], length: 0, spikeL: [0], spikeR: [0], gapL: [0], gapR: [0], _x: 0, _z: 0, _h: 0, _w: def.startW, themeAt: () => def.theme };
  appendSegs(tr, def.segs);
  applyFlags(tr, def.spikes, def.gaps);
  return tr;
}
function appendSegs(tr, segs) {
  let { _x: x, _z: z, _h: h, _w: w } = tr;
  for (const [len, turn, wEnd] of segs) {
    const n = Math.round(len), dh = (turn * Math.PI / 180) / n, w0 = w;
    for (let i = 1; i <= n; i++) {
      h += dh * 0.5; x += Math.sin(h); z += Math.cos(h); h += dh * 0.5;
      w = w0 + (wEnd - w0) * (i / n);
      tr.X.push(x); tr.Z.push(z); tr.H.push(h); tr.W.push(w);
      tr.spikeL.push(0); tr.spikeR.push(0); tr.gapL.push(0); tr.gapR.push(0);
    }
  }
  Object.assign(tr, { _x: x, _z: z, _h: h, _w: w, N: tr.X.length, length: tr.X.length - 1 });
}
function applyFlags(tr, spikes, gaps) {
  for (const sp of spikes) for (let i = Math.max(0, Math.floor(sp.s0)); i <= Math.min(tr.N - 1, Math.ceil(sp.s1)); i++) (sp.side > 0 ? tr.spikeL : tr.spikeR)[i] = 1;
  for (const g of gaps) for (let i = Math.max(0, Math.floor(g.s0)); i <= Math.min(tr.N - 1, Math.ceil(g.s1)); i++) (g.side > 0 ? tr.gapL : tr.gapR)[i] = 1;
}

export function buildTrack(levelIdx, seed = 1) {
  const endless = levelIdx === ENDLESS || levelIdx === DAILY;
  const key = endless ? `${levelIdx === DAILY ? 'd' : 'e'}${seed}` : levelIdx;
  if (trackCache.has(key)) return trackCache.get(key);
  let tr;
  if (endless) {
    for (const k of [...trackCache.keys()]) if (typeof k === 'string') trackCache.delete(k);
    const def = { name: 'Бесконечный сплав', endless: true, theme: 'day', current: 2.5, startW: 12, segs: [[25, 0, 12]], spikes: [], gaps: [], obstacles: [], checkpoints: [], chunkThemes: [] };
    if (levelIdx === DAILY) { const mut = dailyMutator(seed); Object.assign(def, mut.p, { name: DAILY_INFO.name, mut: mut.id }); if (mut.p.currentMult) def.current *= mut.p.currentMult; }
    tr = newTrack(def, key);
    tr.endless = true; tr.seed = seed; tr.chunks = 0;
    tr.themeAt = (s) => { const k = Math.max(0, Math.floor((s - 25) / CHUNK_LEN)); return def.chunkThemes[Math.min(k, def.chunkThemes.length - 1)] || 'day'; };
    extendTrack(tr, 700);
  } else tr = newTrack(LEVELS[levelIdx], key);
  tr.idx = levelIdx;
  trackCache.set(key, tr);
  return tr;
}

// Бесконечный режим: дорастить трассу до untilS метров
export function extendTrack(tr, untilS) {
  if (!tr.endless) return false;
  let grew = false;
  while (tr.length < untilS) { genEndlessChunk(tr); grew = true; }
  return grew;
}

export function yAt(s) { return -s * SLOPE; }

// Медали за время: золото и серебро (бронза — просто доплыть)
export function medalTimes(levelIdx) {
  const len = buildTrack(levelIdx).length;
  return { gold: Math.round(len / 5.0), silver: Math.round(len / 3.8) };
}
export function medalFor(levelIdx, time) {
  const m = medalTimes(levelIdx);
  return time <= m.gold ? 3 : time <= m.silver ? 2 : 1;
}
export const EMOTES = ['Пукай!', 'Стоп!', 'Левее!', 'Правее!', 'Это не я!'];

export function frame(tr, s, d = 0) {
  s = Math.max(0, Math.min(tr.length, s));
  const i = Math.min(tr.N - 2, Math.floor(s)), t = s - i;
  const x = tr.X[i] + (tr.X[i + 1] - tr.X[i]) * t;
  const z = tr.Z[i] + (tr.Z[i + 1] - tr.Z[i]) * t;
  const h = tr.H[i] + (tr.H[i + 1] - tr.H[i]) * t;
  const w = tr.W[i] + (tr.W[i + 1] - tr.W[i]) * t;
  const nx = Math.cos(h), nz = -Math.sin(h);
  return { x: x + nx * d, z: z + nz * d, h, w, y: yAt(s), fx: Math.sin(h), fz: Math.cos(h), nx, nz };
}

export function locate(tr, x, z, hint = -1) {
  let lo = 0, hi = tr.N - 1;
  if (hint >= 0) { lo = Math.max(0, hint - 30); hi = Math.min(tr.N - 1, hint + 30); }
  let best = 0, bd = Infinity;
  for (let i = lo; i <= hi; i++) {
    const dx = x - tr.X[i], dz = z - tr.Z[i], dd = dx * dx + dz * dz;
    if (dd < bd) { bd = dd; best = i; }
  }
  const i = best, h = tr.H[i];
  const dx = x - tr.X[i], dz = z - tr.Z[i];
  const along = dx * Math.sin(h) + dz * Math.cos(h);
  const d = dx * Math.cos(h) - dz * Math.sin(h);
  const s = Math.max(0, Math.min(tr.length, i + along));
  const f = frame(tr, s);
  return { i, s, d, w: f.w, h: f.h, fx: f.fx, fz: f.fz, nx: f.nx, nz: f.nz };
}

// ------------------------------------------------------------
//  Препятствия
// ------------------------------------------------------------
const TAU = Math.PI * 2;
const frac = (x) => x - Math.floor(x);

// Поршень: резко выстреливает, держит, медленно уходит
export function pistonExt(o, T) {
  const p = frac(T / o.per + o.ph);
  if (p < 0.1) { const k = p / 0.1; return { e: o.len * (1 - (1 - k) * (1 - k)), fast: true }; }
  if (p < 0.45) return { e: o.len, fast: false };
  if (p < 0.85) { const k = (p - 0.45) / 0.4; return { e: o.len * (1 - k), fast: false }; }
  return { e: 0, fast: false };
}
// Крокодил: 0..0.72 пасть открывается (предупреждение), 0.72..0.86 — ЩЁЛК
export function crocPhase(o, T) { return frac(T / o.per + o.ph); }
export function crocBiting(o, T) { const p = crocPhase(o, T); return p > 0.72 && p < 0.86; }
// Гейзер: 0..0.62 тихо, 0.62..0.8 бурлит (предупреждение), 0.8..0.93 бьёт
export function geyserPhase(o, T) { return frac(T / o.per + o.ph); }
export function geyserErupting(o, T) { const p = geyserPhase(o, T); return p > 0.8 && p < 0.93; }

export function obstacleState(o, tr, T) {
  switch (o.type) {
    case 'rock': case 'buoy': case 'whirl': case 'boost': case 'mush': case 'croc': case 'geyser': {
      const f = frame(tr, o.s, o.d || 0);
      return { x: f.x, z: f.z, y: f.y, h: f.h, a: 0, f };
    }
    case 'log': case 'ball': case 'saw': {
      const dd = o.d + o.amp * Math.sin(TAU * T / o.per + o.ph);
      const f = frame(tr, o.s, dd);
      return { x: f.x, z: f.z, y: f.y, h: f.h, a: 0, dd, f };
    }
    case 'axe': {
      const dd = o.amp * Math.sin(TAU * T / o.per + o.ph);
      const f = frame(tr, o.s, dd), f0 = frame(tr, o.s, 0);
      return { x: f.x, z: f.z, y: f.y, h: f.h, dd, f, f0 };
    }
    case 'spin': {
      const f = frame(tr, o.s, o.d);
      return { x: f.x, z: f.z, y: f.y, h: f.h, a: o.spd * T + o.ph, f };
    }
    case 'arc': {
      const f0 = frame(tr, o.s, 0);
      const cd = o.side * (f0.w / 2 - 0.4);
      const f = frame(tr, o.s, cd);
      return { x: f.x, z: f.z, y: f.y, h: f.h, a: o.spd * T + o.ph, f };
    }
    case 'door': {
      const f0 = frame(tr, o.s, 0);
      return { x: f0.x, z: f0.z, y: f0.y, h: f0.h, c: o.amp * Math.sin(TAU * T / o.per + o.ph), w: f0.w, f: f0 };
    }
    case 'piston': {
      const f0 = frame(tr, o.s, 0);
      const pe = pistonExt(o, T);
      return { x: f0.x, z: f0.z, y: f0.y, h: f0.h, w: f0.w, f: f0, ext: pe.e, fast: pe.fast };
    }
    case 'boulder': {
      const f0 = frame(tr, o.s, 0);
      const p = frac(T / o.per + o.ph);
      const span = f0.w / 2 + 4;
      const active = p < 0.5;
      const dd = active ? o.dir * span * (1 - 4 * p) : o.dir * span * 3;   // вне трассы — далеко
      const f = frame(tr, o.s, dd);
      return { x: f.x, z: f.z, y: f.y, h: f.h, dd, active, p, f };
    }
  }
  return null;
}

// Формы для столкновений: {ax,az,bx,bz,r,kill,e,hard}
//   kill: null — просто отталкивает; 'pop' — протыкает; 'smash' — давит; 'bite' — кусает
export function obstacleShapes(o, tr, T, out = []) {
  const st = obstacleState(o, tr, T);
  const C = (x, z, r, kill = null, e = 0.4, hard = false) => out.push({ ax: x, az: z, bx: x, bz: z, r, kill, e, hard });
  const S = (ax, az, bx, bz, r, kill = null, e = 0.5, hard = false) => out.push({ ax, az, bx, bz, r, kill, e, hard });
  switch (o.type) {
    case 'rock': C(st.x, st.z, o.r, null, 0.3, true); break;
    case 'buoy': C(st.x, st.z, o.r, null, 1.25); break;
    case 'mush': C(st.x, st.z, o.r + PHYS.spikePad, 'pop'); break;
    case 'ball': C(st.x, st.z, o.r + PHYS.spikePad, 'pop'); break;
    case 'saw': C(st.x, st.z, o.r + PHYS.spikePad, 'pop'); break;
    case 'axe': C(st.x, st.z, o.r, 'pop'); break;
    case 'croc': C(st.x, st.z, crocBiting(o, T) ? 1.5 : 0.95, crocBiting(o, T) ? 'bite' : null, 0.5, true); break;
    case 'boulder': C(st.x, st.z, o.r, st.active ? 'smash' : null, 0.4, true); break;
    case 'log': {
      const a = frame(tr, o.s - o.len / 2, st.dd), b = frame(tr, o.s + o.len / 2, st.dd);
      S(a.x, a.z, b.x, b.z, o.r, null, 0.6, true);
      break;
    }
    case 'spin': {
      C(st.x, st.z, 0.7, null, 0.5, true);
      for (let k = 0; k < o.arms; k++) {
        const a = st.a + k * TAU / o.arms;
        S(st.x + Math.sin(a) * 0.8, st.z + Math.cos(a) * 0.8, st.x + Math.sin(a) * o.len, st.z + Math.cos(a) * o.len, o.r + (o.spike ? PHYS.spikePad : 0), o.spike ? 'pop' : null, 0.6, true);
      }
      break;
    }
    case 'arc': {
      const segs = 5;
      for (let k = 0; k < segs; k++) {
        const a0 = st.a - o.span / 2 + o.span * k / segs, a1 = st.a - o.span / 2 + o.span * (k + 1) / segs;
        S(st.x + Math.sin(a0) * o.R, st.z + Math.cos(a0) * o.R, st.x + Math.sin(a1) * o.R, st.z + Math.cos(a1) * o.R, o.r + PHYS.spikePad, 'pop');
      }
      break;
    }
    case 'door': {
      const f = st.f, hw = st.w / 2 + 0.6, hh = o.hole / 2;
      const p = (d) => [f.x + f.nx * d, f.z + f.nz * d];
      const [l1x, l1z] = p(hw), [l2x, l2z] = p(st.c + hh), [r1x, r1z] = p(-hw), [r2x, r2z] = p(st.c - hh);
      S(l1x, l1z, l2x, l2z, o.spike ? 0.6 + PHYS.spikePad : 0.6, o.spike ? 'pop' : null, 0.5, true);
      S(r1x, r1z, r2x, r2z, o.spike ? 0.6 + PHYS.spikePad : 0.6, o.spike ? 'pop' : null, 0.5, true);
      break;
    }
    case 'piston': {
      const f = st.f, base = o.side * (st.w / 2 + 1.2), tip = o.side * (st.w / 2 + 1.2 - Math.max(0.01, st.ext));
      const half = o.wid / 2;
      // две параллельные капсулы дают «толстый» блок
      for (const ds of [-half * 0.5, half * 0.5]) {
        const ax = f.x + f.nx * base + f.fx * ds, az = f.z + f.nz * base + f.fz * ds;
        const bx = f.x + f.nx * tip + f.fx * ds, bz = f.z + f.nz * tip + f.fz * ds;
        S(ax, az, bx, bz, half * 0.6, null, 0.3, true);
      }
      break;
    }
  }
  return out;
}

export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, L2 = abx * abx + abz * abz;
  let u = L2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / L2 : 0;
  u = Math.max(0, Math.min(1, u));
  return [ax + abx * u, az + abz * u, u];
}

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI;
}

// ------------------------------------------------------------
//  «Мозги» бота-бегемота (общие для сервера и тестов)
//  raft: {x,z,vx,vz,a,hint}; me: {pos,gas,heat,fartOn,greedy,lane,waitT} — lane/waitT обновляются
// ------------------------------------------------------------
export function botDecide(levelIdx, raft, me, T) {
  const tr = typeof levelIdx === 'object' ? levelIdx : buildTrack(levelIdx), L = tr.L;
  const loc = locate(tr, raft.x, raft.z, raft.hint ?? -1);
  const half = Math.max(0, loc.w / 2 - RAFT_R - 0.3);
  const vAlong = Math.max(4.2, raft.vx * loc.fx + raft.vz * loc.fz);   // прогноз — для скорости, с которой проскочим
  const near = L.obstacles.filter(o => o.s > loc.s - 3 && o.s < loc.s + 18 && o.type !== 'whirl' && o.type !== 'boost');
  const samples = [];
  for (let ds = 2; ds <= 16; ds += 2) {
    const shapes = [];
    for (const o of near) {
      const reach = 4.2 + (o.len || 0) / 2 + (o.type === 'spin' || o.type === 'arc' ? (o.len || o.R || 0) : 0);
      if (Math.abs(o.s - (loc.s + ds)) < reach) obstacleShapes(o, tr, T + ds / vAlong, shapes);   // где будет, когда доплывём
    }
    samples.push({ ds, shapes });
  }
  let bestD = 0, best = Infinity;
  for (const k of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
    const d = k * half;
    let score = Math.abs(d) * 0.1 + Math.abs(d - loc.d) * 0.08;
    for (const smp of samples) {
      const f = frame(tr, loc.s + smp.ds, loc.d + (d - loc.d) * Math.min(1, smp.ds / 6));
      for (const sh of smp.shapes) {
        const [qx, qz] = closestOnSeg(f.x, f.z, sh.ax, sh.az, sh.bx, sh.bz);
        const gap = Math.hypot(f.x - qx, f.z - qz) - sh.r - RAFT_R, margin = sh.kill ? 1.6 : 1.0;
        if (gap < margin) score += (sh.kill ? 14 : 2.5) * (margin - gap) / (1 + smp.ds * 0.08);
      }
      const i = Math.min(tr.N - 1, Math.round(loc.s + smp.ds));
      const edge = half > 0 ? Math.abs(d) / half : 0;      // шипастый борт или обрыв — держимся подальше
      if ((d > 0 && (tr.spikeL[i] || tr.gapL[i])) || (d < 0 && (tr.spikeR[i] || tr.gapR[i]))) score += 5 * Math.max(0, edge - 0.35);
    }
    if (score < best) { best = score; bestD = d; }
  }
  me.lane = me.lane === undefined ? bestD : me.lane + (bestD - me.lane) * 0.5;
  const tgt = frame(tr, Math.min(tr.length, loc.s + 7), me.lane);
  const dx = tgt.x - raft.x, dz = tgt.z - raft.z, dl = Math.hypot(dx, dz) || 1;
  const danger = samples.some(smp => smp.shapes.some(sh => sh.kill));
  // проход закрыт — притормозить и подождать окна, но не дольше 2.5 с
  if (best > 6) me.waitT = (me.waitT || 0) + 0.11; else me.waitT = 0;
  const v = best > 6 && me.waitT < 2.5 ? 1.4 : danger ? (best < 1 ? 5.6 : 3.4) : 4.7;
  const ex = dx / dl * v - raft.vx, ez = dz / dl * v - raft.vz;
  const aim = Math.atan2(ex, ez);
  const align = Math.cos(wrapAngle(raft.a + me.pos + Math.PI - aim));
  const gasOk = me.fartOn ? me.gas > (me.greedy ? 0 : 0.2) : me.gas > 0.4;
  return { aim, fart: Math.hypot(ex, ez) > 1.1 && align > 0.55 && gasOk && me.heat < 0.85 };
}

// ============================================================
//  Генератор трасс (детерминированный: сервер и браузеры строят одно и то же)
// ============================================================
export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rr = (rng, a, b) => a + (b - a) * rng();
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const sgn = (rng) => (rng() < 0.5 ? -1 : 1);

const TEMPLATES = {
  buoy: (r, hw, s) => ({ type: 'buoy', s, d: rr(r, -hw + 2, hw - 2), r: rr(r, 0.9, 1.1) }),
  rock: (r, hw, s) => ({ type: 'rock', s, d: rr(r, -hw + 1.6, hw - 1.6), r: rr(r, 1.2, 1.7) }),
  log: (r, hw, s) => ({ type: 'log', s, d: 0, amp: rr(r, 1.8, Math.min(2.8, hw - 2)), per: rr(r, 3, 4.4), ph: rr(r, 0, 6.28), len: rr(r, 3.5, 5), r: 0.55 }),
  mush: (r, hw, s) => ({ type: 'mush', s, d: sgn(r) * rr(r, 1.6, Math.max(1.7, hw - 1.4)), r: rr(r, 1.1, 1.3) }),
  ball: (r, hw, s) => ({ type: 'ball', s, d: 0, amp: rr(r, 2, Math.max(2.1, hw - 2.2)), per: rr(r, 3.2, 4.2), ph: rr(r, 0, 6.28), r: 0.8 }),
  saw: (r, hw, s) => ({ type: 'saw', s, d: 0, amp: rr(r, 2, Math.max(2.1, hw - 2.2)), per: rr(r, 3.2, 4.2), ph: rr(r, 0, 6.28), r: 0.9 }),
  spinWood: (r, hw, s) => ({ type: 'spin', s, d: 0, len: hw - 1.3, spd: sgn(r) * rr(r, 0.7, 1.0), arms: 2, r: 0.45, spike: false, ph: rr(r, 0, 6.28) }),
  spinSpike: (r, hw, s) => ({ type: 'spin', s, d: sgn(r) * (hw - 2.2), len: rr(r, 2.0, 2.5), spd: sgn(r) * rr(r, 0.7, 1.1), arms: [2, 3, 4][(r() * 3) | 0], r: 0.45, spike: true, ph: rr(r, 0, 6.28) }),
  axe: (r, hw, s) => ({ type: 'axe', s, amp: rr(r, 2.4, Math.max(2.5, Math.min(3, hw - 2))), per: rr(r, 3.6, 4.4), ph: rr(r, 0, 6.28), r: 0.7 }),
  arc: (r, hw, s) => ({ type: 'arc', s, side: sgn(r), R: rr(r, 3, 3.3), span: rr(r, 1.8, 2.2), spd: sgn(r) * rr(r, 0.8, 1.1), ph: rr(r, 0, 6.28), r: 0.4 }),
  door: (r, hw, s) => { const hole = rr(r, 6.6, 7.2), amp = hw - hole / 2 - 0.3; return amp < 0.4 ? null : { type: 'door', s, hole, amp: Math.min(2, amp), per: rr(r, 4, 5), ph: rr(r, 0, 6.28) }; },
  doorSpike: (r, hw, s) => { const hole = rr(r, 6.8, 7.3), amp = hw - hole / 2 - 0.3; return amp < 0.4 ? null : { type: 'door', s, hole, amp: Math.min(1.8, amp), per: rr(r, 4, 5), ph: rr(r, 0, 6.28), spike: true }; },
  piston: (r, hw, s) => ({ type: 'piston', s, side: sgn(r), len: rr(r, 4, 5), per: rr(r, 2.8, 3.4), ph: rr(r, 0, 1), wid: 2 }),
  croc: (r, hw, s) => ({ type: 'croc', s, d: sgn(r) * (hw - 2.6), per: rr(r, 2.4, 3), ph: rr(r, 0, 1) }),
  boulder: (r, hw, s) => ({ type: 'boulder', s, per: rr(r, 4.4, 5.2), ph: rr(r, 0, 1), r: 1.3, dir: sgn(r) }),
  whirl: (r, hw, s) => ({ type: 'whirl', s, d: rr(r, -1.5, 1.5), r: 3.5, str: rr(r, 1, 1.5) }),
  boost: (r, hw, s) => ({ type: 'boost', s, d: 0, len: 7, wid: 4 }),
  geyser: (r, hw, s) => ({ type: 'geyser', s, d: rr(r, -Math.max(0, hw - 2.6), Math.max(0, hw - 2.6)), r: 2.2, per: rr(r, 4, 5.5), ph: rr(r, 0, 1) }),
};
const KILLERS = new Set(['mush', 'ball', 'saw', 'spinSpike', 'axe', 'arc', 'doorSpike', 'croc', 'boulder']);

// Сколько свободного места для плота у отметки s (с учётом движущихся препятствий)
export function laneStats(tr, obs, s) {
  const f0 = frame(tr, s), i = Math.round(clampN(s, 0, tr.length));
  const lo = -(f0.w / 2 - RAFT_R) + (tr.spikeR[i] ? PHYS.spikeReach + 0.2 : 0), hi = (f0.w / 2 - RAFT_R) - (tr.spikeL[i] ? PHYS.spikeReach + 0.2 : 0);
  if (hi - lo < 0.4) return { maxLane: 0, goodFrac: 0, closedFrac: 1 };
  let maxLane = 0, good = 0, closed = 0, n = 0;
  const sh = [];
  for (let T = 0; T < 8; T += 0.2) {
    sh.length = 0; for (const o of obs) obstacleShapes(o, tr, T, sh);
    let lane = 0, cur = 0;
    for (let d = lo; d <= hi + 1e-6; d += 0.2) {
      const p = frame(tr, s, d); let ok = true;
      for (const q of sh) { const [qx, qz] = closestOnSeg(p.x, p.z, q.ax, q.az, q.bx, q.bz); if (Math.hypot(p.x - qx, p.z - qz) < RAFT_R + q.r + 0.1) { ok = false; break; } }
      if (ok) { cur += 0.2; if (cur > lane) lane = cur; } else cur = 0;
    }
    n++; if (lane > maxLane) maxLane = lane; if (lane >= 0.9) good++; if (lane < 0.05) closed++;
  }
  return { maxLane, goodFrac: good / n, closedFrac: closed / n };
}

// Точка возрождения у чекпоинта не должна задевать препятствие ни в какой момент
function respawnClear(tr, cps, o) {
  const sh = [];
  for (const c of cps) {
    if (Math.abs(c - o.s) > 16) continue;
    const p = frame(tr, c, 0);
    for (let T = 0; T < 8; T += 0.2) {
      sh.length = 0; obstacleShapes(o, tr, T, sh);
      for (const q of sh) { const [qx, qz] = closestOnSeg(p.x, p.z, q.ax, q.az, q.bx, q.bz); if (Math.hypot(p.x - qx, p.z - qz) < RAFT_R + q.r + 0.5) return false; }
    }
  }
  return true;
}

function genSegs(rng, total, diff, startW, withEnds) {
  const segs = withEnds ? [[25, 0, startW]] : [];
  let L = withEnds ? 25 : 0;
  const wMin = 12.2 - diff * 0.7, wMax = 13.2 - diff * 0.25;
  while (L < total - (withEnds ? 25 : 0)) {
    const len = Math.round(rr(rng, 22, 38));
    let turn = rng() < 0.28 ? 0 : rr(rng, 25, 65) * sgn(rng);
    const maxTurn = (len / 15) * 180 / Math.PI;
    turn = clampN(turn, -maxTurn, maxTurn);
    segs.push([len, Math.round(turn), +rr(rng, wMin, wMax).toFixed(1)]); L += len;
  }
  if (withEnds) segs.push([25, 0, 12]);
  return segs;
}

function genFeatures(tr, def, rng, s0, s1, diff, pool) {
  const newSp = [], newGaps = [];
  // шипастые стены
  for (let s = s0 + 10; s < s1 - 30; s += 30) {
    if (rng() < 0.1 * diff) { const len = rr(rng, 18, 32); newSp.push({ s0: Math.round(s), s1: Math.round(Math.min(s1 - 5, s + len)), side: sgn(rng) }); s += len; }
  }
  // обрывы (со 3-й сложности)
  if (diff >= 3) {
    const nG = rng() < 0.5 ? 1 : 2;
    for (let g = 0; g < nG; g++) {
      const gs = rr(rng, s0 + 30, s1 - 40), side = sgn(rng), len = rr(rng, 16, 24);
      if (newSp.some(sp => sp.side === side && sp.s1 > gs - 3 && sp.s0 < gs + len + 3)) continue;
      newGaps.push({ s0: Math.round(gs), s1: Math.round(gs + len), side });
    }
  }
  def.spikes.push(...newSp); def.gaps.push(...newGaps);
  applyFlags(tr, newSp, newGaps);
  // чекпоинты
  const step = diff >= 4 ? 45 : 55;
  const last = def.checkpoints.length ? def.checkpoints[def.checkpoints.length - 1] : 0;
  for (let c = Math.max(s0 + 15, last + step); c < s1 - 8; c += step) {
    let cc = c;
    while (cc < s1 - 8 && (tr.gapL[Math.round(cc)] || tr.gapR[Math.round(cc)])) cc += 4;
    if (cc < s1 - 8) def.checkpoints.push(Math.round(cc));
  }
  // препятствия
  const spacing = 27 - diff * 2.8;
  let s = s0 + 14 + rng() * 6;
  const end = def.endless ? s1 : s1 - 15;
  while (s < end) {
    if (def.checkpoints.some(c => s > c - 9 && s < c + 4)) { s += 3; continue; }
    const hw = frame(tr, s).w / 2;
    let placed = null;
    for (let tries = 0; tries < 6 && !placed; tries++) {
      const kind = pool[(rng() * pool.length) | 0];
      const o = TEMPLATES[kind](rng, hw, Math.round(s * 10) / 10);
      if (!o) continue;
      const near = def.obstacles.filter(q => Math.abs(q.s - o.s) < 12).concat([o]);
      const st = laneStats(tr, near, o.s);
      let ok = KILLERS.has(kind) ? (st.maxLane >= 1.3 && st.goodFrac >= 0.35) : (st.closedFrac <= 0.6 && st.maxLane >= 1.0);
      if (ok) ok = respawnClear(tr, def.checkpoints, o);
      if (ok) placed = o;
    }
    if (placed) def.obstacles.push(placed);
    s += spacing * (0.8 + rng() * 0.5) + (placed && placed.len ? placed.len / 2 : 0);
  }
}

export const CHUNK_LEN = 200;
const ENDLESS_THEMES = ['day', 'jungle', 'ice', 'sewer', 'sunset', 'lava', 'swamp', 'night'];
function endlessPool(diff) {
  const p = ['buoy', 'rock', 'log', 'whirl', 'boost', 'spinWood', 'mush'];
  if (diff >= 2) p.push('saw', 'piston', 'door', 'ball', 'geyser');
  if (diff >= 3) p.push('spinSpike', 'axe', 'arc', 'croc');
  if (diff >= 4) p.push('boulder', 'doorSpike', 'spinSpike', 'axe');
  return p;
}
function genEndlessChunk(tr) {
  const k = tr.chunks, def = tr.L;
  const rng = mulberry32((tr.seed * 7919 + k * 104729 + 13) | 0);
  const diff = Math.min(5, 1 + k * 0.45);
  def.chunkThemes.push(ENDLESS_THEMES[Math.floor(k / 3) % ENDLESS_THEMES.length]);
  const s0 = tr.length;
  const segs = genSegs(rng, CHUNK_LEN, diff, tr._w, false);
  appendSegs(tr, segs); def.segs.push(...segs);
  genFeatures(tr, def, rng, k === 0 ? 25 : s0, tr.length, diff, endlessPool(diff));
  tr.chunks++;
}
export function endlessDifficulty(s) { return Math.min(5, 1 + Math.max(0, (s - 25) / CHUNK_LEN) * 0.45); }

const ALL_POOL = Object.keys(TEMPLATES);
const GEN_LEVELS = [
  { name: 'Ледяная протока', desc: 'Скользко: плот почти не тормозит о воду.', theme: 'ice', seed: 6101, length: 380, diff: 2, drag: 0.6, current: 2.3, pool: ['rock', 'buoy', 'log', 'door', 'saw', 'spinWood', 'ball', 'whirl', 'boost'] },
  { name: 'Канализация', desc: 'Гейзеры, крокодилы и поршни. Воняет даже без вас.', theme: 'sewer', seed: 7202, length: 420, diff: 3, current: 2.5, pool: ['piston', 'saw', 'croc', 'geyser', 'door', 'mush', 'ball', 'geyser', 'boost'] },
  { name: 'Джунгли', desc: 'Брёвна, крокодилы и шипастые дуги в мутной воде.', theme: 'jungle', seed: 8303, length: 440, diff: 3, current: 2.4, pool: ['log', 'croc', 'arc', 'whirl', 'rock', 'spinSpike', 'boulder', 'mush', 'log'] },
  { name: 'Лавовый каньон', desc: 'Жарко: попа перегревается в полтора раза быстрее.', theme: 'lava', seed: 9404, length: 460, diff: 4, heatMult: 1.5, current: 2.6, pool: ['boulder', 'piston', 'axe', 'geyser', 'mush', 'spinSpike', 'rock', 'saw'] },
  { name: 'Ночной сплав', desc: 'Финальное испытание в темноте. Всё и сразу.', theme: 'night', seed: 10505, length: 520, diff: 5, current: 2.7, pool: ALL_POOL },
];
for (const p of GEN_LEVELS) {
  const rng = mulberry32(p.seed);
  const def = { name: p.name, desc: p.desc, theme: p.theme, current: p.current, startW: 12, drag: p.drag, heatMult: p.heatMult, generated: true, segs: genSegs(rng, p.length, p.diff, 12, true), spikes: [], gaps: [], obstacles: [], checkpoints: [] };
  const tr = newTrack(def, 'gen');
  genFeatures(tr, def, rng, 25, tr.length - 12, p.diff, p.pool);
  LEVELS.push(def);
}
export const ENDLESS = LEVELS.length;
// Задание дня: бесконечный сплав с одной трассой на всех на сегодня и особым условием
export const DAILY = ENDLESS + 1;
export const DAILY_MUTATORS = [
  { id: 'beans', name: 'Бобовый день', desc: 'Газ восстанавливается вдвое быстрее', p: { regenMult: 2 } },
  { id: 'slippery', name: 'Скользкий день', desc: 'Вода как масло: плот тормозит вдвое хуже', p: { drag: 0.5 } },
  { id: 'pepper', name: 'Острый перец', desc: 'Тяга на четверть сильнее, но попа греется вдвое быстрее', p: { thrustMult: 1.25, heatMult: 2 } },
  { id: 'rapids', name: 'Бурная река', desc: 'Течение в полтора раза быстрее', p: { currentMult: 1.5 } },
  { id: 'diet', name: 'Диета', desc: 'Газ тратится на треть медленнее, но и толкает слабее', p: { gasMult: 0.67, thrustMult: 0.85 } },
  { id: 'storm', name: 'Шторм', desc: 'Удары сильнее выбивают за борт, течение быстрее', p: { currentMult: 1.25, ejectMult: 0.75 } },
];
export const dailyMutator = (seed) => DAILY_MUTATORS[Math.abs(seed) % DAILY_MUTATORS.length];
export function dailySeed(dateStr) { let h = 2166136261; for (const ch of dateStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000000007; }
export function localDate(d = new Date()) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
export const DAILY_INFO = { name: 'Задание дня', desc: 'Одна трасса на всех на сегодня и особое условие. Завтра — новая.' };
export const ENDLESS_INFO = { name: 'Бесконечный сплав', desc: 'Трасса строится на ходу и становится всё злее. Сколько метров продержитесь?' };
