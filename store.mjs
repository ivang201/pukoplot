// ============================================================
//  Хранилище профилей, рекордов и заездов
//   • DATABASE_URL=postgres://…  → PostgreSQL (Docker)
//   • запуск через Pukoplot.exe / bun → SQLite-файл pukoplot.db
//   • запуск через node → JSON-файл (запасной вариант)
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

const nowIso = () => new Date().toISOString();
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export async function openStore(baseDir) {
  const dataDir = process.env.DATA_DIR || baseDir;
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  const url = process.env.DATABASE_URL || '';
  if (/^postgres/.test(url) && typeof Bun !== 'undefined') return openPg(url);
  if (typeof Bun !== 'undefined') return openSqlite(path.join(dataDir, 'pukoplot.db'));
  return openJson(path.join(dataDir, 'pukoplot-db.json'));
}

// ---------------- PostgreSQL (Bun.SQL)
async function openPg(url) {
  const sql = new Bun.SQL(url);
  for (let i = 0; ; i++) {          // база в Docker может подниматься дольше сервера
    try { await sql`SELECT 1`; break; } catch (e) { if (i > 40) throw e; console.log('  Жду базу данных…'); await new Promise(r => setTimeout(r, 1500)); }
  }
  await sql`CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pin_hash TEXT, salt TEXT, data JSONB NOT NULL DEFAULT '{}', ach_count INTEGER NOT NULL DEFAULT 0, endless_best REAL NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, time REAL, dist REAL, names TEXT, date TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS races (id SERIAL PRIMARY KEY, mode TEXT, level INTEGER, time REAL, dist REAL, team JSONB, crashes INTEGER, created_at TIMESTAMPTZ DEFAULT now())`;
  const row = (r) => r && { ...r, data: parse(r.data) || {} };
  return {
    kind: 'PostgreSQL',
    async getProfile(key) { const [r] = await sql`SELECT * FROM profiles WHERE name_key = ${key}`; return row(r) || null; },
    async createProfile(p) { await sql`INSERT INTO profiles (id, name_key, name, pin_hash, salt, data) VALUES (${p.id}, ${p.name_key}, ${p.name}, ${p.pin_hash}, ${p.salt}, ${JSON.stringify(p.data)}::jsonb)`; },
    async saveProfile(p) { await sql`UPDATE profiles SET data = ${JSON.stringify(p.data)}::jsonb, name = ${p.name}, ach_count = ${p.ach_count}, endless_best = ${p.endless_best}, updated_at = now() WHERE id = ${p.id}`; },
    async getRecords() { const rows = await sql`SELECT * FROM records`; return Object.fromEntries(rows.map(r => [r.key, { time: r.time, dist: r.dist, names: parse(r.names), date: r.date }])); },
    async saveRecord(key, r) { await sql`INSERT INTO records (key, time, dist, names, date) VALUES (${key}, ${r.time ?? null}, ${r.dist ?? null}, ${JSON.stringify(r.names)}, ${r.date}) ON CONFLICT (key) DO UPDATE SET time = EXCLUDED.time, dist = EXCLUDED.dist, names = EXCLUDED.names, date = EXCLUDED.date`; },
    async addRace(r) { await sql`INSERT INTO races (mode, level, time, dist, team, crashes) VALUES (${r.mode}, ${r.level}, ${r.time}, ${r.dist}, ${JSON.stringify(r.team)}::jsonb, ${r.crashes})`; },
    async topEndless(n = 10) { return (await sql`SELECT name, endless_best AS v FROM profiles WHERE endless_best > 0 ORDER BY endless_best DESC LIMIT ${n}`).map(r => ({ name: r.name, v: r.v })); },
    async topAchievers(n = 10) { return (await sql`SELECT name, ach_count AS v FROM profiles WHERE ach_count > 0 ORDER BY ach_count DESC LIMIT ${n}`).map(r => ({ name: r.name, v: r.v })); },
    async raceCount() { const [r] = await sql`SELECT count(*)::int AS c FROM races`; return r.c; },
  };
}

