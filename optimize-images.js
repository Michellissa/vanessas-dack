const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMG_DIR = path.join(__dirname, 'data', 'images');
const WEBP_DIR = path.join(IMG_DIR, 'webp');
const MAX_DIM = 800;

fs.mkdirSync(WEBP_DIR, { recursive: true });

const files = fs.readdirSync(IMG_DIR).filter(f => /\.(jpe?g|png)$/i.test(f));

let done = 0, skipped = 0;
for (const file of files) {
  const src = path.join(IMG_DIR, file);
  const out = path.join(WEBP_DIR, path.basename(file, path.extname(file)) + '.webp');
  try {
    sharp(src)
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(out)
      .then(() => {
        done++;
        if (done + skipped === files.length) {
          console.log(`Klart: ${done} konverterade, ${skipped} hoppade över.`);
        }
      })
      .catch(() => {
        skipped++;
        if (done + skipped === files.length) {
          console.log(`Klart: ${done} konverterade, ${skipped} hoppade över.`);
        }
      });
  } catch {
    skipped++;
  }
}