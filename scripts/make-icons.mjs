/**
 * Generate every app icon from one source image.
 *
 *   node scripts/make-icons.mjs
 *
 * Source: brand/logo-source.png — the eagle crest on a navy rounded square.
 *
 * Three things the source can't be used for as-is, and what is done about each:
 *
 *  - It sits on white. The rounded corners are painted into the artwork, so
 *    dropping it straight into an icon leaves white wedges once iOS or Android
 *    applies its own rounding on top. Everything below is drawn on a full-bleed
 *    navy field and the source is scaled past the edges so those corners fall
 *    outside the canvas.
 *  - Maskable icons get cropped to whatever shape the launcher likes, so the
 *    art has to sit inside the middle ~80%.
 *  - A notification badge is alpha only: Android throws the colours away and
 *    renders whatever is opaque. Feeding it this image would produce a solid
 *    white square. The badge is built separately, as a silhouette of the eagle
 *    with the background knocked out.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { Resvg } from '@resvg/resvg-js';

const SOURCE = path.join('brand', 'logo-source.png');
const NAVY = '#00184a'; // sampled from the source background

/** The rounded corners occupy the outer ~8%; overscan pushes them off-canvas. */
const OVERSCAN = 1.2;
/** Maskable safe zone: art must survive an aggressive circular crop. */
const MASKABLE_SCALE = 0.66;

const dataUri = `data:image/png;base64,${fs.readFileSync(SOURCE).toString('base64')}`;

/**
 * @param {number} scale 1 = source fills the canvas exactly
 * @param {string} bg
 */
function svg(scale, bg = NAVY) {
  const size = 1024;
  const drawn = size * scale;
  const offset = (size - drawn) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <image x="${offset}" y="${offset}" width="${drawn}" height="${drawn}" xlink:href="${dataUri}"/>
</svg>`;
}

function png(source, size, file) {
  const out = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join('public', file), out);
  console.log(`  ${file.padEnd(24)} ${size}x${size}  ${(out.length / 1024).toFixed(1)} KB`);
}

/**
 * The notification badge: the eagle alone, as pure alpha.
 *
 * Cropped from the source and knocked out by luminance — the crest is white and
 * red on navy, so anything appreciably brighter than the background becomes
 * opaque and everything else disappears. The text is left out entirely: at 24dp
 * "AMERICAN HIGH" is a grey smear.
 */
function badge(size, file) {
  const src = PNG.sync.read(fs.readFileSync(SOURCE));
  /*
    The head, not the whole crest. The full bird is roughly 2.5:1, so fitting it
    into a square badge letterboxes it down to something tiny at 24dp. The head
    is close to square, is the half anybody recognises, and fills the space.
  */
  const box = { x: 620, y: 425, w: 430, h: 340 };
  const side = Math.max(box.w, box.h);
  const out = new PNG({ width: size, height: size });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map the destination square back into the source crop, centring the
      // wider-than-tall eagle vertically.
      const sx = Math.round(box.x + (x / size) * side - (side - box.w) / 2);
      const sy = Math.round(box.y + (y / size) * side - (side - box.h) / 2);
      const o = (size * y + x) * 4;

      /*
        Anything outside the crop is transparent, and the check has to be
        against the box rather than the image. The eagle is wide and short, so
        squaring it up reaches far above and below — far enough to drag in the
        "AMERICAN HIGH" lettering underneath, which at 24dp is a row of
        unreadable specks stuck to the bird.
      */
      if (
        sx < box.x ||
        sy < box.y ||
        sx >= box.x + box.w ||
        sy >= box.y + box.h ||
        sx >= src.width ||
        sy >= src.height
      ) {
        out.data[o + 3] = 0;
        continue;
      }
      const i = (src.width * sy + sx) * 4;
      const [r, g, b] = [src.data[i], src.data[i + 1], src.data[i + 2]];
      // Navy is dark and blue-dominant; the crest is neither.
      const isBackground = b > r + 20 && r < 90;
      out.data[o] = 255;
      out.data[o + 1] = 255;
      out.data[o + 2] = 255;
      out.data[o + 3] = isBackground ? 0 : 255;
    }
  }

  const buf = PNG.sync.write(out);
  fs.writeFileSync(path.join('public', file), buf);
  const opaque = out.data.filter((_, i) => i % 4 === 3 && out.data[i] > 0).length;
  console.log(
    `  ${file.padEnd(24)} ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB  ` +
      `${((100 * opaque) / (size * size)).toFixed(0)}% opaque`,
  );
}

console.log('Writing icons to public/');
/*
  A small raster favicon, not an SVG. The obvious move — wrap the source in an
  <svg> and ship that — inlines the 1.2 MB PNG as base64 and drops a 1.7 MB file
  into the precache, which is most of the app's download spent on a 16px tab
  icon.
*/
png(svg(OVERSCAN), 64, 'favicon.png');

png(svg(OVERSCAN), 192, 'icon-192.png');
png(svg(OVERSCAN), 512, 'icon-512.png');
png(svg(OVERSCAN), 180, 'apple-touch-icon.png');

/*
  The maskable is built from the *cleaned* icon, not the raw source. Shrinking
  the source into the safe zone directly brings its painted-on white corners
  along with it, and they land in full view as four white wedges around the
  art. Overscanning first throws those away; only then is it safe to scale down.
*/
const cleaned = new Resvg(svg(OVERSCAN), { fitTo: { mode: 'width', value: 1024 } })
  .render()
  .asPng();
const cleanedUri = `data:image/png;base64,${cleaned.toString('base64')}`;
const inset = (1024 * (1 - MASKABLE_SCALE)) / 2;
png(
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${NAVY}"/>
  <image x="${inset}" y="${inset}" width="${1024 * MASKABLE_SCALE}" height="${1024 * MASKABLE_SCALE}" xlink:href="${cleanedUri}"/>
</svg>`,
  512,
  'icon-maskable-512.png',
);
badge(96, 'badge-96.png');
