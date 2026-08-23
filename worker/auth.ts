/**
 * Google sign-in, server side.
 *
 * The authorization-code flow, run entirely on the Worker. The browser never
 * sees an ID token or an access token — it gets an opaque session cookie and
 * nothing else, so a cross-site script on the page has nothing worth stealing.
 *
 * Signing in is optional. Everything the app already does — schedules,
 * countdowns, notifications — keeps working signed out, and none of it reads
 * these tables. An account exists so a future feature has a stable identity.
 *
 * Two deliberate choices worth knowing:
 *
 *  - The ID token's signature is not verified. Google's OpenID Connect docs
 *    say so explicitly for this flow: the token arrives over a direct HTTPS
 *    channel to Google's token endpoint, authenticated with our client secret,
 *    so there is no intermediary who could have forged it. The claims that
 *    still matter — iss, aud, exp — are all checked below. If this token were
 *    ever passed on to another service, that service would have to verify it.
 *  - PKCE is included even though a confidential client does not require it.
 *    It costs one hash and closes the door on a leaked authorization code.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** How long a signed-in session lasts before it has to be re-established. */
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;

/** The round trip to Google and back should take seconds, not hours. */
const TX_MS = 10 * 60 * 1000;

const SESSION_COOKIE = 'ahs_session';
const TX_COOKIE = 'ahs_oauth_tx';

export type AuthEnv = {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type Account = {
  email: string;
  name: string | null;
  picture: string | null;
};

/**
 * Whether sign-in can work at all. Until the keys are set, every route below
 * reports itself unavailable and the UI hides the button rather than offering
 * something that is going to fail.
 */
export function authConfigured(env: AuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToString(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  // Secure + HttpOnly: not readable by script, not sent over plain HTTP.
  // SameSite=Lax rather than Strict, because the browser has to send the
  // transaction cookie when Google redirects back with the code.
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

/* ------------------------------------------------------------------ */
/* the pending-login cookie                                            */
/* ------------------------------------------------------------------ */

/**
 * State and PKCE verifier have to survive the trip to Google, and they must not
 * be forgeable. Rather than a table of pending logins, they ride in a cookie
 * signed with the client secret — same guarantee, nothing to clean up.
 */
async function hmacKey(env: AuthEnv): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(env.GOOGLE_CLIENT_SECRET ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

type Tx = { state: string; verifier: string; exp: number };

async function sealTx(env: AuthEnv, tx: Tx): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(tx)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

async function openTx(env: AuthEnv, sealed: string | null): Promise<Tx | null> {
  if (!sealed) return null;
  const dot = sealed.lastIndexOf('.');
  if (dot < 1) return null;

  const body = sealed.slice(0, dot);
  const sig = sealed.slice(dot + 1);

  const expected = b64url(
    await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)),
  );

  // Compare every character rather than bailing at the first mismatch, so the
  // time taken says nothing about how close a forgery got.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const tx = JSON.parse(b64urlToString(body)) as Tx;
    return tx.exp > Date.now() ? tx : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

const redirectUri = (request: Request) =>
  `${new URL(request.url).origin}/api/auth/google/callback`;

/** Step one: bounce the student to Google. */
export async function startAuth(request: Request, env: AuthEnv): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken();
  const challenge = await sha256(verifier);

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID as string);
  url.searchParams.set('redirect_uri', redirectUri(request));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // No refresh token: the app never acts for a student when they are away, so
  // there is nothing to refresh and nothing long-lived worth holding.
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': cookie(
        TX_COOKIE,
        await sealTx(env, { state, verifier, exp: Date.now() + TX_MS }),
        TX_MS / 1000,
      ),
    },
  });
}

/** A failed sign-in lands back on the app, not on a stack trace. */
const backToApp = (reason: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `/?signin=${encodeURIComponent(reason)}`,
      'Set-Cookie': cookie(TX_COOKIE, '', 0),
    },
  });

