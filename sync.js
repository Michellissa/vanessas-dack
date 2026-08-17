const { runSync } = require('./sync-lib');

runSync().then(r => {
  console.log(`Klar: ${r.productCount} produkter sparade i data/products.json (${Math.round(r.durationMs / 1000)}s)`);
  console.log(`Internt lager > 0: ${r.inStock} st | Externt lager > 0: ${r.extStock} st`);
}).catch(e => {
  console.error('Fel:', e);
  process.exit(1);
});