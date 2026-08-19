const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_FILE = path.join(__dirname, '.env');

function loadEnv() {
  try {
    const txt = fs.readFileSync(ENV_FILE, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

function getPanelPassword() {
  loadEnv();
  if (process.env.PANEL_PASSWORD) return process.env.PANEL_PASSWORD;
  const pw = crypto.randomBytes(12).toString('base64url');
  let txt = '';
  try { txt = fs.readFileSync(ENV_FILE, 'utf8'); } catch {}
  txt = txt.replace(/^PANEL_PASSWORD=.*$/gm, 'PANEL_PASSWORD=' + pw);
  if (!txt.includes('PANEL_PASSWORD=')) txt += (txt.endsWith('\n') || txt === '' ? '' : '\n') + 'PANEL_PASSWORD=' + pw + '\n';
  fs.writeFileSync(ENV_FILE, txt);
  console.log('Genererat nytt panel-lösenord: ' + pw + ' (sparat i .env)');
  return pw;
}

module.exports = { loadEnv, getPanelPassword };