// ============================================================
//  ПУКОПЛОТ — игровой сервер
//  Запуск: Pukoplot.exe  |  bun server.mjs  |  node server.mjs  [порт] [--no-browser]
//  Docker: docker compose up -d  (PostgreSQL + сервер)
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import {
  LEVELS, ENDLESS, PHYS, MAX_PLAYERS, RIM_SEATS, isCenter, SKINS, DEFAULT_RULES, MISFIRE_LEVELS, buildTrack, frame, wrapAngle, sectorCenter,
  botDecide, medalFor, medalTimes, RAFT_SHAPES, DAILY, dailySeed, dailyMutator, localDate, CENTER_SEAT,
} from './public/shared.js';
import { ARENA_MODES, isArenaMode, createArena, arenaStep, resetBall, arenaRadius, PICKUPS, megaFart, ARENA_EVENTS, LAP_GATES } from './public/arena.js';
import { createWorld, newHippo, resetRaft, simStep, DT, raceMega } from './public/sim.js';
import { ACHIEVEMENTS, ACH, TIER } from './public/achievements.js';
import { cleanLook, DEFAULT_LOOK, perkMods, perksOf, ITEM, RARITY, BOX_ITEMS } from './public/cosmetics.js';
import { BOXES, EARN, QUESTS, pickQuests, rollBox, rollStrip, REROLL_PRICE, levelOf } from './public/economy.js';
import { openStore } from './store.mjs';

const PORT = Number(process.argv.slice(2).find(a => /^\d+$/.test(a)) || process.env.PORT || 3000);
const HEADLESS = process.argv.includes('--no-browser') || !!process.env.NO_BROWSER;

function findBaseDir() {
  const cands = [];
  try { cands.push(path.dirname(process.execPath)); } catch {}
  try { cands.push(path.dirname(fileURLToPath(import.meta.url))); } catch {}
  cands.push(process.cwd());
  for (const c of cands) if (fs.existsSync(path.join(c, 'public', 'index.html'))) return c;
  return process.cwd();
}
const BASE = findBaseDir();
const PUBLIC = path.join(BASE, 'public');
const store = await openStore(BASE);
let records = await store.getRecords();

// ------------------------------------------------------------
//  Состояние
// ------------------------------------------------------------
const players = new Map();
let nextId = 1, hostId = 0;
let phase = 'lobby';                      // lobby | count | race | results
let levelIdx = 0, seed = 1;
let W = createWorld(buildTrack(0));
let raceStart = 0, countEnd = 0, lives = 0, gameOverAt = 0, lastS = 0, goT = 0;
let race = null;                          // статистика текущего заезда
let currentResults = null;
let rules = { ...DEFAULT_RULES };
// Арена: режим, мир, очки команд, турнирная таблица (живёт, пока хост не сбросит)
let gameMode = 'race', AW = null, arenaTeams = [], score = [], resetBallAt = 0, arenaStat = null;
const TEAM_COLORS = ['#ff8a1f', '#2b9be0'];
let tour = { rounds: 0, rows: {} };
const PLACE_PTS = [5, 3, 2, 1, 0];
const clock0 = performance.now();
const now = () => (performance.now() - clock0) / 1000;

const racers = () => [...players.values()].filter(p => p.seat >= 0).sort((a, b) => a.seat - b.seat);
const humans = () => [...players.values()].filter(p => p.named && !p.isBot);
const byHippo = (h) => players.get(h.id);
const inRace = () => phase === 'race';

function syncWorldHippos() { W.hippos = racers().map(p => { p.h.seat = p.seat; return p.h; }); }
function assignSeats() {
  if (phase === 'race' || phase === 'count') { racers().forEach((p, i) => p.seat = i); syncWorldHippos(); return; }
  const all = [...players.values()].filter(p => p.named).sort((a, b) => a.joinOrder - b.joinOrder);
  for (const p of players.values()) if (!p.named) p.seat = -1;
  all.forEach((p, i) => p.seat = i < MAX_PLAYERS ? i : -1);
  syncWorldHippos();
  resetRaft(W, W.raft.cpS || 3);
  if (isArenaMode(gameMode)) buildArena();
}

function setLevel(i, newSeed = seed) {
  levelIdx = Math.max(0, Math.min(DAILY, i | 0));
  if (levelIdx === DAILY) newSeed = dailySeed(localDate());
  seed = newSeed;
  W = createWorld(buildTrack(levelIdx, seed));
  W.rules = rules;
  syncWorldHippos();
  resetRaft(W, 3);
}

// ------------------------------------------------------------
//  Профили и достижения
// ------------------------------------------------------------
const hashPin = (pin, salt) => crypto.createHash('sha256').update(salt + ':' + pin).digest('hex');
const emptyData = () => ({ s: {}, sets: {}, ach: {}, pinned: [], look: { ...DEFAULT_LOOK }, skin: 0, bests: {}, lookChanges: 0 });
const dirtyProfiles = new Set();

function profileOut(p) {           // то, что видит сам игрок
  const pr = p.profile; if (!pr) return null;
  return { name: pr.name, data: pr.data, achCount: pr.ach_count, endlessBest: pr.endless_best, hasPin: !!pr.pin_hash };
}
function sendMe(p) { if (p.profile) p.conn.send(JSON.stringify({ t: 'me', p: profileOut(p) })); }
function markDirty(p) { if (p.profile) dirtyProfiles.add(p.profile); }

