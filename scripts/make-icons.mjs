/**
 * Generate every app icon from one source of truth.
 *
 *   node scripts/make-icons.mjs
 *
 * An eagle with AHS in front of it. The lettering is drawn as geometry rather
 * than text on purpose: a font would render differently depending on what's
 * installed and can vanish entirely when rasterized headlessly.
 *
 * Three shapes come out of this, and the differences matter:
 *   - rounded square  : favicon and the standard PWA icons
 *   - full bleed      : maskable, where the OS crops to its own shape, so the
 *                       art has to sit inside the inner ~80% safe zone
 *   - square          : apple-touch-icon, because iOS applies its own rounding
 *                       and pre-rounded corners would be masked twice
 */

import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const BG = '#191c22'; // matches the app's dark background and theme-color
const EAGLE = '#3f6ea8';
const TEXT = '#ffffff';

/** Wings, head, beak and tail. Angular rather than feathered — detail is mush at 48px. */
const eagle = `
  <g fill="${EAGLE}">
    <path d="M256 205 L330 168 L317 200 L392 156 L373 196 L452 158 L419 214 L463 206 L409 253 L256 253 Z"/>
    <path d="M256 205 L182 168 L195 200 L120 156 L139 196 L60 158 L93 214 L49 206 L103 253 L256 253 Z"/>
    <circle cx="256" cy="150" r="33"/>
    <path d="M283 150 L312 160 L283 172 Z"/>
    <path d="M226 236 L286 236 L272 392 L256 428 L240 392 Z"/>
  </g>`;

/** A and H are polylines; S is a stroked curve. No font dependency anywhere. */
const ahs = `
  <g fill="none" stroke="${TEXT}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">
    <path d="M126 402 L164 292 L202 402 M141 366 H187"/>
    <path d="M220 292 V402 M296 292 V402 M220 347 H296"/>
    <path d="M386 316 C386 298 366 290 348 290 C326 290 314 302 314 318 C314 334 328 342 346 346
             C376 352 386 362 386 378 C386 394 370 402 350 402 C330 402 314 393 314 375"/>
  </g>`;

/**
 * @param {'rounded'|'bleed'|'square'} shape
 * @param {number} scale art scale; maskable shrinks into the safe zone
 */
function svg(shape, scale = 1) {
  const radius = shape === 'rounded' ? 112 : 0;
  const art = scale === 1 ? `${eagle}${ahs}` : `<g transform="translate(256,256) scale(${scale}) translate(-256,-256)">${eagle}${ahs}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${BG}"/>
  ${art}
</svg>`;
}

function png(source, size, file) {
  const out = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join('public', file), out);
  console.log(`  ${file.padEnd(24)} ${size}x${size}  ${(out.length / 1024).toFixed(1)} KB`);
}

console.log('Writing icons to public/');
fs.writeFileSync(path.join('public', 'favicon.svg'), `${svg('rounded')}\n`);
console.log('  favicon.svg              vector');

png(svg('rounded'), 192, 'icon-192.png');
png(svg('rounded'), 512, 'icon-512.png');
// 0.78 keeps the art clear of whatever shape Android crops to.
png(svg('bleed', 0.78), 512, 'icon-maskable-512.png');
png(svg('square'), 180, 'apple-touch-icon.png');
