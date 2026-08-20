const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const { openDb } = require('./db');
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const IMG_DIR = path.join(DATA_DIR, 'images');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PER_PAGE = 60;
const db = openDb(path.join(DATA_DIR, 'vanessas.db'));

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

const DEFAULT_BRANDS = [
  ['1', 'Alfa Romeo'], ['52', 'Audi'], ['180', 'Bentley'], ['186', 'BMW'], ['336', 'Cadillac'], ['382', 'Chevrolet'],
  ['543', 'Chrysler'], ['587', 'Citroen'], ['658', 'Dacia'], ['674', 'Daewoo'], ['696', 'Daihatsu'], ['714', 'Dodge'],
  ['776', 'Ferrari'], ['796', 'Fiat'], ['870', 'Fisker'], ['873', 'Ford'], ['1059', 'GMC'], ['1081', 'Honda'],
  ['1145', 'Hummer'], ['1150', 'Hyundai'], ['1219', 'Infiniti'], ['1236', 'Isuzu'], ['1245', 'Iveco'], ['1253', 'Jaguar'],
  ['1277', 'Jeep'], ['1311', 'Kia'], ['1370', 'Lada'], ['1373', 'Lamborghini'], ['1380', 'Lancia'], ['1393', 'Land Rover'],
  ['1415', 'Lexus'], ['1446', 'Lincoln'], ['1468', 'Lotus'], ['1473', 'Maserati'], ['1481', 'Mazda'], ['1556', 'McLaren'],
  ['1559', 'Mercedes'], ['1708', 'Mercury'], ['1728', 'MG'], ['1737', 'Mini'], ['1754', 'Mitsubishi'], ['1828', 'Nissan'],
  ['1968', 'Opel'], ['2076', 'Peugeot'], ['2166', 'Plymouth'], ['2181', 'Pontiac'], ['2229', 'Porsche'], ['2277', 'Renault'],
  ['2357', 'Rover'], ['2379', 'Saab'], ['2410', 'Seat'], ['2448', 'Skoda'], ['2482', 'Smart'], ['2490', 'Ssang Yong'],
  ['2506', 'Subaru'], ['2546', 'Suzuki'], ['2590', 'Tesla'], ['2595', 'Toyota'], ['2699', 'Trailer'], ['2710', 'Volkswagen'],
  ['2834', 'Volvo']
];

const DEFAULT_SETTINGS = {
  openingHours: 'Öppet vardagar 9–17',
  heroTitle: 'Däck & fälgar som',
  heroHighlight: 'passar din bil',
  heroSub: 'Hitta rätt däck och fälgar till rätt pris – med professionell service.'
};

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...db.settings.all() };
}

function getAdminCars() {
  return db.cars.all();
}

function getAllBrands() {
  const brands = DEFAULT_BRANDS.map(([id, name]) => ({ id, name }));
  for (const c of getAdminCars()) {
    if (!brands.some(b => b.name.toLowerCase() === c.brand.toLowerCase())) {
      brands.push({ id: 'adm-' + encodeURIComponent(c.brand), name: c.brand });
    }
  }
  return brands;
}

function getDiscountFor(userId) {
  return db.rabatter.get(userId);
}

function applyDiscount(items, perBrand) {
  let discountTotal = 0;
  const out = [];
  for (const it of items) {
    const already = it.discountPct > 0 || it.discountedPrice !== undefined;
    const pct = already ? 0 : Number(perBrand[it.manufacturer]) || 0;
    const discountedPrice = pct > 0 ? Math.round((Number(it.price) * (100 - pct)) / 100) : Number(it.price);
    discountTotal += (Number(it.price) - discountedPrice) * (it.qty || 1);
    out.push({ ...it, discountPct: pct, discountedPrice });
  }
  return { items: out, discountTotal };
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
  const user = currentUser(req);
  return user && user.role === 'admin';
}