function grant(p, id) {
  const pr = p && p.profile; if (!pr || !ACH[id] || pr.data.ach[id]) return;
  pr.data.ach[id] = Date.now();
  pr.ach_count = Object.keys(pr.data.ach).length;
  markDirty(p);
  broadcast({ t: 'ev', k: 'ach', id: p.id, who: p.name, a: id });
  addCoins(p, EARN.ach[ACH[id].tier] || 0, 'достижение', true);
  sendMe(p);
  if (pr.ach_count >= 25) grant(p, 'ach_25');
  if (pr.ach_count >= 50) grant(p, 'ach_50');
  if (pr.ach_count >= 100) grant(p, 'ach_100');
}
const BY_STAT = {};
for (const a of ACHIEVEMENTS) if (a.kind === 'count' || a.kind === 'max') (BY_STAT[a.stat] = BY_STAT[a.stat] || []).push(a);
function bump(p, stat, v = 1, force = false) {
  const pr = p && p.profile; if (!pr || !force && !inRace() && stat !== 'emotes') return;
  pr.data.s[stat] = (pr.data.s[stat] || 0) + v;
  markDirty(p);
  for (const a of BY_STAT[stat] || []) if (pr.data.s[stat] >= a.goal) grant(p, a.id);
  if (QSTATS.has(stat)) questCheck(p, stat);
}
function setMax(p, stat, v) {
  const pr = p && p.profile; if (!pr) return;
  if ((pr.data.s[stat] || 0) < v) { pr.data.s[stat] = v; markDirty(p); }
  for (const a of BY_STAT[stat] || []) if (pr.data.s[stat] >= a.goal) grant(p, a.id);
}
function addToSet(p, setName, item) {
  const pr = p && p.profile; if (!pr) return;
  const arr = pr.data.sets[setName] = pr.data.sets[setName] || [];
  if (!arr.includes(item)) { arr.push(item); markDirty(p); }
  const a = ACHIEVEMENTS.find(x => x.kind === 'set' && x.stat === setName && x.item === item); if (a) grant(p, a.id);
  const full = (n) => (pr.data.sets[n] || []).filter(i => i < ENDLESS).length >= ENDLESS;
  if (full('finished')) grant(p, 'all_finish');
  if (full('gold')) grant(p, 'all_gold');
  if (full('clean')) grant(p, 'all_clean');
}
async function flushProfiles() {
  const t0 = performance.now();
  for (const pr of [...dirtyProfiles]) {
    dirtyProfiles.delete(pr);
    pr.endless_best = pr.data.s.endlessBest || 0;
    try { await store.saveProfile(pr); } catch (e) { console.log('  Не удалось сохранить профиль:', e.message); }
  }
  const ms = performance.now() - t0; if (ms > 60) console.log(`  (сохранение профилей заняло ${Math.round(ms)} мс)`);
}
// Сохраняем профили редко во время заезда (диск не должен мешать игре) и сразу — в лобби/после финиша
let lastFlush = 0;
setInterval(() => { const t = now(); if ((phase === 'race' || phase === 'count') && t - lastFlush < 45) return; lastFlush = t; flushProfiles(); }, 5000);
// Сервер важнее браузера на том же компьютере
try { os.setPriority(0, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch {}


// ------------------------------------------------------------
//  Пукоины, подарки, ежедневные задания
// ------------------------------------------------------------
const DEV = { coins: +process.env.PUK_DEV_COINS || 0, all: process.env.PUK_DEV_ALL || '', ult: +process.env.PUK_DEV_ULT || 1 };
const QSTATS = new Set(QUESTS.map(q => q.stat));
const QBYID = Object.fromEntries(QUESTS.map(q => [q.id, q]));
// Кошелёк профиля. При первом входе в новую версию — стартовый капитал за уже открытые достижения
function ensureEco(d) {
  let welcome = 0;
  if (typeof d.coins !== 'number') {
    let c = 0; for (const id in d.ach || {}) { const a = ACH[id]; if (a) c += EARN.ach[a.tier] || 0; }
    welcome = 150 + c; d.coins = welcome;
    d.boxes = { common: 0, gold: 1 };
  }
  d.boxes = d.boxes || { common: 0, gold: 0 }; d.inv = d.inv || {}; d.pity = d.pity || 0;
  if (typeof d.xp !== 'number') d.xp = (d.s && d.s.coinsEarned) || 0;      // опыт с прошлой версии
  if (DEV.coins && d.coins < DEV.coins) d.coins = DEV.coins;          // только для тестов (переменные окружения)
  return welcome;
}
function ensureQuests(p) {
  const d = p.profile.data, date = localDate();
  if (d.quests && d.quests.date === date) return;
  d.quests = { date, rerolled: false, list: pickQuests(date, p.profile.id).map(q => ({ id: q.id, base: d.s[q.stat] || 0, done: false })) };
  markDirty(p);
}
function questCheck(p, stat) {
  const d = p.profile.data; if (!d.quests || d.quests.date !== localDate()) return;
  for (const q of d.quests.list) {
    const Q = QBYID[q.id]; if (!Q || q.done || Q.stat !== stat) continue;
    if ((d.s[stat] || 0) - q.base >= Q.n) {
      q.done = true;
      p.conn.send(JSON.stringify({ t: 'quest', id: q.id }));
      addCoins(p, Q.coins, 'задание', true);
      bump(p, 'quests', 1, true);
      sendMe(p);
    }
  }
}
function addCoins(p, n, why, silent = false) {
  const pr = p && p.profile; if (!pr || !(n > 0)) return;
  ensureEco(pr.data);
  pr.data.coins += n; markDirty(p);
  p.conn.send(JSON.stringify({ t: 'coins', n, why, total: pr.data.coins }));
  const d = pr.data, before = levelOf(d.xp).lvl; d.xp += n;
  const after = levelOf(d.xp);
  if (after.lvl > before) {
    for (let l = before + 1; l <= after.lvl; l++) { if (l % 5 === 0) d.boxes.gold = (d.boxes.gold || 0) + 1; else d.boxes.common = (d.boxes.common || 0) + 1; }
    broadcast({ t: 'ev', k: 'levelup', id: p.id, who: p.name, lvl: after.lvl, title: after.title, gold: after.lvl % 5 === 0 });
    if (after.lvl >= 10) grant(p, 'lvl_10');
    if (after.lvl >= 25) grant(p, 'lvl_25');
    sendMe(p); sendRoom();
  }
  bump(p, 'coinsEarned', n, true);
}
function shopErr(p, msg) { p.conn.send(JSON.stringify({ t: 'shopres', err: msg })); }
function shop(p, m) {
  if (!p.profile) return shopErr(p, 'Подарки копятся в профиле: войдите под своим именем');
  const d = p.profile.data; ensureEco(d); ensureQuests(p);
  const date = localDate();
  switch (m.a) {
    case 'buy': {
      const B = BOXES[m.box]; if (!B || !B.price) return;
      if (d.coins < B.price) return shopErr(p, 'Не хватает пукоинов');
      d.coins -= B.price; d.boxes[B.id] = (d.boxes[B.id] || 0) + 1; markDirty(p);
      sendMe(p); break;
    }
    case 'open': {
      const B = BOXES[m.box]; if (!B) return;
      if (B.id === 'daily') { if (d.giftDate === date) return shopErr(p, 'Подарок дня уже открыт — приходите завтра'); d.giftDate = date; }
      else { if (!(d.boxes[B.id] > 0)) return shopErr(p, 'Такого подарка нет'); d.boxes[B.id]--; }
      const res = rollBox(B.id, d.ach, d.inv, B.pity ? d.pity : 0);
      if (B.pity) d.pity = res.r === 'legendary' ? 0 : d.pity + 1;
      if (res.dupe) d.coins += res.coins; else d.inv[res.key] = Date.now();
      markDirty(p);
      bump(p, 'boxes', 1, true);
      if (!res.dupe) bump(p, 'collected', 1, true);
      if (res.r === 'legendary' && !res.dupe) bump(p, 'legends', 1, true);
      if (res.r === 'legendary' || res.r === 'epic') broadcast({ t: 'ev', k: 'drop', id: p.id, who: p.name, key: res.key, r: res.r });
      const at = 37;
      p.conn.send(JSON.stringify({ t: 'boxres', box: B.id, res, strip: rollStrip(B.id, res.key, 44, at), at }));
      sendMe(p); break;
    }
    case 'gift': {
      const B = BOXES[m.box], to = players.get(m.to | 0);
      if (!B || !B.price || !to || to === p || !to.profile) return shopErr(p, 'Дарить можно бегемотам с профилем');
      if (d.coins < B.price) return shopErr(p, 'Не хватает пукоинов');
      d.coins -= B.price; markDirty(p);
      const td = to.profile.data; ensureEco(td); td.boxes[B.id] = (td.boxes[B.id] || 0) + 1; markDirty(to);
      broadcast({ t: 'ev', k: 'gift', from: p.name, to: to.name, toId: to.id, box: B.id });
      bump(p, 'gifts', 1, true);
      sendMe(p); sendMe(to); break;
    }
    case 'reroll': {
      if (d.quests.rerolled) return shopErr(p, 'Задания можно заменить только раз в день');
      if (d.coins < REROLL_PRICE) return shopErr(p, 'Не хватает пукоинов');
      d.coins -= REROLL_PRICE; d.quests.rerolled = true;
      const keep = d.quests.list.filter(q => q.done), have = new Set(keep.map(q => q.id));
      const fresh = pickQuests(date, p.profile.id, 7).filter(q => !have.has(q.id) && !d.quests.list.some(o => o.id === q.id));
      const pool = fresh.length ? fresh : QUESTS.filter(q => !have.has(q.id));
      d.quests.list = keep.concat(pool.slice(0, 3 - keep.length).map(q => ({ id: q.id, base: d.s[q.stat] || 0, done: false })));
      markDirty(p); sendMe(p); break;
    }
  }
}
// Бафы легендарок — одинаково на сервере и у всех в браузере (по составу комнаты)
function applyPerks() {
  for (const p of players.values()) {
    const mods = perkMods(p.look, rules.perks !== false);
    p.h.pk = mods; if (p.ah) p.ah.pk = mods;
  }
}
// Мега-пук: копится за игру, срабатывает по кнопке
const ULT = { race: 1 / 90, arena: 1 / 50, lobby: 1 / 4 };
// Арена: события раз в полминуты, очки за выживание в «Зомби-пуке»
let nextEvt = 0, zTick = 0;
function arenaExtras() {
  const M = ARENA_MODES[gameMode];
  if (rules.events !== false && gameMode !== 'ball') {
    if (!nextEvt) nextEvt = simT + 22 + Math.random() * 10;
    if (simT >= nextEvt) {
      const kinds = Object.keys(ARENA_EVENTS), k = kinds[(Math.random() * kinds.length) | 0], E = ARENA_EVENTS[k];
      AW.event = { k, until: simT + E.dur, ang: Math.random() * Math.PI * 2 };
      if (k === 'rain') for (let i = 0; i < 9; i++) { const a = Math.random() * Math.PI * 2, d = 4 + Math.sqrt(Math.random()) * (arenaRadius(AW, simT) - 7); AW.pickups.push({ id: AW.pkId++, kind: Math.random() < 0.15 ? 'gold' : 'bean', x: Math.sin(a) * d, z: Math.cos(a) * d, t0: simT }); }
      broadcast({ t: 'ev', k: 'aevent', e: k, ang: +AW.event.ang.toFixed(3) });
      nextEvt = simT + 30 + Math.random() * 15;
    }
  }
  if (M.zombie) {
    zTick += DT;
    if (zTick >= 2) { zTick -= 2; for (const R of AW.rafts) if (!R.inf && R.status === 0 && !R.out) addScore(R.team); }
    if (phase === 'race' && AW.rafts.length > 1 && AW.rafts.every(R => R.inf)) {
      const mx = Math.max(...score), lead = score.filter(v => v === mx).length === 1 ? score.indexOf(mx) : -1;
      finishArena(simT, lead);
    }
  }
}
function chargeUlt(h, v) { if (h && rules.ult !== false) h.ult = Math.min(1, (h.ult || 0) + v * ((h.pk && h.pk.ult) || 1) * DEV.ult); }
function chargeTeam(team, v) { const t = arenaTeams[team]; if (t) for (const id of t.members) { const q = players.get(id); if (q) chargeUlt(q.ah, v); } }
function doMega(p) {
  if (rules.ult === false || !(phase === 'race' || phase === 'lobby')) return;
  const T = simT;
  if (isArenaMode(gameMode) && AW) {
    const h = p.ah; if (!h || (h.ult || 0) < 1) return;
    const R = AW.rafts[h.raft];
    if (!R || R.status !== 0 || R.out || h.offUntil > T || T < h.faintUntil || T < h.stunUntil) return;
    h.ult = 0; h.megaT = T;
    const r = megaFart(AW, R, h, T);
    broadcast({ t: 'ev', k: 'mega', id: h.id, who: p.name, x: +r.x.toFixed(2), z: +r.z.toFixed(2), cx: +r.cx.toFixed(2), cz: +r.cz.toFixed(2), arena: 1, hit: r.hit });
  } else {
    const h = p.h; if (p.seat < 0 || (h.ult || 0) < 1 || W.raft.status !== 0 || h.offUntil > T || T < h.faintUntil || T < h.stunUntil) return;
    h.ult = 0;
    const r = raceMega(W, h, T);
    broadcast({ t: 'ev', k: 'mega', id: h.id, who: p.name, x: +r.x.toFixed(2), z: +r.z.toFixed(2), dx: +r.dx.toFixed(3), dz: +r.dz.toFixed(3) });
  }
  bump(p, 'megas');
}

async function login(p, m) {
  const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Бегемот';
  const key = name.toLowerCase(), pin = String(m.pin || '').replace(/\D/g, '').slice(0, 6);
  if ([...players.values()].some(q => q !== p && q.profile && q.profile.name_key === key)) return { fail: 'Бегемот с таким именем уже на плоту' };
  let pr = await store.getProfile(key);
  if (pr) {
    if (pr.pin_hash && hashPin(pin, pr.salt) !== pr.pin_hash) return { fail: pin ? 'Неверный PIN для этого имени' : 'Это имя защищено PIN-кодом' };
    if (!pr.pin_hash && pin) { pr.salt = crypto.randomBytes(8).toString('hex'); pr.pin_hash = hashPin(pin, pr.salt); }
    pr.data = { ...emptyData(), ...pr.data };
  } else {
    const salt = crypto.randomBytes(8).toString('hex');
    pr = { id: crypto.randomUUID(), name_key: key, name, pin_hash: pin ? hashPin(pin, salt) : null, salt, data: emptyData(), ach_count: 0, endless_best: 0 };
    await store.createProfile(pr);
  }
  return { pr, name };
}

// ------------------------------------------------------------
//  События мира → рассылка, статистика, достижения
// ------------------------------------------------------------
const rstat = (p, k, v = 1) => { if (race && p) { const r = race.p[p.id] = race.p[p.id] || {}; r[k] = (r[k] || 0) + v; } };
const EV = {
  back(h) { const p = byHippo(h); broadcast({ t: 'ev', k: 'back', id: h.id, who: p && p.name }); },
  fartStart(h) {
    const p = byHippo(h); bump(p, 'farts');
    if (inRace() && now() - goT < 0.3) grant(p, 'false_start');
  },
  fartTick(h) { const p = byHippo(h); rstat(p, 'fartTime', DT); bump(p, 'fartTime', DT); },
  sync(n, ids) {
    broadcast({ t: 'ev', k: 'sync', n });
    if (race) { race.syncs++; race.bestSync = Math.max(race.bestSync, n); }
    for (const id of ids) { const p = players.get(id); bump(p, 'syncs'); if (n >= 3) bump(p, 'sync3'); if (n >= 4) bump(p, 'sync4'); if (p && inRace()) chargeUlt(p.h, 0.05); }
  },
  overheat(h) {
    const p = byHippo(h); broadcast({ t: 'ev', k: 'overheat', id: h.id, who: p && p.name });
    bump(p, 'overheats'); rstat(p, 'overheats');
    if (race && race.p[h.id] && race.p[h.id].overheats >= 3) grant(p, 'hot_race');
    comboCheck(p);
  },
  shit(h, pd) {
    const p = byHippo(h); broadcast({ t: 'ev', k: 'shit', id: h.id, who: p && p.name, pd });
    bump(p, 'shits'); rstat(p, 'shits'); comboCheck(p);
  },
  misfire(h, pd) {
    const p = byHippo(h); broadcast({ t: 'ev', k: 'misfire', id: h.id, who: p && p.name, pd });
    bump(p, 'misfires'); rstat(p, 'misfires'); comboCheck(p);
  },
  sprayRelease(h) { bump(byHippo(h), 'sprayRelease'); },
  burp(h) { const p = byHippo(h); broadcast({ t: 'ev', k: 'burp', id: h.id, who: p && p.name }); bump(p, 'burps'); },
  eject(h, x, z, dx, dz, cause) {
    const p = byHippo(h);
    broadcast({ t: 'ev', k: 'eject', id: h.id, who: p && p.name, x: +x.toFixed(2), z: +z.toFixed(2), dx: +dx.toFixed(3), dz: +dz.toFixed(3) });
    bump(p, 'ejects'); rstat(p, 'ejects');
    if (cause === 'geyser') bump(p, 'geysers');
    if (p) { const t = now(); if (p.lastEjectT && t - p.lastEjectT < 15) grant(p, 'double_eject'); p.lastEjectT = t; }
  },
  faint(h, ownerId) {
    const p = byHippo(h), o = players.get(ownerId);
    broadcast({ t: 'ev', k: 'faint', id: h.id, who: p && p.name, by: o && o.id !== h.id ? o.name : null, sec: rules.faintTime });
    bump(p, 'faints'); rstat(p, 'faints');
    if (o && o.id !== h.id) { bump(o, 'gassed'); rstat(o, 'gassed'); }
  },
  gasCombo(ownerId) { grant(players.get(ownerId), 'gassed_all'); },
  geyser(o) { broadcast({ t: 'ev', k: 'geyser', s: o.s }); },
  crash(kind) {
    const T = now();
    let best = null, bt = -1;
    for (const p of racers()) if (p.h.lastFart > bt) { bt = p.h.lastFart; best = p; }
    const b = best && T - bt < 2.2 ? best : null;
    if (race) { race.crashes[kind] = (race.crashes[kind] || 0) + 1; race.crashTotal++; }
    if (b) { bump(b, 'blame'); rstat(b, 'blame'); if (race && race.p[b.id].blame >= 3) grant(b, 'triple_blame'); }
    const statName = { pop: 'pops', bite: 'bites', smash: 'smashes', fall: 'falls' }[kind];
    for (const p of racers()) bump(p, statName);
    let gameOver = false;
    if (levelIdx >= ENDLESS && inRace()) { lives--; if (lives <= 0) { gameOver = true; gameOverAt = T + 1.6; W.raft.statusT = T + 1000; } }
    broadcast({ t: 'ev', k: kind, who: b ? b.name : null, x: +W.raft.x.toFixed(2), z: +W.raft.z.toFixed(2), lives, over: gameOver });
    const bots = racers().filter(q => q.isBot);
    if (bots.length && Math.random() < 0.6) { const q = bots[(Math.random() * bots.length) | 0]; setTimeout(() => emote(q, q === b ? 4 : (Math.random() < 0.5 ? 4 : 1), now()), 700); }
  },
  respawn() { broadcast({ t: 'ev', k: 'respawn' }); },
  cp(n, of) { broadcast({ t: 'ev', k: 'cp', n, of }); for (const p of racers()) { bump(p, 'cps'); if (inRace()) { addCoins(p, EARN.cp, 'чекпоинт'); chargeUlt(p.h, 0.12); } } },
  finish() { if (phase === 'race') finishRace(now()); else { W.raft.cp = -1; W.raft.cpS = 3; resetRaft(W, 3); broadcast({ t: 'ev', k: 'respawn' }); } },
  extended() { broadcast({ t: 'ev', k: 'grow', len: W.tr.length }); },
  pickup(pk) { broadcast({ t: 'ev', k: 'rpickup', kind: pk.kind, pkid: pk.id, x: +pk.x.toFixed(2), z: +pk.z.toFixed(2) }); for (const p of racers()) { bump(p, 'pickups'); if (inRace()) chargeUlt(p.h, 0.08); } },
};
function comboCheck(p) { const r = race && p && race.p[p.id]; if (r && r.misfires && r.overheats && r.shits) grant(p, 'combo'); }

// ------------------------------------------------------------
//  Арена
// ------------------------------------------------------------
const arenaPlayers = () => racers().filter(p => !p.isBot);
function makeTeams() {
  const ps = arenaPlayers(), M = ARENA_MODES[gameMode], teams = [];
  if (gameMode === 'ball') { for (let t = 0; t < 2; t++) teams.push({ id: t, members: ps.filter((_, i) => i % 2 === t).map(p => p.id) }); }
  else if (M.per === 2) { for (let i = 0; i < ps.length; i += 2) teams.push({ id: teams.length, members: ps.slice(i, i + 2).map(p => p.id) }); }
  else ps.forEach((p, i) => teams.push({ id: i, members: [p.id] }));
  for (const t of teams) { const p = players.get(t.members[0]); t.shape = (p && p.look && p.look.raft) || 'round'; t.rskin = (p && p.look && p.look.rskin) || 'classic'; }
  return teams.filter(t => t.members.length);
}
function teamName(t) {
  if (gameMode === 'ball') return t.id === 0 ? 'Оранжевые' : 'Синие';
  return t.members.map(id => (players.get(id) || {}).name || '?').join(' + ');
}
function teamColor(t) { if (gameMode === 'ball') return TEAM_COLORS[t.id]; const p = players.get(t.members[0]); return p ? SKINS[p.skin].css : '#999'; }
function buildArena() {
  for (const p of players.values()) p.ah = null;
  arenaTeams = makeTeams();
  AW = createArena(gameMode, arenaTeams, seed);
  AW.rules = rules;
  for (const h of AW.hippos) { const p = players.get(h.id); if (p) p.ah = h; }
  score = arenaTeams.map(() => 0);
  aLives = arenaTeams.map(() => ARENA_MODES[gameMode].lives || 0);
  if (ARENA_MODES[gameMode].lives) score = aLives.slice();
  applyPerks();
}
function arenaInfo() {
  if (!isArenaMode(gameMode) || !AW) return null;
  return { mode: gameMode, seed, teams: arenaTeams.map(t => ({ id: t.id, name: teamName(t), color: teamColor(t), members: t.members, shape: t.shape, rskin: t.rskin })), score };
}
function setMode(m) {
  gameMode = isArenaMode(m) ? m : 'race';
  if (isArenaMode(gameMode)) { seed = (Math.random() * 1e6) | 0; buildArena(); } else { AW = null; for (const p of players.values()) p.ah = null; }
}
const aPlayerOf = (h) => players.get(h.id);
const hungerLike = () => !!(ARENA_MODES[gameMode] && ARENA_MODES[gameMode].ko);
let aLives = [];         // «Последний на плаву»: жизни команд
function addScore(team, n = 1) {
  if (phase !== 'race' || team < 0 || team >= score.length) return;
  score[team] += n;
  if (score[team] >= ARENA_MODES[gameMode].goal) finishArena(now(), team);
}
const AEV = {
  back(h) { broadcast({ t: 'ev', k: 'back', id: h.id }); },
  fartStart(h) { bump(aPlayerOf(h), 'farts'); },
  fartTick(h) { const p = aPlayerOf(h); bump(p, 'fartTime', DT); },
  overheat(h) { const p = aPlayerOf(h); broadcast({ t: 'ev', k: 'overheat', id: h.id, who: p && p.name }); bump(p, 'overheats'); },
  shit(h) { const p = aPlayerOf(h); broadcast({ t: 'ev', k: 'shit', id: h.id, who: p && p.name }); bump(p, 'shits'); },
  misfire(h) { const p = aPlayerOf(h); broadcast({ t: 'ev', k: 'misfire', id: h.id, who: p && p.name }); bump(p, 'misfires'); },
  burp(h) { const p = aPlayerOf(h); broadcast({ t: 'ev', k: 'burp', id: h.id, who: p && p.name }); bump(p, 'burps'); },
  eject(h, x, z, dx, dz) { const p = aPlayerOf(h); broadcast({ t: 'ev', k: 'eject', id: h.id, who: p && p.name, x: +x.toFixed(2), z: +z.toFixed(2), dx: +dx.toFixed(3), dz: +dz.toFixed(3) }); bump(p, 'ejects'); },
  bump(P, Q, v) { broadcast({ t: 'ev', k: 'abump', a: P.id, b: Q.id, v: +v.toFixed(1) }); },
  pop(R, cause, by) {
    let out = false;
    if (ARENA_MODES[gameMode].lives && phase === 'race') {
      aLives[R.team] = Math.max(0, aLives[R.team] - 1); score[R.team] = aLives[R.team];
      if (aLives[R.team] === 0) { R.out = true; out = true; }
    }
    broadcast({ t: 'ev', k: 'apop', raft: R.id, team: R.team, by, x: +R.x.toFixed(2), z: +R.z.toFixed(2), cause, out, lives: aLives[R.team] });
    for (const h of R.hippos) bump(aPlayerOf(h), 'pops');
    if (by >= 0 && phase === 'race') {
      const t = arenaTeams[by]; if (t) for (const id of t.members) grant(players.get(id), 'ring_out');
      if (hungerLike()) addScore(by);
    }
    if (ARENA_MODES[gameMode].lives && phase === 'race') {
      const alive = arenaTeams.filter((t, i) => aLives[i] > 0);
      if (alive.length <= 1 && arenaTeams.length > 1) finishArena(now(), alive.length ? arenaTeams.indexOf(alive[0]) : -1);
      else if (alive.length === 0) finishArena(now(), -1);
    }
  },
  shot(h, p) { broadcast({ t: 'ev', k: 'shot', pid: p.id, id: h.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), vx: +p.vx.toFixed(2), vz: +p.vz.toFixed(2), T: +p.t0.toFixed(3), life: p.life }); bump(aPlayerOf(h), 'shots'); },
  shotLand(p, x, z, what) { broadcast({ t: 'ev', k: 'shotland', pid: p.id, x: +x.toFixed(2), z: +z.toFixed(2), what }); },
  shotHit(p, h, x, z) {
    const o = players.get(p.owner), v = aPlayerOf(h), T = now();
    broadcast({ t: 'ev', k: 'shothit', pid: p.id, id: h.id, who: v && v.name, by: o ? o.name : null, x: +x.toFixed(2), z: +z.toFixed(2) });
    if (phase !== 'race') return;
    bump(o, 'hits'); bump(v, 'faints'); addCoins(o, EARN.hit, 'попадание'); chargeUlt(o && o.ah, 0.15); chargeUlt(h, 0.1);
    arenaStat.kos[p.owner] = (arenaStat.kos[p.owner] || 0) + 1; arenaStat.faints[h.id] = (arenaStat.faints[h.id] || 0) + 1;
    if (o) { const times = (arenaStat.koT[o.id] = (arenaStat.koT[o.id] || []).filter(t => T - t < 10)); times.push(T); if (times.length >= 3) grant(o, 'triple_ko'); }
    addScore(p.team);
  },
  pickup(R, pk) {
    broadcast({ t: 'ev', k: 'pickup', raft: R.id, team: R.team, kind: pk.kind, pkid: pk.id, x: +pk.x.toFixed(2), z: +pk.z.toFixed(2) });
    if (phase !== 'race') return;
    const t = arenaTeams[R.team]; if (t) for (const id of t.members) { const q = players.get(id); bump(q, 'pickups'); chargeUlt(q && q.ah, 0.1); if (pk.kind === 'bean' || pk.kind === 'gold') { bump(q, 'beans'); addCoins(q, EARN.bean * (pk.kind === 'gold' ? 3 : 1), 'боб'); } }
    if (ARENA_MODES[gameMode].beans && (pk.kind === 'bean' || pk.kind === 'gold')) addScore(R.team, pk.kind === 'gold' ? 3 : 1);
  },
  respawn(R) { broadcast({ t: 'ev', k: 'arespawn', raft: R.id }); },
  faint(h, ownerId, team, mega) {
    const p = aPlayerOf(h), o = players.get(ownerId), T = now();
    if (phase === 'race') chargeUlt(h, 0.1);
    broadcast({ t: 'ev', k: 'faint', id: h.id, who: p && p.name, by: o ? o.name : null, sec: rules.faintTime, arena: 1 });
    bump(p, 'faints');
    if (arenaStat && phase === 'race') { (arenaStat.faints[h.id] = (arenaStat.faints[h.id] || 0) + 1); }
    if (o && phase === 'race') {
      bump(o, 'kos'); bump(o, 'gassed'); addCoins(o, EARN.ko, 'нокаут'); chargeUlt(o.ah, 0.25);
      if (mega) { const mk = (arenaStat.megaKo[o.id] = (arenaStat.megaKo[o.id] || []).filter(t => T - t < 3)); mk.push(T); if (mk.length >= 2) grant(o, 'mega_ko'); }
      arenaStat.kos[o.id] = (arenaStat.kos[o.id] || 0) + 1;
      const times = (arenaStat.koT[o.id] = (arenaStat.koT[o.id] || []).filter(t => T - t < 10)); times.push(T);
      if (times.length >= 3) grant(o, 'triple_ko');
    }
    if (hungerLike()) addScore(team);
  },
  kingPoint(team) { addScore(team); },
  bombNew(R, sec) { broadcast({ t: 'ev', k: 'bombnew', raft: R.id, team: R.team, sec: Math.round(sec) }); },
  bombPass(P, Q) {
    broadcast({ t: 'ev', k: 'bombpass', from: P.id, to: Q.id, fromTeam: P.team, toTeam: Q.team, x: +Q.x.toFixed(2), z: +Q.z.toFixed(2) });
    if (phase === 'race') { const t = arenaTeams[P.team]; if (t) for (const id of t.members) bump(players.get(id), 'bombPasses'); }
  },
  bombBoom(R) { broadcast({ t: 'ev', k: 'boom', raft: R.id, team: R.team, x: +R.x.toFixed(2), z: +R.z.toFixed(2) }); },
  infect(Q, P) {
    broadcast({ t: 'ev', k: 'infect', raft: Q.id, team: Q.team, by: P ? P.team : -1, x: +Q.x.toFixed(2), z: +Q.z.toFixed(2) });
    if (P && phase === 'race') { addScore(P.team, 5); const t = arenaTeams[P.team]; if (t) for (const id of t.members) { bump(players.get(id), 'infects'); addCoins(players.get(id), EARN.ko, 'заражение'); } }
  },
  gate(R) { broadcast({ t: 'ev', k: 'gate', raft: R.id, team: R.team, gate: R.gate }); },
  lap(R) {
    broadcast({ t: 'ev', k: 'lap', raft: R.id, team: R.team, lap: R.lap, name: arenaTeams[R.team] ? teamName(arenaTeams[R.team]) : '' });
    if (phase === 'race') { const t = arenaTeams[R.team]; if (t) for (const id of t.members) { bump(players.get(id), 'laps'); addCoins(players.get(id), EARN.goal, 'круг'); } }
    addScore(R.team);
  },
  goal(team, lastTouch) {
    broadcast({ t: 'ev', k: 'goal', team, own: lastTouch >= 0 && lastTouch !== team, name: arenaTeams[team] ? teamName(arenaTeams[team]) : '' });
    if (phase === 'race') { const t = arenaTeams[team]; if (t) for (const id of t.members) { bump(players.get(id), 'goals'); addCoins(players.get(id), EARN.goal, 'гол'); chargeTeam(team, 0.2); } arenaStat.conceded[1 - team] = (arenaStat.conceded[1 - team] || 0) + 1; }
    resetBallAt = now() + 1.6;
    addScore(team);
  },
};
function finishArena(T, winTeam = -1, aborted = false) {
  if (phase !== 'race') return;
  phase = 'results';
  const M = ARENA_MODES[gameMode];
  const order = arenaTeams.map((t, i) => ({ t, i, sc: score[i], fn: t.members.reduce((a, id) => a + (arenaStat.faints[id] || 0), 0) }))
    .sort((a, b) => (b.i === winTeam) - (a.i === winTeam) || b.sc - a.sc || a.fn - b.fn);
  let place = 0;
  const table = order.map((o, k) => { if (k > 0 && !(o.sc === order[k - 1].sc && o.i !== winTeam && order[k - 1].i !== winTeam)) place = k; return { ...o, place }; });
  if (!aborted) tour.rounds++;
  for (const r of aborted ? [] : table) for (const id of r.t.members) {
    const p = players.get(id); if (!p) continue;
    addCoins(p, EARN.arenaRound + (r.place === 0 && r.i === winTeam ? EARN.arenaWin : 0), r.place === 0 && r.i === winTeam ? 'победа' : 'раунд');
    const key = p.name.toLowerCase();
    const row = tour.rows[key] = tour.rows[key] || { name: p.name, pts: 0, wins: 0, kos: 0, faints: 0, rounds: 0, skin: p.skin };
    row.name = p.name; row.skin = p.skin; row.rounds++;
    row.pts += PLACE_PTS[Math.min(r.place, PLACE_PTS.length - 1)] + (arenaStat.kos[id] || 0);
    row.kos += arenaStat.kos[id] || 0; row.faints += arenaStat.faints[id] || 0;
    if (r.place === 0 && r.i === winTeam) {
      row.wins++; bump(p, 'arenaWins', 1, true);
      if (hungerLike() && !(arenaStat.faints[id] > 0)) grant(p, 'flawless');
      if (gameMode === 'king') grant(p, 'king_win');
      if (ARENA_MODES[gameMode].shrink) grant(p, 'royale_win');
      if (ARENA_MODES[gameMode].bomb) grant(p, 'bomb_win');
      if (ARENA_MODES[gameMode].laps) grant(p, 'laps_win');
      if (ARENA_MODES[gameMode].zombie) grant(p, 'zombie_win');
      if (ARENA_MODES[gameMode].shoot) grant(p, 'shot_win');
      if (ARENA_MODES[gameMode].beans) grant(p, 'beans_win');
      if (gameMode === 'ball' && !(arenaStat.conceded[r.i] > 0)) grant(p, 'shutout');
    }
    if (row.pts >= 25) grant(p, 'champ');
  }
  const res = {
    arena: true, mode: gameMode, time: T - raceStart, winner: winTeam, aborted,
    teams: table.map(r => ({ name: teamName(r.t), color: teamColor(r.t), score: r.sc, place: r.place, members: r.t.members.map(id => { const p = players.get(id); return { id, name: p ? p.name : '?', kos: arenaStat.kos[id] || 0, faints: arenaStat.faints[id] || 0 }; }) })),
    tour: tourOut(),
  };
  store.addRace({ mode: 'arena-' + gameMode, level: -1, time: T - raceStart, dist: 0, team: arenaPlayers().map(p => p.name), crashes: 0 }).catch(() => {});
  publishResults(res);
  flushProfiles();
}
function tourOut() { return { rounds: tour.rounds, rows: Object.values(tour.rows).sort((a, b) => b.pts - a.pts || b.wins - a.wins || b.kos - a.kos) }; }
function startArenaCountdown() {
  if (arenaPlayers().length < 1) return;
  seed = (Math.random() * 1e6) | 0;
  buildArena();
  phase = 'count'; countEnd = now() + 3.2; resetBallAt = 0; AW.startT = 0; AW.event = null; nextEvt = 0; zTick = 0;
  arenaStat = { kos: {}, faints: {}, koT: {}, conceded: {}, megaKo: {} };
  for (const h of AW.hippos) h.ult = 0;
  race = { p: {}, crashes: {}, crashTotal: 0, syncs: 0, bestSync: 0, metersAcc: 0 };
  broadcast({ t: 'ev', k: 'count' });
  sendRoom();
}

// ------------------------------------------------------------
//  Фазы
// ------------------------------------------------------------
function startCountdown() {
  currentResults = null;
  if (isArenaMode(gameMode)) { startArenaCountdown(); return; }
  if (!racers().length) return;
  if (levelIdx === ENDLESS) setLevel(ENDLESS, (Math.random() * 1e9) | 0);
  if (levelIdx === DAILY) setLevel(DAILY);
  phase = 'count'; countEnd = now() + 3.2;
  W.raft.cp = -1; W.raft.cpS = 3; W.raft.maxS = 0; W.puddles = []; W.blobs = []; W.pickups = []; W.pkNext = 0;
  resetRaft(W, 3);
  lives = rules.lives; gameOverAt = 0; lastS = 3;
  race = { p: {}, crashes: {}, crashTotal: 0, syncs: 0, bestSync: 0, metersAcc: 0 };
  for (const p of racers()) {
    p.h.ult = 0;
    p.races = (p.races || 0) + 1;
    if (p.races >= 10) grant(p, 'marathon');
    const hr = new Date().getHours(); if (hr >= 0 && hr < 5) grant(p, 'night_owl');
    if (p.seat === CENTER_SEAT) grant(p, 'center_1');
  }
  broadcast({ t: 'ev', k: 'count' });
  sendRoom();
}

function teamOut() { return racers().map(p => ({ id: p.id, name: p.name, skin: p.skin, bot: p.isBot })); }
function top(k) { let best = null, mx = 0; for (const p of racers()) { const v = (race.p[p.id] || {})[k] || 0; if (v > mx) { mx = v; best = p; } } return best ? { name: best.name, n: +mx.toFixed(1) } : null; }

function finishRace(T) {
  const time = T - raceStart;
  phase = 'results';
  const key = `${levelIdx}`, rec = records[key];
  const isRecord = !rec || time < rec.time;
  const team = teamOut();
  if (isRecord) { records[key] = { time, names: team.map(t => t.name), date: new Date().toISOString().slice(0, 10) }; store.saveRecord(key, records[key]).catch(() => {}); }
  const medal = medalFor(levelIdx, time);
  const teamShits = Object.values(race.p).reduce((a, r) => a + (r.shits || 0) + (r.misfires || 0), 0);
  const n = racers().length;
  for (const p of racers()) {
    if (!p.profile) continue;
    const r = race.p[p.id] || {};
    bump(p, 'finishes');
    addCoins(p, EARN.finish + (EARN.medal[medal] || 0), 'финиш');
    addToSet(p, 'finished', levelIdx);
    if (medal === 3) { addToSet(p, 'gold', levelIdx); grant(p, 'gold_any'); }
    if (race.crashTotal === 0) addToSet(p, 'clean', levelIdx);
    if (isRecord) grant(p, 'record');
    if (n === 1) grant(p, 'solo');
    if (n >= 4) grant(p, 'full_raft');
    if (p.seat === CENTER_SEAT) grant(p, 'center_fin');
    if (teamShits === 0) grant(p, 'dry_pants');
    if (race.crashTotal >= 5 && !(r.blame > 0)) grant(p, 'innocent');
    if (p.h.dirt >= 0.8 || W.raft.dirt >= 0.8) grant(p, 'stinky_win');
    const b = p.profile.data.bests; if (!b[key] || time < b[key]) { b[key] = +time.toFixed(2); markDirty(p); }
  }
  store.addRace({ mode: 'level', level: levelIdx, time, dist: W.tr.length, team: team.map(t => t.name), crashes: race.crashTotal }).catch(() => {});
  sendResults({ time, isRecord, record: records[key], medal });
  flushProfiles();
}

function finishEndless(T, aborted = false) {
  const dist = Math.round(W.raft.maxS), time = T - raceStart;
  phase = 'results';
  const daily = levelIdx === DAILY, date = localDate(), key = daily ? `daily:${date}` : 'endless';
  const rec = records[key], isRecord = !rec || dist > (rec.dist || 0);
  const team = teamOut();
  if (isRecord) { records[key] = { dist, time, names: team.map(t => t.name), date }; store.saveRecord(key, records[key]).catch(() => {}); }
  for (const p of racers()) {
    if (isRecord) grant(p, 'record');
    addCoins(p, Math.floor(dist / EARN.perMeters) * EARN.metersCoins, 'дистанция');
    if (!daily) { setMax(p, 'endlessBest', dist); continue; }
    const d = p.profile && p.profile.data; if (!d) continue;
    if (!d.daily || d.daily.date !== date) d.daily = { date, best: 0, counted: false };
    if (dist > d.daily.best) d.daily.best = dist;
    if (dist >= 100 && !d.daily.counted) { d.daily.counted = true; bump(p, 'dailies', 1, true); addCoins(p, EARN.daily, 'испытание дня'); }
    markDirty(p);
  }
  store.addRace({ mode: daily ? 'daily' : 'endless', level: levelIdx, time, dist, team: team.map(t => t.name), crashes: race.crashTotal }).catch(() => {});
  sendResults({ time, dist, isRecord, record: records[key], endless: true, daily, aborted, mut: daily ? dailyMutator(seed).id : null });
  flushProfiles();
}

function sendResults(extra) {
  const r = {
    level: levelIdx, ...extra, crashes: race.crashes, syncs: race.syncs, bestSync: race.bestSync,
    team: racers().map(p => { const s = race.p[p.id] || {}; return { id: p.id, name: p.name, skin: p.skin, blame: s.blame || 0, fart: +(s.fartTime || 0).toFixed(1), shits: (s.shits || 0) + (s.misfires || 0), ejects: s.ejects || 0, overheats: s.overheats || 0, faints: s.faints || 0, gassed: s.gassed || 0 }; }),
    culprit: top('blame'), farter: top('fartTime'), shitter: top('shits'), flyer: top('ejects'), hot: top('overheats'), gasser: top('gassed'), sleeper: top('faints'),
  };
  publishResults(r);
}
function publishResults(r) {
  currentResults = r;
  broadcast({ t: 'results', r });
  sendRoom();
}

function backToLobby() { phase = 'lobby'; assignSeats(); if (isArenaMode(gameMode)) seed = (Math.random() * 1e6) | 0, buildArena(); W.raft.cp = -1; W.raft.cpS = 3; W.puddles = []; resetRaft(W, 3); sendRoom(); }

// ------------------------------------------------------------
//  Сообщения
// ------------------------------------------------------------
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
  return out;
}
function sendRoom() {
  applyPerks();
  const list = [...players.values()].filter(p => p.named).sort((a, b) => a.joinOrder - b.joinOrder).map(p => ({
    id: p.id, name: p.name, skin: p.skin, seat: p.seat, look: p.look, bot: p.isBot,
    pinned: p.profile ? p.profile.data.pinned : [], achCount: p.profile ? p.profile.ach_count : 0, prof: !!p.profile, lvl: p.profile ? levelOf(p.profile.data.xp || 0).lvl : 0,
  }));
  broadcast({
    t: 'room', players: list, host: hostId, level: levelIdx, seed, phase, records, rules,
    mode: gameMode, arena: arenaInfo(), tour: tourOut(), daily: { date: localDate(), seed: dailySeed(localDate()) },
    levels: LEVELS.map(l => ({ name: l.name, desc: l.desc, theme: l.theme })),
  });
}
function broadcast(msg, isState = false) { const s = JSON.stringify(msg); for (const p of players.values()) p.conn.send(s, isState); }

