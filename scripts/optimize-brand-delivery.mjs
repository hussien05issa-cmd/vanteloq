// Delivery variants only. Preserve the original brand masters and transparency.
import sharp from 'sharp';
import { stat } from 'node:fs/promises';
const assets = [
  ['vanteloq-mark.png', 'vanteloq-mark-ui.webp', 128],
  ['vanteloq-logo.png', 'vanteloq-logo-ui.webp', 640],
  ['bookloq-mark.png', 'bookloq-mark-ui.webp', 128],
  ['bookloq-logo-transparent.png', 'bookloq-logo-ui.webp', 640],
  ['google-g.png', 'google-g-ui.webp', 84],
  ['plaid-mark.png', 'plaid-mark-ui.webp', 84],
  ['lightspeed-mark.png', 'lightspeed-mark-ui.webp', 84],
];
for (const [source, target, width] of assets) {
  await sharp('public/brand/' + source).resize({ width, withoutEnlargement:true }).webp({ lossless:true, effort:6 }).toFile('public/brand/' + target);
  console.log(target, (await stat('public/brand/' + target)).size);
}
for (const width of [480, 768]) {
  const target = `public/brand/vanteloq-alpine-mobile-${width}.webp`;
  await sharp('public/brand/vanteloq-alpine-hero-mobile-v2.webp').resize({ width, withoutEnlargement:true }).webp({ quality:85, effort:6 }).toFile(target);
  console.log(target, (await stat(target)).size);
}
