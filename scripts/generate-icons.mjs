// Generates the home-screen icons from public/brand/mark.png (the transparent
// BrightLink mark) on a solid black square:
//   public/apple-touch-icon.png (180)  iOS "Add to Home Screen"
//   public/icon-192.png, icon-512.png  manifest.json (Android / desktop PWA)
// They must be opaque: iOS fills a transparent apple-touch-icon with white.
// After regenerating, bump the ?v= on the icon links in app/layout.tsx.
// Run with: node scripts/generate-icons.mjs

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const markPath = path.join(root, 'public', 'brand', 'mark.png');

// Mark spans 70% of the square: inside the 80% safe zone of a "maskable"
// icon, so Android's circle / squircle masks never clip the chain.
const MARK_FRACTION = 0.70;

async function makeIcon(size, name) {
  const markSize = Math.round(size * MARK_FRACTION);

  const mark = await sharp(markPath)
    .trim()
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .removeAlpha()
    .png()
    .toFile(path.join(root, 'public', name));

  console.log(`✓ ${name}`);
}

await makeIcon(180, 'apple-touch-icon.png');
await makeIcon(192, 'icon-192.png');
await makeIcon(512, 'icon-512.png');
console.log('Done — icons written to public/');
