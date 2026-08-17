const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'vanessas2026';
const PANEL_HASH = crypto.createHash('sha256').update(PANEL_PASSWORD + ':vd').digest('hex');
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const IMG_DIR = path.join(DATA_DIR, 'images');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PER_PAGE = 60;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

let syncing = false;
const loginAttempts = new Map();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveFile(res, file) {
  if (!fs.existsSync(file)) return false;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
  return true;
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
}

function isAuthed(req) {
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim());
  const v = cookie.find(c => c.startsWith('vd_panel='));
  return v ? v.slice('vd_panel='.length) === PANEL_HASH : false;
}

function currentUser(req) {
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim());
  const v = cookie.find(c => c.startsWith('vd_session='));
  if (!v) return null;
  const token = v.slice('vd_session='.length);
  const sessions = readJson(SESSIONS_FILE) || [];
  const s = sessions.find(x => x.token === token);
  if (!s) return null;
  const users = readJson(USERS_FILE) || [];
  return users.find(u => u.id === s.userId) || null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), calc);
}

function makeSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = readJson(SESSIONS_FILE) || [];
  sessions.push({ token, userId, created: new Date().toISOString() });
  writeJson(SESSIONS_FILE, sessions);
  return token;
}

function rateLimited(ip) {
  const a = loginAttempts.get(ip);
  if (!a) return false;
  if (a.count >= 5 && Date.now() < a.lockUntil) return true;
  if (Date.now() >= a.lockUntil) {
    loginAttempts.delete(ip);
    return false;
  }
  return false;
}

function registerFail(ip) {
  const a = loginAttempts.get(ip) || { count: 0, lockUntil: 0 };
  a.count++;
  if (a.count >= 5) a.lockUntil = Date.now() + 15 * 60 * 1000;
  loginAttempts.set(ip, a);
}

