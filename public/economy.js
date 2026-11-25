// ============================================================
//  Пукоины, подарки (ящики) и ежедневные задания.
//  Всё только за игровые пукоины — никаких настоящих денег.
// ============================================================
import { BOX_ITEMS, RARITY, RARITY_LIST, owns } from './cosmetics.js';

export const COIN = '🪙';
export const BOXES = {
  daily: { id: 'daily', name: 'Подарок дня', price: 0, color: '#e8456b', odds: { common: 70, rare: 24, epic: 5, legendary: 1 }, desc: 'Бесплатно раз в день' },
  common: { id: 'common', name: 'Коробка с сюрпризом', price: 120, color: '#c08a4e', odds: { common: 55, rare: 30, epic: 12, legendary: 3 }, desc: 'Обычные и редкие вещи, иногда эпические' },
  gold: { id: 'gold', name: 'Золотой сундук', price: 400, color: '#f2b52e', odds: { common: 0, rare: 52, epic: 34, legendary: 14 }, pity: 8, desc: 'Без обычных вещей. Легендарка — не реже чем в каждом 8-м' },
};
export const BOX_ORDER = ['daily', 'common', 'gold'];

// Награды в пукоинах
export const EARN = {
  cp: 3, finish: 25, medal: [0, 10, 20, 35], perMeters: 50, metersCoins: 4, daily: 40,
  arenaRound: 8, arenaWin: 30, ko: 5, hit: 2, goal: 6, bean: 1, mega: 0,
  ach: { common: 10, uncommon: 20, rare: 40, epic: 80, legendary: 150, mythic: 300 },
};

// Ежедневные задания: счётчик статистики профиля, цель, награда
export const QUESTS = [
  { id: 'q_farts', stat: 'farts', n: 60, coins: 40, text: 'Пукнуть 60 раз' },
  { id: 'q_ftime', stat: 'fartTime', n: 90, coins: 50, text: 'Пукать в сумме полторы минуты' },
  { id: 'q_heat', stat: 'overheats', n: 3, coins: 50, text: 'Перегреть попу 3 раза' },
  { id: 'q_shit', stat: 'shits', n: 3, coins: 40, text: 'Щёлкнуть 3 раза (газ до нуля)' },
  { id: 'q_eject', stat: 'ejects', n: 3, coins: 40, text: 'Вылететь за борт 3 раза' },
  { id: 'q_cp', stat: 'cps', n: 8, coins: 50, text: 'Пройти 8 чекпоинтов' },
  { id: 'q_fin', stat: 'finishes', n: 2, coins: 70, text: 'Доплыть до финиша 2 раза' },
  { id: 'q_m', stat: 'meters', n: 600, coins: 60, text: 'Проплыть 600 метров' },
  { id: 'q_sync', stat: 'syncs', n: 6, coins: 50, text: 'Пукнуть синхронно 6 раз' },
  { id: 'q_ko', stat: 'kos', n: 3, coins: 70, text: 'Вырубить вонью 3 соперников' },
  { id: 'q_hits', stat: 'hits', n: 8, coins: 60, text: 'Попасть калом 8 раз' },
  { id: 'q_pk', stat: 'pickups', n: 6, coins: 50, text: 'Подобрать 6 бонусов на воде' },
  { id: 'q_win', stat: 'arenaWins', n: 1, coins: 80, text: 'Выиграть раунд на арене' },
  { id: 'q_mega', stat: 'megas', n: 3, coins: 50, text: 'Сделать 3 мега-пука' },
  { id: 'q_beans', stat: 'beans', n: 10, coins: 50, text: 'Собрать 10 бобов' },
];
export const QUEST_COUNT = 3;
export const REROLL_PRICE = 30;
const hashStr = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// одни и те же задания на день для одного бегемота
export function pickQuests(date, who, salt = 0) {
  let h = hashStr(date + '|' + who + '|' + salt);
  const pool = QUESTS.slice(), out = [];
  while (out.length < QUEST_COUNT && pool.length) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; out.push(pool.splice(h % pool.length, 1)[0]); }
  return out;
}

// Розыгрыш ящика. rnd — функция [0,1). Возвращает предмет и признак повтора.
export function rollBox(boxId, ach, inv, pity = 0, rnd = Math.random) {
  const B = BOXES[boxId]; if (!B) return null;
  let rar;
  if (B.pity && pity >= B.pity - 1) rar = 'legendary';
  else {
    const tot = RARITY_LIST.reduce((s, r) => s + (B.odds[r] || 0), 0);
    let x = rnd() * tot; rar = 'common';
    for (const r of RARITY_LIST) { x -= B.odds[r] || 0; if (x < 0) { rar = r; break; } }
  }
  let pool = BOX_ITEMS.filter(it => it.r === rar);
  if (!pool.length) pool = BOX_ITEMS;
  // то, чего ещё нет, выпадает вчетверо чаще
  const w = pool.map(it => (owns(it, ach, inv) ? 1 : 4)), tw = w.reduce((a, b) => a + b, 0);
  let x = rnd() * tw, it = pool[0];
  for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x < 0) { it = pool[i]; break; } }
  const dupe = owns(it, ach, inv);
  return { key: it.key, slot: it.slot, id: it.id, r: it.r, dupe, coins: dupe ? RARITY[it.r].dupe : 0 };
}
// Лента для анимации рулетки: случайные вещи по шансам ящика + выигрыш на позиции at
export function rollStrip(boxId, win, n = 44, at = 37, rnd = Math.random) {
  const B = BOXES[boxId], out = [];
  for (let i = 0; i < n; i++) {
    if (i === at) { out.push(win); continue; }
    const r = rollBox(boxId, null, null, 0, rnd); out.push(r.key);
  }
  return out;
}

// Ранги: опыт = все заработанные пукоины. Каждый новый уровень — коробка, каждый 5-й — золотой сундук.
export const RANKS = [[1, 'Пукёныш'], [3, 'Газовичок'], [6, 'Бурлящий'], [10, 'Штормовой'], [15, 'Мастер выхлопа'], [20, 'Пукомагистр'], [30, 'Повелитель болот'], [45, 'Легенда пруда']];
export const xpNeed = (lvl) => 120 + 30 * lvl;         // сколько опыта нужно с уровня lvl на следующий
export function levelOf(xp = 0) {
  let lvl = 1, left = Math.max(0, xp);
  while (left >= xpNeed(lvl) && lvl < 99) { left -= xpNeed(lvl); lvl++; }
  let title = RANKS[0][1]; for (const [l, t] of RANKS) if (lvl >= l) title = t;
  return { lvl, cur: left, need: xpNeed(lvl), title };
}
export function rankTitle(lvl) { let t = RANKS[0][1]; for (const [l, x] of RANKS) if (lvl >= l) t = x; return t; }