function freeSkin(pref) {
  const used = new Set([...players.values()].filter(p => p.named).map(p => p.skin));
  if (pref >= 0 && pref < SKINS.length && !used.has(pref)) return pref;
  for (let i = 0; i < SKINS.length; i++) if (!used.has(i)) return i;
  return 0;
}
function makePlayer(conn) {
  const id = nextId++;
  return { id, conn, name: 'Бегемот', skin: 0, look: { ...DEFAULT_LOOK }, seat: -1, named: false, joinOrder: id, isBot: false, profile: null, h: newHippo(id), lastEmote: -9 };
}

const BOT_NAMES = ['Бот Булька', 'Бот Газик', 'Бот Пыхтун', 'Бот Шлёп'];
function addBot() {
  const named = [...players.values()].filter(p => p.named);
  if (named.length >= RIM_SEATS) return;       // ботов не больше четырёх: центр — для людей
  const used = new Set(named.map(p => p.name));
  const p = makePlayer({ send() {} });
  Object.assign(p, { isBot: true, named: true, name: BOT_NAMES.find(n => !used.has(n)) || 'Бот', skin: freeSkin(-1), botT: 0 });
  p.look = { ...DEFAULT_LOOK, glasses: Math.random() < 0.35 ? 'round' : 'none' };
  p.h.greedy = Math.random() < 0.2;
  players.set(p.id, p);
  assignSeats(); sendRoom(); broadcast({ t: 'ev', k: 'join', name: p.name });
}
function removeBot() {
  const bots = [...players.values()].filter(p => p.isBot).sort((a, b) => b.joinOrder - a.joinOrder);
  if (!bots.length) return;
  players.delete(bots[0].id); assignSeats(); sendRoom(); broadcast({ t: 'ev', k: 'leave', name: bots[0].name });
}
function botThink(p, T) {
  if (T < p.botT || isCenter(p.seat)) return;
  p.botT = T + 0.08 + Math.random() * 0.06;
  p.h.inCrawl = 0;
  if (phase !== 'race' || W.raft.status !== 0 || p.h.offUntil > T) { p.h.inFart = false; p.h.inAim = null; return; }
  const r = botDecide(W.tr, W.raft, p.h, T);
  p.h.inAim = r.aim; p.h.inFart = r.fart;
}
function emote(p, n, T) {
  if (T - p.lastEmote < 0.7 || !(n >= 0 && n <= 4)) return;
  p.lastEmote = T;
  broadcast({ t: 'ev', k: 'emote', id: p.id, who: p.name, n });
  bump(p, 'emotes');
}