/** Step two: Google sends the student back with a code. */
export async function handleCallback(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.searchParams.get('error')) return backToApp('cancelled');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const tx = await openTx(env, readCookie(request, TX_COOKIE));

  // The state check is the CSRF defence. Without it someone could feed a
  // victim's browser their own authorization code and quietly sign that
  // browser in as themselves.
  if (!code || !state || !tx || tx.state !== state) return backToApp('expired');

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID as string,
      client_secret: env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: redirectUri(request),
      grant_type: 'authorization_code',
      code_verifier: tx.verifier,
    }),
  });
  if (!res.ok) return backToApp('google-rejected');

  const body = (await res.json()) as { id_token?: string };
  const claims = readIdToken(body.id_token, env.GOOGLE_CLIENT_ID as string);
  if (!claims) return backToApp('bad-token');

  const now = Date.now();
  const token = randomToken();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, name, picture, created, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email, name = excluded.name,
         picture = excluded.picture, last_seen = excluded.last_seen`,
    ).bind(claims.sub, claims.email, claims.name ?? null, claims.picture ?? null, now),
    env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?1, ?2, ?3, ?4)',
    ).bind(await sha256(token), claims.sub, now, now + SESSION_MS),
  ]);

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', '/?signin=ok'],
      ['Set-Cookie', cookie(SESSION_COOKIE, token, SESSION_MS / 1000)],
      ['Set-Cookie', cookie(TX_COOKIE, '', 0)],
    ],
  });
}

type Claims = { sub: string; email: string; name?: string; picture?: string };

/**
 * Read the ID token's claims and check the ones that matter. No signature
 * check — see the note at the top of this file for why that is correct on this
 * path and would not be anywhere else.
 */
export function readIdToken(idToken: string | undefined, clientId: string): Claims | null {
  if (!idToken) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  let c: Record<string, unknown>;
  try {
    c = JSON.parse(b64urlToString(parts[1]));
  } catch {
    return null;
  }

  const iss = c.iss;
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') return null;
  if (c.aud !== clientId) return null;
  if (typeof c.exp !== 'number' || c.exp * 1000 <= Date.now()) return null;
  if (typeof c.sub !== 'string' || typeof c.email !== 'string') return null;
  // An unverified address proves nothing about who is signing in.
  if (c.email_verified === false) return null;

  return {
    sub: c.sub,
    email: c.email,
    name: typeof c.name === 'string' ? c.name : undefined,
    picture: typeof c.picture === 'string' ? c.picture : undefined,
  };
}

/** Who is this, if anyone. Null is a completely normal answer. */
export async function currentAccount(request: Request, env: AuthEnv): Promise<Account | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT u.email AS email, u.name AS name, u.picture AS picture
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.expires > ?2`,
  )
    .bind(await sha256(token), Date.now())
    .first<{ email: string; name: string | null; picture: string | null }>();

  return row ?? null;
}

/** The signed-in account's id, or null. What sync keys off. */
export async function currentUserId(request: Request, env: AuthEnv): Promise<string | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const row = await env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token_hash = ?1 AND expires > ?2',
  )
    .bind(await sha256(token), Date.now())
    .first<{ user_id: string }>();

  return row?.user_id ?? null;
}

/** Sign out this device only, and drop the row so the cookie is truly dead. */
export async function signOut(request: Request, env: AuthEnv): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1')
      .bind(await sha256(token))
      .run();
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json',
      'Set-Cookie': cookie(SESSION_COOKIE, '', 0),
    },
  });
}

/**
 * Erase the account itself.
 *
 * Sessions are deleted explicitly rather than left to the ON DELETE CASCADE on
 * the foreign key: SQLite only enforces foreign keys when the connection asks
 * it to, so relying on the cascade here risks orphaned session rows that would
 * still authenticate against a user who no longer exists.
 *
 * Only the server half is removed here. Classes, grades and settings never left
 * the phone, so the client erases those itself — see eraseLocalData.
 */
export async function deleteAccount(request: Request, env: AuthEnv): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE);
  const cleared = {
    'content-type': 'application/json',
    'Set-Cookie': cookie(SESSION_COOKIE, '', 0),
  };

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'not signed in' }), {
      status: 401,
      headers: cleared,
    });
  }

  const hash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token_hash = ?1 AND expires > ?2',
  )
    .bind(hash, Date.now())
    .first<{ user_id: string }>();

  if (!row) {
    /*
      A cookie that matches no live session — expired, or simply wrong. The
      tempting answer is "ok, nothing to delete", but the client erases the
      phone's classes and grades on the strength of this reply. Reporting
      success for a deletion that did not happen would destroy that data while
      leaving the account alive: the exact opposite of what was asked for.
    */
    return new Response(JSON.stringify({ ok: false, error: 'session expired' }), {
      status: 401,
      headers: cleared,
    });
  }

  // Every session, not just this one: deleting the account has to sign out the
  // student's other devices too, or the account outlives its own deletion.
  await env.DB.batch([
    // Explicit, not left to ON DELETE CASCADE: SQLite only enforces foreign
    // keys when the connection asks it to, and a synced schedule outliving the
    // account it belongs to would make "delete everything" untrue.
    env.DB.prepare('DELETE FROM schedules WHERE user_id = ?1').bind(row.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(row.user_id),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(row.user_id),
  ]);

  return new Response(JSON.stringify({ ok: true }), { headers: cleared });
}

/** Expired sessions are dead weight; the daily housekeeping tick sweeps them. */
export async function pruneSessions(env: AuthEnv, nowMs: number): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE expires < ?1').bind(nowMs).run();
}
