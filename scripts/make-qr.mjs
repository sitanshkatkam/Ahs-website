/**
 * Generate the share QR code for the deployed app.
 *
 *   node scripts/make-qr.mjs            # uses appUrl from package.json
 *   node scripts/make-qr.mjs <url>      # or an explicit one
 *
 * Writes share/qr.svg (scales to any print size) and share/qr.png.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';

// Same source of truth the app compiles in, so the printed code and the
// in-app share sheet can never drift apart. An argument still overrides it.
const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const url = process.argv[2] ?? pkg.appUrl;

if (!url) {
  console.error('Usage: node scripts/make-qr.mjs <url>');
  process.exit(1);
}

const outDir = path.join(process.cwd(), 'share');
await fs.mkdir(outDir, { recursive: true });

const options = {
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#0f1115', light: '#ffffff' },
};

const svg = await QRCode.toString(url, { ...options, type: 'svg', width: 1024 });
await fs.writeFile(path.join(outDir, 'qr.svg'), svg);
await QRCode.toFile(path.join(outDir, 'qr.png'), url, { ...options, width: 1024 });

// Also ship it inside the app, so the in-app share sheet can show a QR without
// bundling a QR encoder into the client. It's precached, so it works offline.
const publicDir = path.join(process.cwd(), 'public');
await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(path.join(publicDir, 'qr.svg'), svg);

console.log(`QR for ${url}`);
console.log(`  ${path.join('share', 'qr.svg')}`);
console.log(`  ${path.join('share', 'qr.png')}`);
console.log(`  ${path.join('public', 'qr.svg')}  (served in-app)`);