function onOpen(conn) {
  const p = makePlayer(conn);
  players.set(p.id, p); conn.player = p;
  const shirtOverrides = SKINS.flatMap((_, i) => fs.existsSync(path.join(PUBLIC, 'shirts', `${i + 1}.png`)) ? [i + 1] : []);
  conn.send(JSON.stringify({ t: 'welcome', id: p.id, addrs: lanAddresses(), port: PORT, db: store.kind, shirtOverrides }));
  sendRoom();
}

async function onMessage(conn, data) {
  const p = conn.player; if (!p) return;
  let m; try { m = JSON.parse(data); } catch { return; }
  const isHost = p.id === hostId;
  switch (m.t) {
    case 'hello': {
      const res = await login(p, m).catch(e => ({ fail: 'Ошибка базы данных: ' + e.message }));
      if (!players.has(p.id)) return;
      if (res.fail) { conn.send(JSON.stringify({ t: 'authfail', reason: res.fail })); return; }
      p.profile = res.pr; p.name = res.pr.name;
      const d = res.pr.data;
      p.skin = freeSkin(typeof m.skin === 'number' ? m.skin : d.skin);
      const welcome = ensureEco(d); ensureQuests(p);
      if (DEV.all && res.pr.name.startsWith(DEV.all)) for (const it of BOX_ITEMS) d.inv[it.key] = 1;
      p.look = cleanLook(m.look || d.look, d.ach, d.inv);
      d.look = p.look; d.skin = p.skin; markDirty(p);
      if (!p.named) { p.named = true; p.joinOrder = nextId++; }
      if (!hostId || !players.has(hostId) || !players.get(hostId).named || players.get(hostId).isBot) hostId = p.id;
      assignSeats(); sendRoom(); sendMe(p);
      if (phase === 'results' && currentResults) conn.send(JSON.stringify({ t: 'results', r: currentResults }));
      if (welcome) conn.send(JSON.stringify({ t: 'welcomeGift', coins: welcome }));
      broadcast({ t: 'ev', k: 'join', name: p.name });
      break;
    }
    case 'look': {
      if (!p.named) return;
      let changed = 0;
      if (typeof m.skin === 'number' && m.skin !== p.skin) { p.skin = freeSkin(m.skin | 0); changed++; }
      if (m.look) { const nl = cleanLook({ ...p.look, ...m.look }, p.profile ? p.profile.data.ach : {}, p.profile ? p.profile.data.inv : {}); for (const k in nl) if (nl[k] !== p.look[k]) changed++; p.look = nl; }
      if (perksOf(p.look).length >= 4) grant(p, 'perk_full');
      if (changed && isArenaMode(gameMode) && phase === 'lobby') buildArena();
      if (p.profile && changed) { const d = p.profile.data; d.look = p.look; d.skin = p.skin; d.lookChanges = (d.lookChanges || 0) + changed; markDirty(p); if (d.lookChanges >= 5) grant(p, 'fashion'); }
      sendRoom(); break;
    }
    case 'pin': {
      if (!p.profile || !Array.isArray(m.ids)) return;
      p.profile.data.pinned = m.ids.filter(id => p.profile.data.ach[id]).slice(0, 3);
      markDirty(p); if (p.profile.data.pinned.length >= 3) grant(p, 'show_off');
      sendMe(p); sendRoom(); break;
    }
    case 'getprof': {
      const key = String(m.name || '').toLowerCase();
      const live = [...players.values()].find(q => q.profile && q.profile.name_key === key);
      const pr = live ? live.profile : await store.getProfile(key).catch(() => null);
      conn.send(JSON.stringify({ t: 'prof', p: pr ? { name: pr.name, data: { s: pr.data.s, sets: pr.data.sets, ach: pr.data.ach, pinned: pr.data.pinned, bests: pr.data.bests }, achCount: pr.ach_count } : null }));
      break;
    }
    case 'top': {
      const [endless, ach, races] = await Promise.all([store.topEndless(10), store.topAchievers(10), store.raceCount()]).catch(() => [[], [], 0]);
      conn.send(JSON.stringify({ t: 'top', endless, ach, races, records, db: store.kind }));
      break;
    }
    case 'in':
      for (const h of [p.h, p.ah]) {
        if (!h) continue;
        h.inFart = !!m.f;
        h.inAim = (typeof m.a === 'number' && isFinite(m.a)) ? m.a : null;
        h.inCrawl = m.c === 1 ? 1 : m.c === -1 ? -1 : 0;
        h.inShoot = !!m.s;
      }
      break;
    case 'mode': if (isHost && phase === 'lobby') { setMode(m.mode); sendRoom(); } break;
    case 'tourReset':
      if (isHost && phase !== 'race') {
        tour = { rounds: 0, rows: {} };
        if (phase === 'results' && currentResults?.arena) currentResults.tour = tourOut();
        sendRoom();
      }
      break;
    case 'rules': if (isHost && phase === 'lobby') {
      const r = m.rules || {};
      rules = {
        faint: !!r.faint, faintTime: Math.max(1, Math.min(6, +r.faintTime || 3)),
        misfire: MISFIRE_LEVELS.some(x => x.v === +r.misfire) ? +r.misfire : DEFAULT_RULES.misfire,
        burps: r.burps !== false, lives: Math.max(1, Math.min(9, +r.lives || 5)), raft: RAFT_SHAPES[r.raft] ? r.raft : 'round', pickups: r.pickups !== false,
        perks: r.perks !== false, ult: r.ult !== false, events: r.events !== false,
      };
      W.rules = rules; if (AW) AW.rules = rules; sendRoom();
    } break;
    case 'level': if (isHost && phase === 'lobby') { setLevel(m.level); sendRoom(); } break;
    case 'start': if (isHost && phase === 'lobby') { if (typeof m.level === 'number' && m.level !== levelIdx) setLevel(m.level); startCountdown(); } break;
    case 'again': if (isHost && phase === 'results') { phase = 'lobby'; assignSeats(); startCountdown(); } break;
    case 'next': if (isHost && phase === 'results') { phase = 'lobby'; if (!isArenaMode(gameMode)) setLevel(levelIdx >= ENDLESS ? (levelIdx === ENDLESS ? 0 : ENDLESS) : levelIdx + 1); assignSeats(); startCountdown(); } break;
    case 'lobby': if (isHost && phase === 'results') backToLobby(); break;
    case 'abort': if (isHost && (phase === 'race' || phase === 'count')) { if (isArenaMode(gameMode) && phase === 'race') finishArena(now(), -1, true); else if (levelIdx >= ENDLESS && !isArenaMode(gameMode) && phase === 'race') finishEndless(now(), true); else backToLobby(); } break;
    case 'addbot': if (isHost && phase === 'lobby') addBot(); break;
    case 'removebot': if (isHost && phase === 'lobby') removeBot(); break;
    case 'emote': emote(p, m.n | 0, now()); break;
    case 'mega': doMega(p); break;
    case 'shop': shop(p, m); break;
    case 'ping': conn.send(JSON.stringify({ t: 'pong', c: m.c, T: now() })); break;
  }
}

