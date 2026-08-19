const fs = require('fs');
const path = require('path');

const BASE = 'https://vanessasdack.se';
const DATA_DIR = path.join(__dirname, 'data');
const IMG_DIR = path.join(DATA_DIR, 'images');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const CONCURRENCY = 10;
const RETRIES = 3;

function isValidImage(buf) {
  const sig = buf.slice(0, 8).toString('hex').toUpperCase();
  if (sig.startsWith('FFD8FF')) return true;
  if (sig.startsWith('89504E47')) return true;
  if (sig.startsWith('47494638')) return true;
  if (sig.startsWith('52494646')) return true;
  if (sig.startsWith('3C3F786D6C') || sig.startsWith('3C737667')) return true;
  return false;
}

async function download(url, dest) {
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return false;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isValidImage(buf)) return false;
      fs.writeFileSync(dest, buf);
      return true;
    } catch (e) {
      if (i === RETRIES - 1) return false;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return false;
}

async function downloadFile(f) {
  for (const dir of [1, 2, 3, 4]) {
    const okFile = await download(`${BASE}/img/${dir}/${f}`, path.join(IMG_DIR, f));
    if (okFile) return true;
  }
  return false;
}

async function mapConcurrent(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return results;
}

async function main() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  const files = [...new Set(products.flatMap(p => (p.image || '').split(',').filter(Boolean)))];

  const existing = new Set(fs.readdirSync(IMG_DIR));
  const todo = files.filter(f => {
    if (!existing.has(f)) return true;
    const buf = fs.readFileSync(path.join(IMG_DIR, f));
    return !isValidImage(buf);
  });
  console.log(`${files.length} bildfiler, ${todo.length} att ladda ner eller reparera`);

  const started = Date.now();
  let ok = 0;
  await mapConcurrent(todo, async f => {
    const success = await downloadFile(f);
    if (success) ok++;
  }, CONCURRENCY);

  let totalBytes = 0;
  for (const f of fs.readdirSync(IMG_DIR)) {
    totalBytes += fs.statSync(path.join(IMG_DIR, f)).size;
  }

  console.log(`Klar: ${ok}/${todo.length} nerladdade, ${files.length} totalt i data/images (${Math.round(totalBytes / 1048576)} MB, ${Math.round((Date.now() - started) / 1000)}s)`);

  try {
    const sharp = require('sharp');
    const webpDir = path.join(IMG_DIR, 'webp');
    fs.mkdirSync(webpDir, { recursive: true });
    let webpOk = 0;
    await mapConcurrent(files, async f => {
      const dest = path.join(webpDir, path.basename(f, path.extname(f)) + '.webp');
      if (fs.existsSync(dest)) { webpOk++; return; }
      try {
        await sharp(path.join(IMG_DIR, f)).rotate().resize({ width: 800, withoutEnlargement: true }).webp({ quality: 78 }).toFile(dest);
        webpOk++;
      } catch (e) {}
    }, 6);
    console.log(`WebP: ${webpOk}/${files.length} genererade`);
  } catch (e) {
    console.log('WebP hoppas över (sharp saknas): ' + e.message);
  }
}

main().catch(e => {
  console.error('Fel:', e);
  process.exit(1);
});