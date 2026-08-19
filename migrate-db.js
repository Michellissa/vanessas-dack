const fs = require('fs');
const path = require('path');
const { openDb } = require('./db');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'vanessas.db');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const db = openDb(DB_FILE);

const existing = db.users.all().length + db.orders.count() + db.cars.all().length;
if (existing > 0 && !process.argv.includes('--force')) {
  console.log('Databasen innehåller redan data (' + existing + ' rader). Använd --force för att återskapa från JSON.');
  db.close();
  process.exit(0);
}

if (process.argv.includes('--force')) {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_FILE + suffix); } catch {}
  }
  console.log('Gamla databasen borttagen, återskapar...');
  migrate(openDb(DB_FILE));
}

function migrate(d) {
  const users = readJson(path.join(DATA_DIR, 'users.json')) || [];
  for (const u of users) {
    d.users.insert({ name: u.name, email: u.email, password: u.password, created: u.created || new Date().toISOString() });
  }
  console.log('users: ' + users.length);

  const sessions = readJson(path.join(DATA_DIR, 'sessions.json')) || [];
  for (const s of sessions) {
    d.sessions.insert(s.token, s.userId, s.created || new Date().toISOString());
  }
  console.log('sessions: ' + sessions.length);

  const orders = readJson(path.join(DATA_DIR, 'orders.json')) || [];
  for (const o of orders) {
    d.orders.insert({ id: o.id, userId: o.userId, created: o.created, ...o });
  }
  console.log('orders: ' + orders.length);

  const cars = readJson(path.join(DATA_DIR, 'cars.json')) || [];
  for (const c of cars) {
    d.cars.insert({ brand: c.brand, model: c.model, years: c.years || '' });
  }
  console.log('cars: ' + cars.length);

  const rabatter = readJson(path.join(DATA_DIR, 'rabatter.json')) || [];
  for (const r of rabatter) {
    d.rabatter.set(r.userId, r.perBrand || {});
  }
  console.log('rabatter: ' + rabatter.length);

  const settings = readJson(path.join(DATA_DIR, 'settings.json')) || {};
  for (const [k, v] of Object.entries(settings)) {
    d.settings.set(k, String(v));
  }
  console.log('settings: ' + Object.keys(settings).length);

  d.close();
  console.log('Klar! Databasen finns på ' + DB_FILE);
}

if (!process.argv.includes('--force')) migrate(db);