function onClose(conn) {
  const p = conn.player; if (!p) return;
  players.delete(p.id);
  if (p.profile) { markDirty(p); flushProfiles(); }
  if (hostId === p.id) { const nx = humans().sort((a, b) => a.joinOrder - b.joinOrder)[0]; hostId = nx ? nx.id : 0; }
  if (!humans().length) for (const q of [...players.values()]) if (q.isBot) players.delete(q.id);
  assignSeats();
  if (phase !== 'lobby' && (!racers().length || !humans().length)) backToLobby();
  if (p.named) broadcast({ t: 'ev', k: 'leave', name: p.name });
  sendRoom();
}

// ------------------------------------------------------------
//  Игровой цикл: 60 Гц физика, 30 Гц рассылка
// ------------------------------------------------------------
let simT = now(), lastBroadcast = 0, sinceSend = 0;
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
let loopPrev = now(), gapMax = 0, gapShow = 0, gapT = 0;
function loop() {
  const t = now();
  { const gap = t - loopPrev; loopPrev = t; if (gap > gapMax) gapMax = gap; if (t - gapT > 1) { gapShow = gapMax; gapMax = 0; gapT = t; } }
  let steps = 0;
  while (simT + DT <= t && steps < 12) {
    simT += DT; steps++; sinceSend++;
    if (phase === 'count' && simT >= countEnd) { phase = 'race'; raceStart = simT; goT = simT; if (AW) AW.startT = simT; broadcast({ t: 'ev', k: 'go' }); sendRoom(); }
    if (gameOverAt && simT >= gameOverAt && phase === 'race') { gameOverAt = 0; finishEndless(simT); }
    if (rules.ult !== false && (phase === 'race' || phase === 'lobby')) {
      const rate = phase === 'lobby' ? ULT.lobby : isArenaMode(gameMode) ? ULT.arena : ULT.race;
      for (const p of players.values()) { if (p.isBot) continue; const h = isArenaMode(gameMode) ? p.ah : (p.seat >= 0 ? p.h : null); if (h && (h.ult || 0) < 1) chargeUlt(h, rate * DT); }
    }
    if (isArenaMode(gameMode) && AW) {
      const play = phase === 'race' || phase === 'lobby';
      if (resetBallAt && simT >= resetBallAt) { resetBallAt = 0; if (AW.ball) resetBall(AW, simT); }
      if (phase === 'lobby') for (const R of AW.rafts) R.invulnUntil = simT + 0.5;     // в лобби арены плоты не лопаются
      arenaStep(AW, simT, { canFart: play, physics: play, crawl: phase !== 'results', predict: false }, AEV);
      if (phase === 'race') arenaExtras();
      if (phase === 'race' && simT - raceStart >= ARENA_MODES[gameMode].time) {      // время вышло — побеждает лидер (при ничьей — ничья)
        const mx = Math.max(...score), lead = score.filter(v => v === mx).length === 1 ? score.indexOf(mx) : -1;
        finishArena(simT, lead);
      }
      continue;
    }
    for (const p of players.values()) if (p.isBot && p.seat >= 0) botThink(p, simT);
    if (phase === 'lobby') W.raft.invulnUntil = simT + 0.5;     // в лобби плот не лопается — просто тренировка
    simStep(W, simT, { canFart: phase === 'race' || phase === 'lobby', physics: phase === 'race' || phase === 'lobby', crawl: phase !== 'results', predict: false }, EV);
    if (inRace() && W.raft.status === 0) {
      const R = W.raft, sp = Math.hypot(R.vx, R.vz);
      if (sp >= 13) for (const p of racers()) grant(p, 'speed');
      if (Math.abs(R.w) >= 6) for (const p of racers()) grant(p, 'spin');
      const ds = R.s - lastS; lastS = R.s;
      if (ds > 0 && ds < 2) { race.metersAcc += ds; if (race.metersAcc >= 10) { for (const p of racers()) if (p.h.offUntil <= simT) bump(p, 'meters', race.metersAcc); race.metersAcc = 0; } }
    } else lastS = W.raft.s;
  }
  if (steps === 12) simT = t;
  // снимки по шагам физики, а не по таймеру (на Windows таймер грубый): сплав 60 Гц, арена 30 Гц
  const arenaNow = isArenaMode(gameMode) && AW;
  if (arenaNow && sinceSend >= 2) {
    sinceSend = 0; lastBroadcast = t;
    const r1 = (v) => Math.round(v * 10) / 10, fl = (h) => (h.offUntil > simT ? 1 : 0) | (simT < h.overUntil ? 2 : 0) | (simT < h.stunUntil ? 4 : 0) | (h.fartOn && simT - h.fartStart < PHYS.burstTime ? 8 : 0) | (h.fartOn && h.gas < PHYS.sprayGas ? 16 : 0) | (simT < h.faintUntil ? 32 : 0);
    broadcast({
      t: 'a', T: r3(simT), ph: phase, mode: gameMode,
      rt: phase === 'race' ? r3(simT - raceStart) : (phase === 'count' ? r3(-(countEnd - simT)) : 0),
      left: phase === 'race' ? Math.max(0, Math.round(ARENA_MODES[gameMode].time - (simT - raceStart))) : ARENA_MODES[gameMode].time,
      r: AW.rafts.map(R => [R.id, r3(R.x), r3(R.z), r3(R.a), r3(R.w), r2(R.vx), r2(R.vz), R.status, simT < R.invulnUntil ? 1 : 0, r2(R.dirt), (simT < R.boostUntil ? 1 : 0) | (simT < R.shieldUntil ? 2 : 0) | (R.out ? 4 : 0) | (R.inf ? 8 : 0) | (AW.bomb.raft === R.id ? 16 : 0) | (simT < R.magnetUntil ? 32 : 0), R.gate, R.lap]),
      hp: AW.hippos.map(h => [h.id, h.raft, h.seat, r3(h.pos), r2(h.vel), h.fartOn ? 1 : 0, r2(h.gas), r2(h.heat), fl(h), r2(h.dirt), r2(h.ult || 0)]),
      bl: AW.blobs.map(b => [r1(b.x), r1(b.z), r2(b.r), r1(b.vx), r1(b.vz), b.big ? 1 : 0, r2(b.age / b.life), b.team]),
      b: AW.ball ? [r3(AW.ball.x), r3(AW.ball.z), r2(AW.ball.vx), r2(AW.ball.vz)] : null,
      sc: score, kt: AW.kingTeam ?? -1, lg: Math.round(gapShow * 1000), rad: r2(arenaRadius(AW, simT)),
      pk: AW.pickups.map(pk => [pk.id, pk.kind, r2(pk.x), r2(pk.z), 0]),
      bm: AW.bomb.raft >= 0 ? [AW.bomb.raft, r1(AW.bomb.until - simT)] : null,
      evt: AW.event && simT < AW.event.until ? [AW.event.k, r3(AW.event.until), r3(AW.event.ang)] : null,
    }, true);
  }
  if (!arenaNow && sinceSend >= 1) {
    sinceSend = 0; lastBroadcast = t;
    const R = W.raft;
    broadcast({
      t: 's', T: r3(simT), ph: phase,
      rt: phase === 'race' ? r3(simT - raceStart) : (phase === 'count' ? r3(-(countEnd - simT)) : 0),
      x: r3(R.x), z: r3(R.z), a: r3(R.a), w: r3(R.w), vx: r2(R.vx), vz: r2(R.vz), s: r2(R.s),
      st: R.status, inv: simT < R.invulnUntil ? 1 : 0, cp: R.cp, sy: simT < W.sync.until ? 1 : 0, n: W.hippos.length,
      rd: r2(R.dirt), lv: lives, ms: Math.round(R.maxS), lg: Math.round(gapShow * 1000), rf: (simT < R.boostUntil ? 1 : 0) | (simT < R.shieldUntil ? 2 : 0),
      pk: W.pickups.map(pk => [pk.id, pk.kind, r2(pk.x), r2(pk.z), r2(pk.y)]),
      hp: W.hippos.map(h => [h.id, h.seat, r3(h.pos), r2(h.vel), h.fartOn ? 1 : 0, r2(h.gas), r2(h.heat),
        (h.offUntil > simT ? 1 : 0) | (simT < h.overUntil ? 2 : 0) | (simT < h.stunUntil ? 4 : 0) | (h.fartOn && simT - h.fartStart < PHYS.burstTime ? 8 : 0) |
        (h.fartOn && h.gas < PHYS.sprayGas ? 16 : 0) | (simT < h.faintUntil ? 32 : 0), r2(h.dirt), r2(h.ult || 0)]),
    }, true);
  }
}
setInterval(loop, 4);
setLevel(0);

