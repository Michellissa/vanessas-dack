const fs = require('fs');
const path = require('path');

const BASE = 'https://vanessasdack.se';
const CONCURRENCY = 8;
const RETRIES = 3;

async function getProductIds() {
  const res = await fetch(`${BASE}/sitemap.xml`);
  const xml = await res.text();
  const ids = new Map();
  for (const m of xml.matchAll(/<loc>https?:\/\/[^<]*\/(falgar\/[^\/]+|dack\/[^\/]+)\/(\d+)\/[^<]*<\/loc>/g)) {
    const isFalgar = m[1].startsWith('falgar');
    const type = isFalgar ? 'falgar' : 'dack';
    const season = isFalgar ? '' : m[1].slice('dack/'.length);
    const key = m[2];
    if (!ids.has(key)) ids.set(key, { type, season });
  }
  return [...ids.entries()].map(([id, v]) => ({ id: Number(id), type: v.type, season: v.season }));
}

async function fetchProduct(id) {
  const url = `${BASE}/api/product/${id}/`;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const json = await res.json();
      if (json && json.success === 1 && json.data) return json.data;
      return null;
    } catch (e) {
      if (i === RETRIES - 1) return null;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
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

async function runSync({ dataDir } = {}) {
  const dir = dataDir || path.join(__dirname, 'data');
  const productsFile = path.join(dir, 'products.json');
  const metaFile = path.join(dir, 'meta.json');
  fs.mkdirSync(dir, { recursive: true });

  const productRefs = await getProductIds();
  const started = Date.now();
  const products = await mapConcurrent(productRefs, async ref => {
    const p = await fetchProduct(ref.id);
    if (p) {
      p.type = ref.type;
      p.season = ref.season;
    }
    return p;
  }, CONCURRENCY);

  const valid = products.filter(Boolean).sort(
    (a, b) => (a.manufacturer_name || '').localeCompare(b.manufacturer_name || '') || (a.name || '').localeCompare(b.name || '')
  );

  const now = new Date().toISOString();
  fs.writeFileSync(productsFile, JSON.stringify(valid));
  fs.writeFileSync(metaFile, JSON.stringify({ lastSync: now, productCount: valid.length, requestedCount: productRefs.length, durationMs: Date.now() - started }));

  return {
    productCount: valid.length,
    requestedCount: productRefs.length,
    durationMs: Date.now() - started,
    inStock: valid.filter(p => p.stock > 0).length,
    extStock: valid.filter(p => p.supplier_stock_external > 0).length
  };
}

module.exports = { runSync, BASE };