function sendLogin(res, next) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(LOGIN_HTML.replace(/__NEXT__/g, next));
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inloggning – Vanessas Däck</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #1e4456; color: #1e4456; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .box { background: #fff; border-radius: 14px; padding: 40px 36px; width: 340px; max-width: 92vw; box-shadow: 0 16px 48px rgba(0,0,0,.35); }
  .box h1 { font-size: 20px; margin-bottom: 6px; }
  .box p { font-size: 13px; color: #5f7a88; margin-bottom: 18px; }
  input { width: 100%; padding: 12px 14px; border: 1px solid #e1e8ee; border-radius: 9px; font-size: 15px; outline: 0; margin-bottom: 12px; }
  input:focus { border-color: #1e4456; }
  button { width: 100%; padding: 12px; border: 0; border-radius: 9px; background: #f6921e; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
  .err { color: #c0392b; font-size: 13px; margin-bottom: 10px; display: none; }
</style>
</head>
<body>
<div class="box">
  <h1>Vanessas Däck</h1>
  <p>Detta område är endast för personal. Ange lösenord.</p>
  <div class="err" id="err">Fel lösenord eller för många försök. Vänta 15 minuter.</div>
  <input type="password" id="pw" placeholder="Lösenord" onkeydown="if(event.key==='Enter')go()">
  <button onclick="go()">Logga in</button>
</div>
<script>
async function go() {
  const pw = document.getElementById('pw').value;
  const r = await fetch('/api/panel-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw, next: '__NEXT__' })
  });
  const d = await r.json();
  if (d.success) {
    location.href = d.next || '/panel';
  } else {
    document.getElementById('err').style.display = 'block';
  }
}
</script>
</body>
</html>`;

function tyreInfo(p) {
  return p.info ||
    (p.width && p.profile && p.inch
      ? `${p.width}-${p.profile}R${p.inch}-${p.load_index || ''}${p.speed_index || ''}`
      : '');
}

function productView(p) {
  return {
    id: p.id,
    type: p.type || 'dack',
    season: p.season || '',
    manufacturer: p.manufacturer_name,
    name: p.name,
    info: tyreInfo(p),
    price: p.price_vat,
    stock: p.stock,
    supplier_stock: p.supplier_stock,
    external_stock: p.supplier_stock_external,
    external_delivery: p.supplier_stock_external_delivery_time,
    supplier_reference: p.supplier_reference,
    inch: p.inch,
    width: p.width,
    profile: p.profile,
    load_index: p.load_index,
    speed_index: p.speed_index,
    bolt_count: p.bolt_count,
    bolt_circle: p.bolt_circle,
    et: p.et,
    cb: p.cb,
    image: p.image ? p.image.split(',').filter(Boolean).map(f => `/images/${encodeURIComponent(f)}`) : []
  };
}

function startSync(cb) {
  if (syncing) {
    cb(null, { running: true });
    return;
  }
  syncing = true;
  const child = spawn(process.execPath, [path.join(__dirname, 'sync.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => (out += d));
  child.stderr.on('data', d => (out += d));
  child.on('exit', code => {
    syncing = false;
    cb(code === 0 ? null : new Error('Sync misslyckades'), { code, output: out });
  });
}

function filterProducts(products, params) {
  const q = (params.q || '').toLowerCase().trim();
  const type = params.type || '';
  const marke = (params.marke || '').toLowerCase();
  const inch = params.inch || '';
  const season = params.season || '';
  const width = params.width || '';
  const ratio = params.ratio || '';
  const boltCircle = params.bolt_circle || '';
  const et = params.et || '';
  const stock = params.stock === '1';
  const hasImage = params.has_image === '1';

  let list = products;
  if (q) {
    list = list.filter(p =>
      (p.manufacturer_name || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.info || '').toLowerCase().includes(q) ||
      String(p.id).includes(q) ||
      String(p.supplier_reference || '').includes(q)
    );
  }
  if (type === 'falgar') list = list.filter(p => p.type === 'falgar');
  if (type === 'dack') list = list.filter(p => p.type === 'dack');
  if (marke) list = list.filter(p => (p.manufacturer_name || '').toLowerCase() === marke);
  if (inch) list = list.filter(p => String(p.inch) === inch);
  if (season) list = list.filter(p => (p.season || '').split(',').includes(season));
  if (width && type === 'dack') list = list.filter(p => String(p.width) === width);
  if (ratio && type === 'dack') list = list.filter(p => String(p.profile) === ratio);
  if (boltCircle) list = list.filter(p => String(p.bolt_circle) === boltCircle);
  if (et) list = list.filter(p => String(p.et) === et);
  if (stock) list = list.filter(p => p.stock > 0 || p.supplier_stock_external > 0);
  if (hasImage) list = list.filter(p => p.image && p.image.split(',').filter(Boolean).length > 0);
  return list;
}

function sortProducts(list, sort) {
  switch (sort) {
    case 'price_asc':
      return [...list].sort((a, b) => (a.price_vat || 0) - (b.price_vat || 0));
    case 'price_desc':
      return [...list].sort((a, b) => (b.price_vat || 0) - (a.price_vat || 0));
    case 'name':
      return [...list].sort((a, b) =>
        (a.manufacturer_name || '').localeCompare(b.manufacturer_name || '') ||
        (a.name || '').localeCompare(b.name || '')
      );
    default:
      return list;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);

  if (url.pathname === '/panel' || url.pathname === '/gallery') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (!isAuthed(req)) {
      sendLogin(res, url.pathname);
      return;
    }
    if (serveFile(res, path.join(PUBLIC_DIR, url.pathname === '/panel' ? 'panel.html' : 'gallery.html'))) return;
  }

  const pages = {
    '/': 'index.html',
    '/dack': 'listning.html',
    '/falgar': 'listning.html',
    '/produkt': 'produkt.html',
    '/sok': 'listning.html',
    '/varukorg': 'varukorg.html',
    '/kassan': 'kassan.html',
    '/mina-sidor': 'minasidor.html',
    '/logga-in': 'login.html',
    '/skapa-konto': 'register.html',
    '/bra-att-veta': 'bra-att-veta.html',
    '/vinterdack-val': 'vinterdack-val.html',
    '/villkor': 'villkor.html',
    '/kontakta-oss': 'kontakta-oss.html'
  };

  if (pages[url.pathname] && req.method === 'GET') {
    if (serveFile(res, path.join(PUBLIC_DIR, pages[url.pathname]))) return;
  }

  if (url.pathname === '/robots.txt' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('User-agent: *\nDisallow: /panel\nDisallow: /gallery\nDisallow: /api\nDisallow: /logga-in\nDisallow: /skapa-konto\nDisallow: /mina-sidor\nSitemap: http://localhost:' + PORT + '/sitemap.xml\n');
    return;
  }

  if (url.pathname === '/sitemap.xml' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE) || [];
    const staticUrls = ['', '/dack', '/falgar', '/varukorg', '/villkor', '/bra-att-veta', '/vinterdack-val', '/kontakta-oss'];
    const urls = staticUrls.map(u => `<url><loc>http://localhost:${PORT}${u}</loc></url>`);
    for (const p of products) {
      urls.push(`<url><loc>http://localhost:${PORT}/produkt?id=${p.id}</loc></url>`);
    }
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
    return;
  }

  if (url.pathname === '/favicon.ico' && req.method === 'GET') {
    if (serveFile(res, path.join(PUBLIC_DIR, 'logo.svg'))) return;
  }

  if (url.pathname.startsWith('/public/') && req.method === 'GET') {
    const rel = path.basename(url.pathname.slice('/public/'.length));
    if (serveFile(res, path.join(PUBLIC_DIR, rel))) return;
  }

  if (url.pathname.startsWith('/images/') && req.method === 'GET') {
    const raw = decodeURIComponent(url.pathname.slice('/images/'.length));
    const file = path.basename(raw);
    const acceptsWebp = /image\/webp|image\/\*/i.test(req.headers.accept || '');
    const webpFile = acceptsWebp
      ? path.join(IMG_DIR, 'webp', path.basename(file, path.extname(file)) + '.webp')
      : null;
    if (webpFile && fs.existsSync(webpFile)) {
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      fs.createReadStream(webpFile).pipe(res);
      return;
    }
    if (serveFile(res, path.join(IMG_DIR, file))) return;
    sendJson(res, 404, { error: 'Bild saknas' });
    return;
  }

  if (url.pathname === '/api/products' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE);
    if (!products) {
      sendJson(res, 503, { error: 'Ingen data ännu – kör "npm run sync"' });
      return;
    }
    let list = filterProducts(products, Object.fromEntries(url.searchParams));
    list = sortProducts(list, url.searchParams.get('sort') || '');
    const total = list.length;
    const start = (page - 1) * PER_PAGE;
    sendJson(res, 200, {
      total,
      page,
      perPage: PER_PAGE,
      pages: Math.max(1, Math.ceil(total / PER_PAGE)),
      lastSync: readJson(META_FILE)?.lastSync || null,
      products: list.slice(start, start + PER_PAGE).map(productView)
    });
    return;
  }

  if (url.pathname === '/api/product-local' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE);
    const id = parseInt(url.searchParams.get('id'), 10);
    const p = products && products.find(x => x.id === id);
    if (!p) {
      sendJson(res, 404, { error: 'Produkten hittades inte' });
      return;
    }
    sendJson(res, 200, { product: productView(p) });
    return;
  }

  if (url.pathname === '/api/filter-values' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE);
    if (!products) {
      sendJson(res, 503, { error: 'Ingen data ännu' });
      return;
    }
    const type = url.searchParams.get('type') || '';
    let list = products;
    if (type === 'falgar') list = list.filter(p => p.type === 'falgar');
    if (type === 'dack') list = list.filter(p => p.type === 'dack');

    const mfg = new Map();
    const inches = new Map();
    const widths = new Map();
    const ratios = new Map();
    const seasons = new Map();
    const boltCircles = new Map();
    const ets = new Map();

    for (const p of list) {
      const m = p.manufacturer_name;
      if (m) mfg.set(m, (mfg.get(m) || 0) + 1);
      if (p.inch) inches.set(String(p.inch), (inches.get(String(p.inch)) || 0) + 1);
      if (p.season) {
        for (const s of p.season.split(',')) {
          seasons.set(s, (seasons.get(s) || 0) + 1);
        }
      }
      if (p.width) widths.set(String(p.width), (widths.get(String(p.width)) || 0) + 1);
      if (p.profile) ratios.set(String(p.profile), (ratios.get(String(p.profile)) || 0) + 1);
      if (p.bolt_circle) boltCircles.set(String(p.bolt_circle), (boltCircles.get(String(p.bolt_circle)) || 0) + 1);
      if (p.et !== undefined && p.et !== null) ets.set(String(p.et), (ets.get(String(p.et)) || 0) + 1);
    }

    const seasonNames = { sommar: 'Sommar', dubb: 'Dubb', 'nordisk-friktion': 'Nordisk friktion', 'eu-friktion': 'EU-friktion' };
    const byName = (a, b) => a.value.localeCompare(b.value, 'sv');
    sendJson(res, 200, {
      manufacturers: [...mfg.entries()].map(([value, count]) => ({ value, count })).sort(byName),
      inches: [...inches.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => Number(a.value) - Number(b.value)),
      widths: [...widths.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => Number(a.value) - Number(b.value)),
      ratios: [...ratios.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => Number(a.value) - Number(b.value)),
      seasons: [...seasons.entries()].map(([value, count]) => ({ value, label: seasonNames[value] || value, count })).sort(byName),
      boltCircles: [...boltCircles.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => Number(a.value) - Number(b.value)),
      ets: [...ets.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => Number(a.value) - Number(b.value))
    });
    return;
  }

  if (url.pathname === '/api/gallery' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE);
    if (!products) {
      sendJson(res, 503, { error: 'Ingen data ännu – kör "npm run sync"' });
      return;
    }
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    const type = url.searchParams.get('type') || '';
    const inStock = url.searchParams.get('stock') === '1';

    let list = products.filter(p => p.image && p.image.split(',').filter(Boolean).length > 0);
    if (q) {
      list = list.filter(p =>
        (p.manufacturer_name || '').toLowerCase().includes(q) ||
        (p.name || '').toLowerCase().includes(q) ||
        (p.info || '').toLowerCase().includes(q) ||
        String(p.id).includes(q)
      );
    }
    if (type === 'falgar') list = list.filter(p => p.type === 'falgar');
    if (type === 'dack') list = list.filter(p => p.type === 'dack');
    if (inStock) list = list.filter(p => p.stock > 0 || p.supplier_stock_external > 0);

    const entries = [];
    const seen = new Set();
    for (const p of list) {
      for (const f of p.image.split(',').filter(Boolean)) {
        if (seen.has(f)) continue;
        seen.add(f);
        entries.push({
          image: `/images/${encodeURIComponent(f)}`,
          images: p.image.split(',').filter(Boolean).map(x => `/images/${encodeURIComponent(x)}`),
          manufacturer: p.manufacturer_name,
          name: p.name,
          info: p.info,
          price: p.price_vat,
          stock: p.stock,
          external_stock: p.supplier_stock_external
        });
      }
    }

    sendJson(res, 200, { total: entries.length, images: entries });
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const meta = readJson(META_FILE);
    sendJson(res, 200, {
      lastSync: meta?.lastSync || null,
      productCount: meta?.productCount || 0,
      syncing
    });
    return;
  }

  if (url.pathname === '/api/sync' && req.method === 'POST') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    startSync((err, result) => {
      if (err) {
        sendJson(res, 500, { error: err.message });
        return;
      }
      sendJson(res, 200, result);
    });
    return;
  }

  if (url.pathname === '/api/panel-login' && req.method === 'POST') {
    const ip = getIp(req);
    if (rateLimited(ip)) {
      sendJson(res, 429, { success: false, error: 'För många försök, vänta 15 minuter' });
      return;
    }
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (d.password === PANEL_PASSWORD) {
          loginAttempts.delete(ip);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': `vd_panel=${PANEL_HASH}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          res.end(JSON.stringify({ success: true, next: d.next || '/panel' }));
        } else {
          registerFail(ip);
          sendJson(res, 401, { success: false, error: 'Fel lösenord' });
        }
      } catch {
        sendJson(res, 400, { error: 'Ogiltig data' });
      }
    });
    return;
  }

  if (url.pathname === '/api/register' && req.method === 'POST') {
    const ip = getIp(req);
    if (rateLimited(ip)) {
      sendJson(res, 429, { error: 'För många försök, vänta 15 minuter' });
      return;
    }
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (!d.name || !d.email || !d.password) {
          sendJson(res, 422, { error: 'Namn, e-post och lösenord krävs' });
          return;
        }
        if (d.password.length < 6) {
          sendJson(res, 422, { error: 'Lösenordet måste vara minst 6 tecken' });
          return;
        }
        const users = readJson(USERS_FILE) || [];
        if (users.some(u => u.email.toLowerCase() === d.email.toLowerCase())) {
          sendJson(res, 409, { error: 'E-postadressen finns redan' });
          return;
        }
        const user = {
          id: users.length ? Math.max(...users.map(u => u.id)) + 1 : 1,
          name: d.name.trim(),
          email: d.email.trim().toLowerCase(),
          password: hashPassword(d.password),
          created: new Date().toISOString()
        };
        users.push(user);
        writeJson(USERS_FILE, users);
        const token = makeSession(user.id);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `vd_session=${token}; Path=/; Max-Age=2592000; SameSite=Lax`
        });
        res.end(JSON.stringify({ success: true, user: { id: user.id, name: user.name, email: user.email } }));
      } catch {
        sendJson(res, 400, { error: 'Ogiltig data' });
      }
    });
    return;
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const ip = getIp(req);
    if (rateLimited(ip)) {
      sendJson(res, 429, { error: 'För många försök, vänta 15 minuter' });
      return;
    }
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const users = readJson(USERS_FILE) || [];
        const user = users.find(u => u.email.toLowerCase() === (d.email || '').toLowerCase().trim());
        if (!user || !verifyPassword(d.password || '', user.password)) {
          registerFail(ip);
          sendJson(res, 401, { error: 'Fel e-post eller lösenord' });
          return;
        }
        loginAttempts.delete(ip);
        const token = makeSession(user.id);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `vd_session=${token}; Path=/; Max-Age=2592000; SameSite=Lax`
        });
        res.end(JSON.stringify({ success: true, user: { id: user.id, name: user.name, email: user.email } }));
      } catch {
        sendJson(res, 400, { error: 'Ogiltig data' });
      }
    });
    return;
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const cookie = (req.headers.cookie || '').split(';').map(c => c.trim());
    const v = cookie.find(c => c.startsWith('vd_session='));
    if (v) {
      const token = v.slice('vd_session='.length);
      writeJson(SESSIONS_FILE, (readJson(SESSIONS_FILE) || []).filter(s => s.token !== token));
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'vd_session=; Path=/; Max-Age=0'
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (url.pathname === '/api/me' && req.method === 'GET') {
    const user = currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
    return;
  }

  if (url.pathname === '/api/my-orders' && req.method === 'GET') {
    const user = currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const orders = (readJson(ORDERS_FILE) || []).filter(o => o.userId === user.id).reverse();
    sendJson(res, 200, { orders });
    return;
  }

  if (url.pathname === '/api/orders' && req.method === 'GET') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const orders = (readJson(ORDERS_FILE) || []).reverse();
    const status = url.searchParams.get('status');
    const filtered = status ? orders.filter(o => o.status === status) : orders;
    sendJson(res, 200, { orders: filtered });
    return;
  }

  if (url.pathname === '/api/orders' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const order = JSON.parse(body);
        const hasName = !!(order.customer && (order.customer.name || (order.customer.firstname && order.customer.lastname)));
        if (!order.customer || !hasName || !order.customer.email) {
          sendJson(res, 422, { error: 'Namn och e-post krävs' });
          return;
        }
        if (!Array.isArray(order.items) || order.items.length === 0) {
          sendJson(res, 422, { error: 'Kundvagnen är tom' });
          return;
        }
        const orders = readJson(ORDERS_FILE) || [];
        const now = new Date();
        const id = 'VD-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(orders.length + 1).padStart(4, '0');
        const user = currentUser(req);
        const saved = {
          id,
          created: now.toISOString(),
          status: 'ny',
          userId: user ? user.id : null,
          ...order
        };
        orders.push(saved);
        writeJson(ORDERS_FILE, orders);
        sendJson(res, 200, { success: true, order: saved });
      } catch (e) {
        sendJson(res, 400, { error: 'Ogiltig orderdata' });
      }
    });
    return;
  }

  if (url.pathname.startsWith('/api/orders/') && req.method === 'PATCH') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const orderId = url.pathname.slice('/api/orders/'.length);
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const orders = readJson(ORDERS_FILE) || [];
        const order = orders.find(o => o.id === orderId);
        if (!order) {
          sendJson(res, 404, { error: 'Ordern hittades inte' });
          return;
        }
        if (d.status) order.status = d.status;
        writeJson(ORDERS_FILE, orders);
        sendJson(res, 200, { success: true, order });
      } catch {
        sendJson(res, 400, { error: 'Ogiltig data' });
      }
    });
    return;
  }

  const notFound = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(notFound)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(notFound).pipe(res);
    return;
  }
  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Vanessas Däck-sajt på http://localhost:${PORT}`);
});