// ------------------------------------------------------------
//  HTTP + WebSocket (без зависимостей), TCP_NODELAY
// ------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function resolveStatic(urlPath) {
  let p; try { p = decodeURIComponent((urlPath || '/').split('?')[0]); } catch { return null; }
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(PUBLIC, p));
  if (!full.startsWith(PUBLIC + path.sep)) return null;
  try { if (!fs.statSync(full).isFile()) return null; } catch { return null; }
  return full;
}
function openBrowser() {
  if (HEADLESS) return;
  const url = `http://localhost:${PORT}`;
  try { if (process.platform === 'win32') exec(`cmd /c start "" "${url}"`); else if (process.platform === 'darwin') exec(`open "${url}"`); } catch {}
}
function banner() {
  const addrs = lanAddresses();
  console.log('\n  ╔══════════════════════════════════════════════╗');
  console.log('  ║        ПУКОПЛОТ — сервер запущен! 🦛💨        ║');
  console.log('  ╚══════════════════════════════════════════════╝\n');
  console.log(`  База данных: ${store.kind}`);
  console.log(`  На этом компьютере:  http://localhost:${PORT}\n`);
  console.log('  Друзья в той же сети (Wi-Fi / LAN / Radmin / Hamachi) открывают:');
  for (const a of addrs) console.log(`      http://${a}:${PORT}`);
  if (!addrs.length) console.log('      (сетевых адресов не найдено — проверьте подключение)');
  console.log('\n  Если Windows спросит про брандмауэр — разрешите доступ.');
  console.log('  Не закрывайте это окно, пока играете. Ctrl+C — выключить.\n');
  openBrowser();
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, players: players.size, phase, db: store.kind, loopLagMs: Math.round(gapShow * 1000), runtime: globalThis.Bun ? 'bun' : 'node' })); return; }
  const f = resolveStatic(req.url);
  if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Не найдено'); return; }
  const ext = path.extname(f);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.woff2' ? 'max-age=86400' : 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.setNoDelay(true); socket.setKeepAlive(true, 5000);
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let closed = false;
  const conn = {
    send(str, isState = false) {
      if (closed) return;
      if (isState && socket.writableLength > 48 * 1024) return;      // не копим очередь у медленного клиента
      const payload = Buffer.from(str, 'utf8'), len = payload.length;
      let header;
      if (len < 126) header = Buffer.from([0x81, len]);
      else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
      try { socket.write(Buffer.concat([header, payload])); } catch {}
    },
  };
  let buf = Buffer.alloc(0), frag = [];
  const close = () => { if (closed) return; closed = true; onClose(conn); try { socket.destroy(); } catch {} };
  onOpen(conn);
  socket.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off; if (masked) off += 4;
      if (buf.length < off + len) return;
      let data = buf.subarray(off, off + len);
      if (masked) { const mk = buf.subarray(maskOff, maskOff + 4); data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= mk[i & 3]; }
      buf = buf.subarray(off + len);
      if (op === 0x8) { close(); return; }
      if (op === 0x9) { try { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch {} continue; }
      if (op === 0xA) continue;
      frag.push(data);
      if (fin) { const all = frag.length === 1 ? frag[0] : Buffer.concat(frag); frag = []; onMessage(conn, all.toString('utf8')).catch(e => console.log(e)); }
    }
  });
  socket.on('close', close); socket.on('error', close);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.log(`\n  Порт ${PORT} занят. Может, сервер уже запущен? Или запустите с другим портом: Pukoplot.exe 4000\n`);
  else console.log(e);
  setTimeout(() => process.exit(1), 8000);
});
const shutdown = async () => { await flushProfiles(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
// Под Bun (в т.ч. Pukoplot.exe) — родной сервер Bun: WebSocket на uWebSockets, без копирования через node:http
function startBun() {
  Bun.serve({
    port: PORT, hostname: '0.0.0.0',
    fetch(req, srv) {
      const u = new URL(req.url);
      if (u.pathname === '/ws') { if (srv.upgrade(req, { data: {} })) return undefined; return new Response('Нужен WebSocket', { status: 400 }); }
      if (u.pathname === '/health') return new Response(JSON.stringify({ ok: true, players: players.size, phase, db: store.kind, loopLagMs: Math.round(gapShow * 1000), runtime: 'bun' }), { headers: { 'Content-Type': 'application/json' } });
      const f = resolveStatic(u.pathname);
      if (!f) return new Response('Не найдено', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      const ext = path.extname(f);
      return new Response(Bun.file(f), { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.woff2' ? 'max-age=86400' : 'no-cache' } });
    },
    websocket: {
      perMessageDeflate: false, idleTimeout: 60, sendPings: true,
      open(ws) {
        const conn = { send(str, isState = false) { if (isState && ws.getBufferedAmount() > 48 * 1024) return; ws.send(str); } };
        ws.data.conn = conn; onOpen(conn);
      },
      message(ws, msg) { onMessage(ws.data.conn, typeof msg === 'string' ? msg : Buffer.from(msg).toString('utf8')).catch(e => console.log(e)); },
      close(ws) { if (ws.data.conn) onClose(ws.data.conn); },
    },
  });
  banner();
}
if (globalThis.Bun && !process.env.NODE_HTTP) {
  try { startBun(); }
  catch (e) {
    if (/in use|EADDRINUSE/i.test(String(e && (e.code || e.message)))) console.log(`\n  Порт ${PORT} занят. Может, сервер уже запущен? Или запустите с другим портом: Pukoplot.exe 4000\n`);
    else console.log(e);
    setTimeout(() => process.exit(1), 8000);
  }
} else server.listen(PORT, '0.0.0.0', banner);