function currentUser(req) {
  const cookie = (req.headers.cookie || '').split(';').map(c => c.trim());
  const v = cookie.find(c => c.startsWith('vd_session='));
  if (!v) return null;
  const token = v.slice('vd_session='.length);
  const s = db.sessions.byToken(token);
  if (!s) return null;
  return db.users.byId(s.userId);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || hash.length !== 128) return false;
  const calc = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), calc);
}

function makeSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.cleanup(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  db.sessions.insert(token, userId, new Date().toISOString());
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
  const loginUrl = '/logga-in?next=' + encodeURIComponent(next);
  res.writeHead(302, { 'Location': loginUrl });
  res.end();
}

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

function toSet(v) {
  return new Set(String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}

const SEARCH_ALIASES = {
  vinter: 'winter',
  sommar: 'summer',
  sommardack: 'summer',
  sommardäck: 'summer',
  'åretrunt': 'all-season',
  helars: 'all-season',
  helårs: 'all-season',
  dubbdack: 'studded',
  dubbdäck: 'studded'
};

function filterProducts(products, params) {
  const q = (params.q || '').toLowerCase().trim();
  const qq = SEARCH_ALIASES[q] || q;
  const type = params.type || '';
  const marke = toSet(params.marke);
  const inch = toSet(params.inch);
  const season = toSet(params.season);
  const width = toSet(params.width);
  const ratio = toSet(params.ratio);
  const boltCircle = toSet(params.bolt_circle);
  const boltCount = toSet(params.bolt_count);
  const et = toSet(params.et);
  const stock = params.stock === '1';
  const hasImage = params.has_image === '1';

  let list = products;
  if (q) {
    list = list.filter(p =>
      (p.manufacturer_name || '').toLowerCase().includes(q) ||
      (p.name || '').toLowerCase().includes(q) ||
      (p.info || '').toLowerCase().includes(q) ||
      String(p.id).includes(q) ||
      String(p.supplier_reference || '').includes(q) ||
      (qq !== q && ((p.name || '').toLowerCase().includes(qq) || (p.info || '').toLowerCase().includes(qq)))
    );
  }
  if (type === 'falgar') list = list.filter(p => p.type === 'falgar');
  if (type === 'dack') list = list.filter(p => p.type === 'dack');
  if (marke.size) list = list.filter(p => marke.has((p.manufacturer_name || '').toLowerCase()));
  if (inch.size) list = list.filter(p => inch.has(String(p.inch)));
  if (season.size) list = list.filter(p => (p.season || '').split(',').some(s => season.has(s)));
  if (width.size && type === 'dack') list = list.filter(p => width.has(String(p.width)));
  if (ratio.size && type === 'dack') list = list.filter(p => ratio.has(String(p.profile)));
  if (boltCircle.size && type !== 'dack') list = list.filter(p => boltCircle.has(String(p.bolt_circle)));
  if (boltCount.size && type !== 'dack') list = list.filter(p => boltCount.has(String(p.bolt_count)));
  if (et.size && type !== 'dack') list = list.filter(p => et.has(String(p.et)));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);

  if (url.pathname === '/panel' || url.pathname === '/gallery') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (!isAuthed(req)) {
      const loginUrl = '/logga-in?next=' + encodeURIComponent(url.pathname);
      res.writeHead(302, { 'Location': loginUrl });
      res.end();
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
    res.end('User-agent: *\nDisallow: /panel\nDisallow: /gallery\nDisallow: /api\nDisallow: /logga-in\nDisallow: /skapa-konto\nDisallow: /mina-sidor\nSitemap: http://' + (req.headers.host || 'localhost') + '/sitemap.xml\n');
    return;
  }

  if (url.pathname === '/sitemap.xml' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE) || [];
    const base = 'http://' + (req.headers.host || 'localhost');
    const staticUrls = ['', '/dack', '/falgar', '/varukorg', '/villkor', '/bra-att-veta', '/vinterdack-val', '/kontakta-oss'];
    const urls = staticUrls.map(u => `<url><loc>${base}${u}</loc></url>`);
    for (const p of products) {
      urls.push(`<url><loc>${base}/produkt?id=${p.id}</loc></url>`);
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
    const params = Object.fromEntries(url.searchParams);
    const seasonNames = { sommar: 'Sommar', dubb: 'Dubb', 'nordisk-friktion': 'Nordisk friktion', 'eu-friktion': 'EU-friktion' };
    const byName = (a, b) => a.value.localeCompare(b.value, 'sv');
    const byNum = (a, b) => Number(a.value) - Number(b.value);

    const countFacet = (dim) => {
      const rest = { ...params };
      delete rest[dim];
      const list = filterProducts(products, rest);
      const map = new Map();
      for (const p of list) {
        if (dim === 'marke' && p.manufacturer_name) map.set(p.manufacturer_name, (map.get(p.manufacturer_name) || 0) + 1);
        if (dim === 'inch' && p.inch) map.set(String(p.inch), (map.get(String(p.inch)) || 0) + 1);
        if (dim === 'season') { for (const s of (p.season || '').split(',')) { if (s) map.set(s, (map.get(s) || 0) + 1); } }
        if (dim === 'width' && p.width) map.set(String(p.width), (map.get(String(p.width)) || 0) + 1);
        if (dim === 'ratio' && p.profile) map.set(String(p.profile), (map.get(String(p.profile)) || 0) + 1);
        if (dim === 'bolt_circle' && p.bolt_circle) map.set(String(p.bolt_circle), (map.get(String(p.bolt_circle)) || 0) + 1);
        if (dim === 'bolt_count' && p.bolt_count) map.set(String(p.bolt_count), (map.get(String(p.bolt_count)) || 0) + 1);
        if (dim === 'et' && p.et !== undefined && p.et !== null) map.set(String(p.et), (map.get(String(p.et)) || 0) + 1);
      }
      return [...map.entries()].map(([value, count]) => ({ value, count }));
    };

    sendJson(res, 200, {
      total: filterProducts(products, params).length,
      manufacturers: countFacet('marke').sort(byName),
      inches: countFacet('inch').sort(byNum),
      widths: countFacet('width').sort(byNum),
      ratios: countFacet('ratio').sort(byNum),
      seasons: countFacet('season').map(x => ({ ...x, label: seasonNames[x.value] || x.value })).sort(byName),
      boltCircles: countFacet('bolt_circle').sort(byNum),
      boltCounts: countFacet('bolt_count').sort(byNum),
      ets: countFacet('et').sort(byNum)
    });
    return;
  }

  if (url.pathname === '/api/car-model' && req.method === 'GET') {
    const make = url.searchParams.get('make');
    if (!make) {
      sendJson(res, 400, { error: 'make krävs' });
      return;
    }
    const model = url.searchParams.get('model');
    const cars = getAdminCars();
    const adminBrand = make.startsWith('adm-') ? decodeURIComponent(make.slice(4)) : null;
    if (adminBrand) {
      const brandCars = cars.filter(c => c.brand.toLowerCase() === adminBrand.toLowerCase());
      if (!model) {
        sendJson(res, 200, { items: brandCars.map(c => ({ id: 'adm-m-' + c.id, name: c.model })) });
        return;
      }
      const car = brandCars.find(c => 'adm-m-' + c.id === model);
      const years = (car && car.years ? String(car.years) : '').split(',').map(y => y.trim()).filter(Boolean);
      sendJson(res, 200, { items: years.map(y => ({ id: 'adm-y-' + car.id, name: y })), car: car ? { width: car.width, ratio: car.ratio, inch: car.inch } : null });
      return;
    }
    if (model && model.startsWith('adm-m-')) {
      const car = cars.find(c => 'adm-m-' + c.id === model);
      const years = (car && car.years ? String(car.years) : '').split(',').map(y => y.trim()).filter(Boolean);
      sendJson(res, 200, { items: years.map(y => ({ id: 'adm-y-' + car.id, name: y })), car: car ? { width: car.width, ratio: car.ratio, inch: car.inch } : null });
      return;
    }
    let up;
    try {
      const upUrl = `https://vanessasdack.se/api/search/make/${encodeURIComponent(make)}${model ? '/' + encodeURIComponent(model) : ''}`;
      up = await fetch(upUrl, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    } catch (e) {
      sendJson(res, 502, { error: 'Kunde inte nå bilmodellstjänsten' });
      return;
    }
    if (!up.ok) {
      sendJson(res, 502, { error: 'Kunde inte nå bilmodellstjänsten' });
      return;
    }
    let j;
    try {
      j = await up.json();
    } catch (e) {
      sendJson(res, 502, { error: 'Ogiltigt svar' });
      return;
    }
    if (!model) {
      const brand = DEFAULT_BRANDS.find(b => String(b[0]) === make);
      const adminCars = brand ? cars.filter(c => c.brand.toLowerCase() === brand[1].toLowerCase()) : [];
      const adminModels = new Map(adminCars.map(c => [c.model, c.id]));
      let items = Object.entries(j.data || {}).map(([id, name]) => ({ id, name: String(name) }));
      for (const [name, cid] of adminModels) {
        items = items.filter(i => i.name.toLowerCase() !== name.toLowerCase());
        items.push({ id: 'adm-m-' + cid, name });
      }
      sendJson(res, 200, { items });
      return;
    }
    if (j && j.success == 1 && j.data && typeof j.data === 'object') {
      const items = Object.entries(j.data).map(([id, name]) => ({ id, name: String(name) }));
      sendJson(res, 200, { items });
      return;
    }
    sendJson(res, 404, { error: 'Ingen data' });
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
        String(p.id).includes(q) ||
        String(p.supplier_reference || '').includes(q)
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
        if (db.users.byEmail(d.email)) {
          sendJson(res, 409, { error: 'E-postadressen finns redan' });
          return;
        }
        const user = db.users.insert({
          name: d.name.trim(),
          email: d.email.trim().toLowerCase(),
          password: hashPassword(d.password),
          created: new Date().toISOString()
        });
        const token = makeSession(user.id);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `vd_session=${token}; Path=/; Max-Age=2592000; SameSite=Lax`
        });
        res.end(JSON.stringify({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } }));
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
        const user = db.users.byEmail((d.email || '').toLowerCase().trim());
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
        res.end(JSON.stringify({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } }));
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
      db.sessions.remove(token);
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
    sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role, discount: getDiscountFor(user.id) } });
    return;
  }

  if (url.pathname === '/api/my-orders' && req.method === 'GET') {
    const user = currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const orders = db.orders.all().filter(o => o.userId === user.id);
    sendJson(res, 200, { orders });
    return;
  }

  if (url.pathname === '/api/orders' && req.method === 'GET') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const orders = db.orders.all().map(o => ({
      ...o,
      paid: o.paid !== undefined ? o.paid : (o.payment && o.payment.method ? !/faktura/i.test(o.payment.method) : true)
    }));
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
        const now = new Date();
        const id = 'VD-' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + String(db.orders.count() + 1).padStart(4, '0');
        const user = currentUser(req);
        let items = order.items;
        let perBrand = {};
        let discountTotal = 0;
        if (user) {
          perBrand = getDiscountFor(user.id);
          const applied = applyDiscount(order.items, perBrand);
          items = applied.items;
          discountTotal = applied.discountTotal;
        }
        const total = items.reduce((s, i) => s + (i.discountedPrice || Number(i.price)) * (i.qty || 1), 0);
        const saved = {
          ...order,
          id,
          created: now.toISOString(),
          status: 'ny',
          userId: user ? user.id : null,
          paid: order.payment && order.payment.method ? !/faktura/i.test(order.payment.method) : false,
          discount: Object.keys(perBrand).length && discountTotal > 0 ? { perBrand, discountTotal } : null,
          items,
          total
        };
        db.orders.insert(saved);
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
        const order = db.orders.byId(orderId);
        if (!order) {
          sendJson(res, 404, { error: 'Ordern hittades inte' });
          return;
        }
        if (d.status) order.status = d.status;
        if (typeof d.paid === 'boolean') order.paid = d.paid;
        db.orders.update(order);
        sendJson(res, 200, { success: true, order });
      } catch {
        sendJson(res, 400, { error: 'Ogiltig data' });
      }
    });
    return;
  }

  if (url.pathname === '/api/car-brands' && req.method === 'GET') {
    sendJson(res, 200, { items: getAllBrands() });
    return;
  }

  if (url.pathname === '/api/manufacturers' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE) || [];
    const set = new Set();
    for (const p of products) {
      if (p.manufacturer_name) set.add(p.manufacturer_name);
    }
    sendJson(res, 200, { items: [...set].sort((a, b) => a.localeCompare(b, 'sv')) });
    return;
  }

  if (url.pathname === '/api/settings' && req.method === 'GET') {
    sendJson(res, 200, { settings: getSettings() });
    return;
  }

  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const next = { ...getSettings(), ...(d.settings || {}) };
        for (const [k, v] of Object.entries(next)) db.settings.set(k, String(v));
        sendJson(res, 200, { success: true, settings: next });
      } catch {
        sendJson(res, 400, { error: 'Ogiltig data' });
      }
    });
    return;
  }

  if (url.pathname === '/api/cars' && req.method === 'GET') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    sendJson(res, 200, { cars: getAdminCars() });
    return;
  }

  if (url.pathname === '/api/cars' && req.method === 'POST') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        if (!d.brand || !d.model) {
          sendJson(res, 422, { error: 'Märke och modell krävs' });
          return;
        }
        const car = db.cars.insert({
          brand: d.brand.trim(),
          model: d.model.trim(),
          years: d.years ? String(d.years).trim() : '',
          width: d.width ? String(d.width).trim() : '',
          ratio: d.ratio ? String(d.ratio).trim() : '',
          inch: d.inch ? String(d.inch).trim() : ''
        });
        sendJson(res, 200, { success: true, car });
      } catch {
        sendJson(res, 400, { error: 'Ogiltig data' });
      }
    });
    return;
  }

  if (url.pathname.startsWith('/api/cars/') && req.method === 'DELETE') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const carId = Number(url.pathname.slice('/api/cars/'.length));
    db.cars.remove(carId);
    sendJson(res, 200, { success: true });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'GET') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const users = db.users.all();
    sendJson(res, 200, {
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        created: u.created,
        orderCount: db.orders.countByUser(u.id),
        discount: getDiscountFor(u.id)
      }))
    });
    return;
  }

  if (url.pathname === '/api/rabatter' && req.method === 'GET') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const users = db.users.all();
    const rabatter = db.rabatter.all();
    sendJson(res, 200, {
      rabatter: rabatter.map(r => {
        const u = users.find(x => x.id === r.userId);
        return {
          userId: r.userId,
          perBrand: r.perBrand,
          user: u ? { name: u.name, email: u.email } : null
        };
      })
    });
    return;
  }

  if (url.pathname.startsWith('/api/rabatter/') && req.method === 'PUT') {
    if (!isAuthed(req)) {
      sendJson(res, 401, { error: 'Ej inloggad' });
      return;
    }
    const userId = Number(url.pathname.slice('/api/rabatter/'.length));
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const perBrand = d.perBrand || {};
        for (const k of Object.keys(perBrand)) {
          const v = Number(perBrand[k]);
          if (v > 0 && v <= 100) perBrand[k] = v;
          else if (v > 0) perBrand[k] = 100;
          else delete perBrand[k];
        }
        db.rabatter.set(userId, perBrand);
        sendJson(res, 200, { success: true });
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
