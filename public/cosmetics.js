// ============================================================
//  Гардероб.
//   r      — редкость (common / rare / epic / legendary)
//   unlock — id достижения, которое открывает вещь
//   box    — выпадает из подарков (ящиков)
//   perk   — бафф легендарной вещи (см. PERKS), у каждого есть и минус
//   ic     — значок для карточек
// ============================================================
export const RARITY = {
  common:    { id: 'common',    name: 'Обычная',     color: '#9aa3b5', rank: 0, dupe: 15 },
  rare:      { id: 'rare',      name: 'Редкая',      color: '#3d8fe0', rank: 1, dupe: 35 },
  epic:      { id: 'epic',      name: 'Эпическая',   color: '#a35ee8', rank: 2, dupe: 80 },
  legendary: { id: 'legendary', name: 'Легендарная', color: '#f2961f', rank: 3, dupe: 200 },
};
export const RARITY_LIST = ['common', 'rare', 'epic', 'legendary'];

export const HATS = [
  { id: 'none', name: 'Без шапки', ic: '🚫' },
  { id: 'cap', name: 'Кепка', ic: '🧢' },
  { id: 'cowboy', name: 'Ковбойская шляпа', ic: '🤠' },
  { id: 'ushanka', name: 'Ушанка', ic: '🪖' },
  { id: 'bandana', name: 'Бандана', ic: '🏴' },
  { id: 'beanie', name: 'Шапка-бини', ic: '🧶', box: true },
  { id: 'party', name: 'Праздничный колпак', ic: '🥳', box: true },
  { id: 'bucket', name: 'Ведро на голове', ic: '🪣', unlock: 'shit_10' },
  { id: 'santa', name: 'Шапка Деда Мороза', ic: '🎅', r: 'rare', box: true },
  { id: 'pirate', name: 'Пиратская треуголка', ic: '🏴‍☠️', r: 'rare', box: true },
  { id: 'sombrero', name: 'Сомбреро', ic: '👒', r: 'rare', box: true },
  { id: 'propeller', name: 'Шапка с пропеллером', ic: '🚁', r: 'rare', unlock: 'fart_1000' },
  { id: 'tophat', name: 'Цилиндр', ic: '🎩', r: 'rare', unlock: 'fin_10' },
  { id: 'chef', name: 'Поварской колпак', ic: '👨‍🍳', r: 'rare', unlock: 'heat_10' },
  { id: 'wizard', name: 'Колпак волшебника', ic: '🧙', r: 'epic', box: true },
  { id: 'horns', name: 'Рожки чертёнка', ic: '😈', r: 'epic', box: true },
  { id: 'unicorn', name: 'Рог единорога', ic: '🦄', r: 'epic', box: true },
  { id: 'viking', name: 'Шлем викинга', ic: '⚔️', r: 'epic', unlock: 'eject_50' },
  { id: 'laurel', name: 'Лавровый венок', ic: '🌿', r: 'epic', unlock: 'awin_10' },
  { id: 'crown', name: 'Корона', ic: '👑', r: 'legendary', unlock: 'end_2000', perk: 'crown' },
  { id: 'halo', name: 'Нимб', ic: '😇', r: 'legendary', box: true, perk: 'halo' },
  { id: 'astro', name: 'Шлем космонавта', ic: '🧑‍🚀', r: 'legendary', box: true, perk: 'astro' },
];
export const GLASSES = [
  { id: 'none', name: 'Без очков', ic: '🚫' },
  { id: 'round', name: 'Круглые очки', ic: '👓' },
  { id: 'sun', name: 'Тёмные очки', ic: '🕶️' },
  { id: 'heart', name: 'Очки-сердечки', ic: '😍', box: true },
  { id: 'eyepatch', name: 'Пиратская повязка', ic: '👁️', box: true },
  { id: 'star', name: 'Очки-звёзды', ic: '🤩', r: 'rare', box: true },
  { id: 'visor', name: 'Горнолыжная маска', ic: '🥽', r: 'rare', box: true },
  { id: 'nerd', name: '3D-очки', ic: '🤓', r: 'rare', unlock: 'sync_50' },
  { id: 'cyber', name: 'Кибер-визор', ic: '🤖', r: 'epic', box: true },
  { id: 'monocle', name: 'Монокль', ic: '🧐', r: 'epic', unlock: 'gold_any' },
  { id: 'gasmask', name: 'Противогаз', ic: '😷', r: 'legendary', unlock: 'faint_10', perk: 'gasmask' },
  { id: 'laser', name: 'Лазерные очки', ic: '🔴', r: 'legendary', box: true, perk: 'laser' },
];
export const EXTRAS = [
  { id: 'none', name: 'Ничего', ic: '🚫' },
  { id: 'mustache', name: 'Усы', ic: '🥸' },
  { id: 'bowtie', name: 'Бабочка', ic: '🎀' },
  { id: 'scarf', name: 'Шарф', ic: '🧣', box: true },
  { id: 'flower', name: 'Цветок за ухом', ic: '🌺', box: true },
  { id: 'clothespin', name: 'Прищепка на носу', ic: '📎', unlock: 'faint_1' },
  { id: 'tie', name: 'Галстук', ic: '👔', r: 'rare', box: true },
  { id: 'pacifier', name: 'Соска', ic: '🍼', r: 'rare', box: true },
  { id: 'medal', name: 'Медаль на груди', ic: '🎖️', r: 'rare', unlock: 'fin_50' },
  { id: 'snorkel', name: 'Трубка для ныряния', ic: '🤿', r: 'epic', box: true },
  { id: 'wings', name: 'Крылышки', ic: '🪽', r: 'epic', box: true },
  { id: 'chain', name: 'Золотая цепь', ic: '📿', r: 'legendary', unlock: 'record', perk: 'chain' },
  { id: 'jetpack', name: 'Реактивный ранец', ic: '🚀', r: 'legendary', box: true, perk: 'jetpack' },
  { id: 'cape', name: 'Плащ героя', ic: '🦸', r: 'legendary', box: true, perk: 'cape' },
];
// pat — узор кожи, glow — свечение, anim — переливается
export const BODIES = [
  { id: 'grey', name: 'Серый', body: 0x7b838f, snout: 0x8c939e },
  { id: 'pink', name: 'Розовый', body: 0xd38a9a, snout: 0xe3a2b0 },
  { id: 'lilac', name: 'Сиреневый', body: 0x8f86b8, snout: 0xa49cc9 },
  { id: 'brown', name: 'Шоколадный', body: 0x8a6a55, snout: 0x9c7d68 },
  { id: 'mint', name: 'Мятный', body: 0x76b9a0, snout: 0x8fcab3, box: true },
  { id: 'peach', name: 'Персиковый', body: 0xe0a07a, snout: 0xebb593, box: true },
  { id: 'sky', name: 'Небесный', body: 0x76a6d8, snout: 0x93bbe4, box: true },
  { id: 'zebra', name: 'Зебра', body: 0xe8e8e8, snout: 0xf2f2f2, pat: 'zebra', r: 'rare', box: true },
  { id: 'cow', name: 'Бурёнка', body: 0xf0ebe0, snout: 0xf2b8b8, pat: 'cow', r: 'rare', box: true },
  { id: 'camo', name: 'Камуфляж', body: 0x8a9a6a, snout: 0x9aa87a, pat: 'camo', r: 'rare', box: true },
  { id: 'zombie', name: 'Зомби', body: 0x7f9a66, snout: 0x93ad7a, r: 'rare', unlock: 'shit_50' },
  { id: 'night', name: 'Полночный', body: 0x3e4a78, snout: 0x56629a, r: 'epic', unlock: 'end_1000' },
  { id: 'toxic', name: 'Токсичный', body: 0x9bc53d, snout: 0xb3d65a, r: 'epic', unlock: 'ko_50' },
  { id: 'ice', name: 'Ледяной', body: 0xbfe6f5, snout: 0xd9f2fb, r: 'epic', box: true, gloss: true },
  { id: 'neon', name: 'Неоновый', body: 0xff4fb8, snout: 0xff7fcc, r: 'epic', box: true, glow: 0xff2fa0 },
  { id: 'gold', name: 'Золотой', body: 0xd9a72b, snout: 0xe9bf4f, r: 'legendary', unlock: 'all_finish', metal: true, perk: 'gold' },
  { id: 'galaxy', name: 'Галактика', body: 0x2a2350, snout: 0x3c3270, pat: 'galaxy', r: 'legendary', box: true, perk: 'galaxy' },
  { id: 'lava', name: 'Лава', body: 0x3a2622, snout: 0x4a302a, pat: 'lava', r: 'legendary', box: true, perk: 'lava' },
  { id: 'rainbow', name: 'Радужный', body: 0xff6a6a, snout: 0xff8f8f, anim: 'rainbow', r: 'legendary', box: true, perk: 'rainbow' },
];
export const RAFTS = [
  { id: 'round', name: '⭕ Круглый плот', ic: '⭕' },
  { id: 'square', name: '⬜ Квадратный плот', ic: '⬜' },
  { id: 'tri', name: '🔺 Треугольный плот', ic: '🔺' },
];
// раскраска надувной кромки: a — основной цвет, b — второй (полосы/пятна)
export const RSKINS = [
  { id: 'classic', name: 'Классика', ic: '🛟', a: '#f3d6b6' },
  { id: 'cherry', name: 'Вишнёвый', ic: '🍒', a: '#d8323a', box: true },
  { id: 'lime', name: 'Лаймовый', ic: '🍋', a: '#9bd23c', box: true },
  { id: 'navy', name: 'Матросский', ic: '⚓', a: '#f4f6fa', b: '#2b4fa0', pat: 'stripes', r: 'rare', box: true },
  { id: 'camo', name: 'Камуфляж', ic: '🪖', a: '#7a8a5a', b: '#4a5638', pat: 'spots', r: 'rare', box: true },
  { id: 'watermelon', name: 'Арбуз', ic: '🍉', a: '#3f9a3a', b: '#2a6e28', pat: 'stripes', r: 'epic', box: true },
  { id: 'donut', name: 'Пончик', ic: '🍩', a: '#f08cb8', b: '#ffffff', pat: 'sprinkles', r: 'epic', box: true },
  { id: 'duck', name: 'Уточка', ic: '🐤', a: '#ffd23f', r: 'epic', box: true, duck: true },
  { id: 'goldraft', name: 'Золотой плот', ic: '🏆', a: '#e8b830', metal: true, r: 'legendary', box: true },
];
// след пука: цветные искорки поверх обычного газа (сам газ не меняется — по нему видно, когда он коричневый)
export const TRAILS = [
  { id: 'none', name: 'Без следа', ic: '🚫' },
  { id: 'bubbles', name: 'Пузырьки', ic: '🫧', box: true },
  { id: 'sparks', name: 'Искры', ic: '🎇', r: 'rare', box: true },
  { id: 'confetti', name: 'Конфетти', ic: '🎊', r: 'rare', box: true },
  { id: 'toxic', name: 'Ядовитый', ic: '☢️', r: 'epic', box: true },
  { id: 'stars', name: 'Звёздная пыль', ic: '✨', r: 'epic', box: true },
  { id: 'rainbow', name: 'Радуга', ic: '🌈', r: 'legendary', box: true },
];
// голос попы: rate — высота, vib — вибрато, robot — металлический призвук
export const VOICES = [
  { id: 'normal', name: 'Обычный', ic: '💨', rate: 1 },
  { id: 'bass', name: 'Басок', ic: '🔈', rate: 0.72, box: true },
  { id: 'squeak', name: 'Пищалка', ic: '🐭', rate: 1.55, r: 'rare', box: true },
  { id: 'chip', name: 'Бурундук', ic: '🐿️', rate: 2.0, r: 'rare', box: true },
  { id: 'tuba', name: 'Туба', ic: '🎺', rate: 0.55, r: 'epic', box: true, lp: 900 },
  { id: 'robot', name: 'Робот', ic: '🤖', rate: 1, r: 'epic', box: true, robot: true },
  { id: 'opera', name: 'Оперный', ic: '🎭', rate: 1.15, r: 'legendary', box: true, vib: 0.09 },
];
export const SLOTS = [
  { key: 'hat', name: 'Шапка', tab: '🎩 Шапки', list: HATS },
  { key: 'glasses', name: 'Очки', tab: '👓 Очки', list: GLASSES },
  { key: 'extra', name: 'Аксессуар', tab: '🎀 Аксессуары', list: EXTRAS },
  { key: 'body', name: 'Окрас', tab: '🎨 Окрас', list: BODIES },
  { key: 'raft', name: 'Мой плот на арене', tab: '⭕ Форма плота', list: RAFTS },
  { key: 'rskin', name: 'Раскраска плота', tab: '🛟 Раскраска', list: RSKINS },
  { key: 'trail', name: 'След пука', tab: '✨ След', list: TRAILS },
  { key: 'voice', name: 'Голос попы', tab: '🎺 Голос', list: VOICES },
];
for (const sl of SLOTS) for (const it of sl.list) { it.r = it.r || 'common'; it.slot = sl.key; it.key = sl.key + ':' + it.id; }
export const SLOT = Object.fromEntries(SLOTS.map(s => [s.key, s]));
export const ITEM = Object.fromEntries(SLOTS.flatMap(s => s.list.map(it => [it.key, it])));
export const BOX_ITEMS = SLOTS.flatMap(s => s.list.filter(it => it.box));
export const DEFAULT_LOOK = { hat: 'none', glasses: 'none', extra: 'none', body: 'grey', raft: 'round', rskin: 'classic', trail: 'none', voice: 'normal' };