// ---------------- SQLite (bun:sqlite — встроен в Pukoplot.exe)
async function openSqlite(file) {
  const { Database } = await import('bun:sqlite');
  const db = new Database(file, { create: true });
  db.exec('PRAGMA journal_mode = WAL;'); db.exec('PRAGMA synchronous = NORMAL;');   // без fsync на каждую запись: не тормозит игру
  db.exec(`CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pin_hash TEXT, salt TEXT, data TEXT NOT NULL DEFAULT '{}', ach_count INTEGER NOT NULL DEFAULT 0, endless_best REAL NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, time REAL, dist REAL, names TEXT, date TEXT);
    CREATE TABLE IF NOT EXISTS races (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT, level INTEGER, time REAL, dist REAL, team TEXT, crashes INTEGER, created_at TEXT);`);
  const q = (s) => db.query(s);
  const row = (r) => r && { ...r, data: parse(r.data) || {} };
  return {
    kind: 'SQLite (' + path.basename(file) + ')',
    async getProfile(key) { return row(q('SELECT * FROM profiles WHERE name_key = ?').get(key)) || null; },
    async createProfile(p) { q('INSERT INTO profiles (id, name_key, name, pin_hash, salt, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(p.id, p.name_key, p.name, p.pin_hash, p.salt, JSON.stringify(p.data), nowIso(), nowIso()); },
    async saveProfile(p) { q('UPDATE profiles SET data = ?, name = ?, ach_count = ?, endless_best = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(p.data), p.name, p.ach_count, p.endless_best, nowIso(), p.id); },
    async getRecords() { return Object.fromEntries(q('SELECT * FROM records').all().map(r => [r.key, { time: r.time, dist: r.dist, names: parse(r.names), date: r.date }])); },
    async saveRecord(key, r) { q('INSERT INTO records (key, time, dist, names, date) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET time = excluded.time, dist = excluded.dist, names = excluded.names, date = excluded.date').run(key, r.time ?? null, r.dist ?? null, JSON.stringify(r.names), r.date); },
    async addRace(r) { q('INSERT INTO races (mode, level, time, dist, team, crashes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(r.mode, r.level, r.time, r.dist, JSON.stringify(r.team), r.crashes, nowIso()); },
    async topEndless(n = 10) { return q('SELECT name, endless_best AS v FROM profiles WHERE endless_best > 0 ORDER BY endless_best DESC LIMIT ?').all(n); },
    async topAchievers(n = 10) { return q('SELECT name, ach_count AS v FROM profiles WHERE ach_count > 0 ORDER BY ach_count DESC LIMIT ?').all(n); },
    async raceCount() { return q('SELECT count(*) AS c FROM races').get().c; },
  };
}

// ---------------- JSON-файл (если запущено через node)
function openJson(file) {
  let db = { profiles: {}, records: {}, races: [] };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  let timer = null;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => { try { fs.writeFileSync(file, JSON.stringify(db)); } catch {} }, 500); };
  const byKey = (k) => Object.values(db.profiles).find(p => p.name_key === k);
  const top = (field, n) => Object.values(db.profiles).filter(p => p[field] > 0).sort((a, b) => b[field] - a[field]).slice(0, n).map(p => ({ name: p.name, v: p[field] }));
  return {
    kind: 'JSON (' + path.basename(file) + ')',
    async getProfile(key) { const p = byKey(key); return p ? JSON.parse(JSON.stringify(p)) : null; },
    async createProfile(p) { db.profiles[p.id] = { ...p, ach_count: 0, endless_best: 0, created_at: nowIso() }; save(); },
    async saveProfile(p) { const cur = db.profiles[p.id]; if (cur) Object.assign(cur, { data: p.data, name: p.name, ach_count: p.ach_count, endless_best: p.endless_best, updated_at: nowIso() }); save(); },
    async getRecords() { return db.records; },
    async saveRecord(key, r) { db.records[key] = r; save(); },
    async addRace(r) { db.races.push({ ...r, created_at: nowIso() }); if (db.races.length > 2000) db.races.shift(); save(); },
    async topEndless(n = 10) { return top('endless_best', n); },
    async topAchievers(n = 10) { return top('ach_count', n); },
    async raceCount() { return db.races.length; },
  };
}
