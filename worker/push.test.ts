import { describe, expect, it, vi } from 'vitest';
import { VapidSigner, sendPoke } from './push';

/**
 * The VAPID signature is the one piece here that fails silently: a bad JWT
 * just gets a 401 from the push service and no notification is ever delivered.
 * So these tests verify the signature cryptographically rather than trusting
 * that it looks about right.
 */

const b64urlToBytes = (s: string) => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Uint8Array.from(
    atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad),
    (c) => c.charCodeAt(0),
  );
};
const bytesToB64url = (b: ArrayBuffer | Uint8Array) => {
  const arr = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of arr) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function generateKeys() {
  // The Workers type definitions widen these return types, so narrow by hand.
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer;
  const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  return { publicKey: bytesToB64url(raw), privateKey: jwk.d!, verifyKey: kp.publicKey };
}

function parseAuth(header: string) {
  const t = /t=([^,]+)/.exec(header)?.[1];
  const k = /k=(.+)$/.exec(header)?.[1];
  const [h, p, s] = (t ?? '').split('.');
  return {
    token: t!,
    key: k!,
    header: JSON.parse(new TextDecoder().decode(b64urlToBytes(h))),
    payload: JSON.parse(new TextDecoder().decode(b64urlToBytes(p))),
    signature: b64urlToBytes(s),
    signedInput: `${h}.${p}`,
  };
}

describe('VapidSigner', () => {
  it('produces a signature the push service can verify', async () => {
    const { publicKey, privateKey, verifyKey } = await generateKeys();
    const signer = new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');

    const auth = await signer.authHeader('https://fcm.googleapis.com/fcm/send/abc123');
    const parsed = parseAuth(auth);

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      parsed.signature,
      new TextEncoder().encode(parsed.signedInput),
    );
    expect(ok).toBe(true);
  });

  it('uses the ES256 header the spec requires', async () => {
    const { publicKey, privateKey } = await generateKeys();
    const signer = new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');
    const parsed = parseAuth(await signer.authHeader('https://fcm.googleapis.com/fcm/send/x'));
    expect(parsed.header).toEqual({ typ: 'JWT', alg: 'ES256' });
  });

  it('scopes the audience to the push service origin, not the full endpoint', async () => {
    const { publicKey, privateKey } = await generateKeys();
    const signer = new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');
    const parsed = parseAuth(
      await signer.authHeader('https://updates.push.services.mozilla.com/wpush/v2/long-token'),
    );
    expect(parsed.payload.aud).toBe('https://updates.push.services.mozilla.com');
    expect(parsed.payload.sub).toBe('mailto:test@example.com');
  });

  it('sets an expiry inside the 24 hour ceiling', async () => {
    const { publicKey, privateKey } = await generateKeys();
    const signer = new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');
    const parsed = parseAuth(await signer.authHeader('https://fcm.googleapis.com/fcm/send/x'));
    const now = Math.floor(Date.now() / 1000);
    expect(parsed.payload.exp).toBeGreaterThan(now);
    expect(parsed.payload.exp - now).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('reuses one signature across subscriptions on the same service', async () => {
    // This is what keeps a tick inside the free plan's 10ms of CPU.
    const { publicKey, privateKey } = await generateKeys();
    const signer = new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');
    const a = await signer.authHeader('https://fcm.googleapis.com/fcm/send/one');
    const b = await signer.authHeader('https://fcm.googleapis.com/fcm/send/two');
    expect(a).toBe(b);
  });

  it('signs separately for a different push service', async () => {
    const { publicKey, privateKey } = await generateKeys();
    const signer = new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');
    const a = await signer.authHeader('https://fcm.googleapis.com/fcm/send/one');
    const b = await signer.authHeader('https://updates.push.services.mozilla.com/wpush/v2/two');
    expect(a).not.toBe(b);
  });

  it('advertises the public key so the service can check it', async () => {
    const { publicKey, privateKey } = await generateKeys();
    const signer = new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');
    const parsed = parseAuth(await signer.authHeader('https://fcm.googleapis.com/fcm/send/x'));
    expect(parsed.key).toBe(publicKey);
  });
});

describe('sendPoke', () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } };

  async function signer() {
    const { publicKey, privateKey } = await generateKeys();
    return new VapidSigner(privateKey, publicKey, 'mailto:test@example.com');
  }

  it('sends an empty, short-TTL POST and reports success', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await sendPoke(sub, await signer())).toBe('sent');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(sub.endpoint);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined(); // payload-less by design
    const headers = init.headers as Record<string, string>;
    expect(headers.TTL).toBe('120');
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);

    vi.unstubAllGlobals();
  });

  it('reports a dropped subscription so the caller can prune it', async () => {
    for (const status of [404, 410]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
      expect(await sendPoke(sub, await signer())).toBe('gone');
      vi.unstubAllGlobals();
    }
  });

  it('reports a transient failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    expect(await sendPoke(sub, await signer())).toBe('failed');
    vi.unstubAllGlobals();
  });

  it('survives the network being down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    expect(await sendPoke(sub, await signer())).toBe('failed');
    vi.unstubAllGlobals();
  });
});
