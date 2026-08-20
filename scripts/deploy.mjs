/**
 * One-shot deploy: KV namespace, VAPID secret, build, publish.
 *
 * Run `wrangler login` yourself first — the OAuth flow needs a real terminal.
 * Everything after that is automated and safe to re-run; each step is a no-op
 * if it's already been done.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const run = (args, opts = {}) =>
  execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: opts.pipe ? 'pipe' : 'inherit',
    shell: true,
    ...opts,
  });

// 1. Must be logged in.
try {
  const who = run(['whoami'], { pipe: true });
  const email = /([\w.+-]+@[\w.-]+)/.exec(who)?.[1] ?? 'your account';
  console.log(`Logged in as ${email}\n`);
} catch {
  console.error('Not logged in to Cloudflare.\n\n  npx wrangler login\n\nThen run this again.');
  process.exit(1);
}

// 2. KV namespace for push subscriptions.
let toml = fs.readFileSync('wrangler.toml', 'utf8');
if (toml.includes('PLACEHOLDER_REPLACED_AT_SETUP')) {
  console.log('Creating KV namespace...');
  const out = run(['kv', 'namespace', 'create', 'SUBS'], { pipe: true });
  const id = /id\s*=\s*"([a-f0-9]{32})"/.exec(out)?.[1] ?? /"id":\s*"([a-f0-9]{32})"/.exec(out)?.[1];
  if (!id) {
    console.error('Could not parse the namespace id from:\n' + out);
    process.exit(1);
  }
  toml = toml.replace('PLACEHOLDER_REPLACED_AT_SETUP', id);
  fs.writeFileSync('wrangler.toml', toml);
  console.log(`KV namespace ${id} wired into wrangler.toml\n`);
} else {
  console.log('KV namespace already configured\n');
}

// 3. VAPID private key as a secret. Piped in, never printed.
const { privateKey } = JSON.parse(fs.readFileSync('.vapid.json', 'utf8'));
console.log('Setting VAPID_PRIVATE_KEY secret...');
run(['secret', 'put', 'VAPID_PRIVATE_KEY'], { input: privateKey, stdio: ['pipe', 'inherit', 'inherit'] });

// 4. Build and ship.
console.log('\nBuilding...');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
console.log('\nDeploying...');
run(['deploy']);