export const isFree = (it) => !it.unlock && !it.box;
export function owns(it, ach, inv) {
  if (!it) return false;
  if (isFree(it)) return true;
  if (it.unlock && ach && ach[it.unlock]) return true;
  return !!(inv && inv[it.key]);
}
export function cleanLook(look, ach, inv) {
  const out = { ...DEFAULT_LOOK };
  for (const sl of SLOTS) {
    const it = sl.list.find(x => x.id === (look && look[sl.key]));
    if (it && owns(it, ach, inv)) out[sl.key] = it.id;
  }
  return out;
}
export function itemIcon(it) {
  if (it.slot === 'body') return `<i class="sw ${it.anim ? 'anim-' + it.anim : ''} ${it.pat ? 'pat-' + it.pat : ''}" style="background:#${it.body.toString(16).padStart(6, '0')}"></i>`;
  if (it.slot === 'rskin') return `<i class="sw ring ${it.pat ? 'pat-' + it.pat : ''}" style="--a:${it.a};--b:${it.b || it.a}"></i>`;
  return `<i class="ic">${it.ic || '❔'}</i>`;
}

// ------------------------------------------------------------
//  Бафы легендарок. Множители физики бегемота; у каждого есть минус.
// ------------------------------------------------------------
export const NOMODS = Object.freeze({ thrust: 1, drain: 1, regen: 1, heat: 1, cool: 1, crawl: 1, faint: 1, stinkRes: 1, stink: 1, shotSpeed: 1, shotCd: 1, eject: 1, misfire: 1, pickup: 1, ult: 1 });
export const PERKS = {
  crown:   { name: 'Царский желудок', ic: '👑', plus: 'газ тратится на 15% медленнее', minus: 'попа остывает на 15% медленнее', mods: { drain: 0.85, cool: 0.85 } },
  halo:    { name: 'Святой дух', ic: '😇', plus: 'любые обмороки на 35% короче', minus: 'тяга на 5% слабее', mods: { faint: 0.65, thrust: 0.95 } },
  astro:   { name: 'Невесомость', ic: '🧑‍🚀', plus: 'ползаешь по кромке на 30% быстрее', minus: 'газ копится на 10% медленнее', mods: { crawl: 1.3, regen: 0.9 } },
  gasmask: { name: 'Фильтр', ic: '😷', plus: 'вырубает только самый густой коричневый дым', minus: 'газ копится на 12% медленнее', mods: { stinkRes: 1.6, regen: 0.88 } },
  laser:   { name: 'Снайпер', ic: '🔴', plus: 'снаряды летят на 30% быстрее и дальше', minus: 'перезарядка на 15% дольше', mods: { shotSpeed: 1.3, shotCd: 1.15 } },
  chain:   { name: 'Тяжёлый металл', ic: '📿', plus: 'тебя на 30% труднее выбить за борт', minus: 'ползаешь на 15% медленнее', mods: { eject: 1.3, crawl: 0.85 } },
  jetpack: { name: 'Форсаж', ic: '🚀', plus: 'тяга на 10% сильнее', minus: 'попа греется на 20% быстрее', mods: { thrust: 1.1, heat: 1.2 } },
  cape:    { name: 'Огнеупорная попа', ic: '🦸', plus: 'попа греется на 25% медленнее', minus: 'тяга на 5% слабее', mods: { heat: 0.75, thrust: 0.95 } },
  gold:    { name: 'Золотой запас', ic: '💰', plus: 'газ копится на 15% быстрее', minus: 'холостые выстрелы вдвое чаще', mods: { regen: 1.15, misfire: 2 } },
  galaxy:  { name: 'Чёрная дыра', ic: '🌌', plus: 'на арене твоя вонь бьёт на 25% дальше', minus: 'газ тратится на 6% быстрее', mods: { stink: 1.25, drain: 1.06 } },
  lava:    { name: 'Горячая кровь', ic: '🌋', plus: 'попа остывает на 40% быстрее', minus: 'газ тратится на 8% быстрее', mods: { cool: 1.4, drain: 1.08 } },
  rainbow: { name: 'Везунчик', ic: '🍀', plus: 'бонусы с воды действуют на 40% дольше, мега-пук копится на 25% быстрее', minus: 'тяга на 3% слабее', mods: { pickup: 1.4, ult: 1.25, thrust: 0.97 } },
};
const PERK_SLOTS = ['hat', 'glasses', 'extra', 'body'];
export function perksOf(look) {
  const out = [];
  if (!look) return out;
  for (const k of PERK_SLOTS) { const it = ITEM[k + ':' + look[k]]; if (it && it.perk && PERKS[it.perk]) out.push({ id: it.perk, item: it, ...PERKS[it.perk] }); }
  return out;
}
export function perkMods(look, enabled = true) {
  const list = enabled ? perksOf(look) : [];
  if (!list.length) return NOMODS;
  const m = { ...NOMODS };
  for (const p of list) for (const k in p.mods) m[k] *= p.mods[k];
  return Object.freeze(m);
}
