const Database = require('better-sqlite3');
const path = require('path');

function openDb(dbFile) {
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId INTEGER NOT NULL,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      userId INTEGER,
      created TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      years TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS rabatter (
      userId INTEGER PRIMARY KEY,
      perBrand TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return {
    users: {
      all: () => db.prepare('SELECT * FROM users ORDER BY id').all(),
      byId: id => db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null,
      byEmail: email => db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim()) || null,
      insert: u => {
        const info = db.prepare('INSERT INTO users (name, email, password, created) VALUES (?, ?, ?, ?)')
          .run(u.name, u.email, u.password, u.created);
        return { id: info.lastInsertRowid, ...u };
      }
    },
    sessions: {
      insert: (token, userId, created) => db.prepare('INSERT INTO sessions (token, userId, created) VALUES (?, ?, ?)').run(token, userId, created),
      remove: token => db.prepare('DELETE FROM sessions WHERE token = ?').run(token),
      byToken: token => db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) || null,
      cleanup: beforeIso => db.prepare('DELETE FROM sessions WHERE created < ?').run(beforeIso)
    },
    orders: {
      all: () => db.prepare('SELECT id, userId, created, data FROM orders ORDER BY created DESC').all().map(r => JSON.parse(r.data)),
      byId: id => {
        const r = db.prepare('SELECT data FROM orders WHERE id = ?').get(id);
        return r ? JSON.parse(r.data) : null;
      },
      count: () => db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,
      countByUser: userId => db.prepare('SELECT COUNT(*) AS c FROM orders WHERE userId = ?').get(userId).c,
      insert: o => db.prepare('INSERT INTO orders (id, userId, created, data) VALUES (?, ?, ?, ?)').run(o.id, o.userId, o.created, JSON.stringify(o)),
      update: o => db.prepare('UPDATE orders SET data = ? WHERE id = ?').run(JSON.stringify(o), o.id)
    },
    cars: {
      all: () => db.prepare('SELECT * FROM cars ORDER BY id').all(),
      insert: c => {
        const info = db.prepare('INSERT INTO cars (brand, model, years) VALUES (?, ?, ?)').run(c.brand, c.model, c.years);
        return { id: Number(info.lastInsertRowid), ...c };
      },
      remove: id => db.prepare('DELETE FROM cars WHERE id = ?').run(id)
    },
    rabatter: {
      get: userId => {
        const r = db.prepare('SELECT perBrand FROM rabatter WHERE userId = ?').get(userId);
        return r ? JSON.parse(r.perBrand) : {};
      },
      set: (userId, perBrand) => db.prepare('INSERT INTO rabatter (userId, perBrand) VALUES (?, ?) ON CONFLICT(userId) DO UPDATE SET perBrand = excluded.perBrand').run(userId, JSON.stringify(perBrand)),
      all: () => db.prepare('SELECT userId, perBrand FROM rabatter').all().map(r => ({ userId: r.userId, perBrand: JSON.parse(r.perBrand) }))
    },
    settings: {
      get: key => {
        const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return r ? r.value : null;
      },
      all: () => {
        const rows = db.prepare('SELECT key, value FROM settings').all();
        return rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
      },
      set: (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
    },
    close: () => db.close()
  };
}

module.exports = { openDb };