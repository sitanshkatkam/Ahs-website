import { describe, expect, it } from 'vitest';
import { authConfigured, readIdToken, startAuth, type AuthEnv } from './auth';

/**
 * Auth fails in a specific and nasty way: it fails *open*. A schedule bug shows
 * a wrong time and somebody notices; a token check that accepts the wrong
 * `aud`, or a missing `state`, lets one person end up signed in as another and
 * nothing looks broken at all. So these test the rejections, not the happy path.
 */

const CLIENT_ID = '123456789.apps.googleusercontent.com';

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const token = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'RS256' })}.${b64url(claims)}.signature-not-checked-on-this-path`;

const valid = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '110000000000000000001',
  email: 'student@example.com',
  email_verified: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
  name: 'A Student',
  ...over,
});

const env: AuthEnv = {
  DB: {} as D1Database,
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-secret',
};

describe('authConfigured', () => {
  it('is off until both keys exist, so nothing half-works', () => {
    expect(authConfigured({ DB: {} as D1Database })).toBe(false);
    expect(authConfigured({ ...env, GOOGLE_CLIENT_SECRET: undefined })).toBe(false);
    expect(authConfigured({ ...env, GOOGLE_CLIENT_ID: '' })).toBe(false);
    expect(authConfigured(env)).toBe(true);
  });
});

describe('readIdToken', () => {
  it('accepts a well-formed Google token', () => {
    expect(readIdToken(token(valid()), CLIENT_ID)).toEqual({
      sub: '110000000000000000001',
      email: 'student@example.com',
      name: 'A Student',
      picture: undefined,
    });
  });

  it('accepts the bare issuer Google also uses', () => {
    expect(readIdToken(token(valid({ iss: 'accounts.google.com' })), CLIENT_ID)).not.toBeNull();
  });

  it('rejects a token minted for a different app', () => {
    // The one that matters most. Without this check, a token from any other
    // Google app would sign someone in here.
    expect(readIdToken(token(valid({ aud: 'someone-elses-app' })), CLIENT_ID)).toBeNull();
  });

  it('rejects a token from the wrong issuer', () => {
    expect(readIdToken(token(valid({ iss: 'https://evil.example' })), CLIENT_ID)).toBeNull();
  });

  it('rejects an expired token', () => {
    expect(
      readIdToken(token(valid({ exp: Math.floor(Date.now() / 1000) - 60 })), CLIENT_ID),
    ).toBeNull();
  });

  it('rejects an unverified email address', () => {
    expect(readIdToken(token(valid({ email_verified: false })), CLIENT_ID)).toBeNull();
  });

  it('rejects tokens missing the claims we key on', () => {
    expect(readIdToken(token(valid({ sub: undefined })), CLIENT_ID)).toBeNull();
    expect(readIdToken(token(valid({ email: undefined })), CLIENT_ID)).toBeNull();
    expect(readIdToken(token(valid({ exp: 'soon' })), CLIENT_ID)).toBeNull();
  });

  it('rejects malformed input instead of throwing', () => {
    expect(readIdToken(undefined, CLIENT_ID)).toBeNull();
    expect(readIdToken('', CLIENT_ID)).toBeNull();
    expect(readIdToken('not.a.jwt', CLIENT_ID)).toBeNull();
    expect(readIdToken('only-one-part', CLIENT_ID)).toBeNull();
  });
});

describe('startAuth', () => {
  const start = () =>
    startAuth(new Request('https://ahs.example/api/auth/google/start'), env);

  it('sends the student to Google with the parameters that keep this safe', async () => {
    const res = await start();
    expect(res.status).toBe(302);

    const to = new URL(res.headers.get('Location')!);
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(to.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(to.searchParams.get('response_type')).toBe('code');
    expect(to.searchParams.get('redirect_uri')).toBe(
      'https://ahs.example/api/auth/google/callback',
    );
    // PKCE, and the challenge must be the hash rather than the verifier.
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(to.searchParams.get('state')).toMatch(/^[\w-]{43}$/);
  });

  it('asks for no more than it needs', async () => {
    const to = new URL((await start()).headers.get('Location')!);
    expect(to.searchParams.get('scope')).toBe('openid email profile');
    // No offline access: the app never acts for a student who isn't there, so
    // there is no refresh token worth holding on to.
    expect(to.searchParams.get('access_type')).toBe('online');
  });

  it('stores the pending login in a cookie script cannot touch', async () => {
    const setCookie = (await start()).headers.get('Set-Cookie')!;
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('never lets the verifier itself reach the browser or Google', async () => {
    // Google gets the hash; the browser gets a signed blob. If the raw verifier
    // appeared in either, PKCE would be decorative.
    const res = await start();
    const location = res.headers.get('Location')!;
    const setCookie = res.headers.get('Set-Cookie')!;

    const challenge = new URL(location).searchParams.get('code_challenge')!;
    expect(setCookie).not.toContain(challenge);
    expect(location).not.toContain('code_verifier');
  });

  it('issues a fresh state and verifier every time', async () => {
    const a = new URL((await start()).headers.get('Location')!);
    const b = new URL((await start()).headers.get('Location')!);
    expect(a.searchParams.get('state')).not.toBe(b.searchParams.get('state'));
    expect(a.searchParams.get('code_challenge')).not.toBe(b.searchParams.get('code_challenge'));
  });
});
