const { openDb } = require('./db');
const path = require('path');

const db = openDb(path.join(__dirname, 'data', 'vanessas.db'));
const email = (process.argv[2] || '').toLowerCase().trim();

if (!email) {
  console.log('Användning: node make-admin.js <epost>');
  process.exit(1);
}

const user = db.users.byEmail(email);
if (!user) {
  console.log('Ingen användare med epost ' + email);
  process.exit(1);
}

db.users.setRole(user.id, 'admin');
console.log(user.name + ' (' + user.email + ') är nu admin.');
db.close();