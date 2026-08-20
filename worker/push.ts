/**
 * Minimal Web Push sender for the Workers runtime.
 *
 * The usual `web-push` npm package is Node-only (node:crypto), so this does the
 * VAPID half by hand with WebCrypto. It only ever sends *payload-less* pushes —
 * a bare poke — which is why there is no aes128gcm encryption here at all.
 *
 * That is a deliberate design choice, not a shortcut: the service worker
 * already has the bell schedule and the user's own settings on-device, so it
 * can work out what to show by itself. Nothing about anyone's classes,
 * teachers, or assignments ever reaches this server.
 */

export type PushSubscriptionRecord = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const bytesToB64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Import the raw base64url `d` value as a signing key. */
async function importVapidKey(privateKeyB64: string, publicKeyB64: string): Promise<CryptoKey> {
  const pub = b64urlToBytes(publicKeyB64); // 65 bytes: 0x04 || X || Y
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: privateKeyB64,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
}

/**
 * A VAPID JWT is scoped to the push service origin, not to the subscription —
 * so one signature can be reused for every subscription on the same service.
 * That matters: signing is the expensive part, and Workers' free plan gives
 * 10ms of CPU per invocation.
 */
export class VapidSigner {
  private key: Promise<CryptoKey>;
  private cache = new Map<string, { token: string; expires: number }>();

  constructor(
    privateKeyB64: string,
    private publicKeyB64: string,
    private subject: string,
  ) {
    this.key = importVapidKey(privateKeyB64, publicKeyB64);
  }

  async authHeader(endpoint: string): Promise<string> {
    const audience = new URL(endpoint).origin;
    const now = Math.floor(Date.now() / 1000);

    const cached = this.cache.get(audience);
    // Re-sign well before the 24h ceiling so a long-running tick can't emit an
    // expired token.
    if (cached && cached.expires - now > 600) {
      return `vapid t=${cached.token}, k=${this.publicKeyB64}`;
    }

    const exp = now + 12 * 60 * 60;
    const header = bytesToB64url(new TextEncoder().encode('{"typ":"JWT","alg":"ES256"}'));
    const payload = bytesToB64url(
      new TextEncoder().encode(JSON.stringify({ aud: audience, exp, sub: this.subject })),
    );
    const unsigned = `${header}.${payload}`;

    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await this.key,
      new TextEncoder().encode(unsigned),
    );

    const token = `${unsigned}.${bytesToB64url(sig)}`;
    this.cache.set(audience, { token, expires: exp });
    return `vapid t=${token}, k=${this.publicKeyB64}`;
  }
}

export type SendResult = 'sent' | 'gone' | 'failed';

/**
 * Send an empty push. `gone` means the browser dropped the subscription and we
 * should stop trying — the caller prunes on that.
 */
export async function sendPoke(
  sub: PushSubscriptionRecord,
  signer: VapidSigner,
): Promise<SendResult> {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await signer.authHeader(sub.endpoint),
        TTL: '120', // if it can't be delivered in two minutes it's already stale
        Urgency: 'high',
        // No Content-Length: it's a forbidden header for fetch to set, and a
        // bodyless POST gets the right value on its own.
      },
      // Push services can be slow; without a cap one bad endpoint could eat the
      // whole tick.
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
