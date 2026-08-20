import { afterEach, describe, expect, it, vi } from 'vitest';
import { installState, isIOS, isInstalled } from './install';

/**
 * The branch that matters most is iOS-not-installed: that's the one case where
 * turning a notification toggle on does literally nothing, so misdetecting it
 * means someone waits for alerts that were never going to arrive.
 */

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPAD_OS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';

function setEnv({
  ua,
  touchPoints = 0,
  standaloneDisplay = false,
  safariStandalone,
}: {
  ua: string;
  touchPoints?: number;
  standaloneDisplay?: boolean;
  safariStandalone?: boolean;
}) {
  vi.stubGlobal('navigator', {
    userAgent: ua,
    maxTouchPoints: touchPoints,
    ...(safariStandalone === undefined ? {} : { standalone: safariStandalone }),
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: standaloneDisplay }),
    navigator: {
      userAgent: ua,
      maxTouchPoints: touchPoints,
      ...(safariStandalone === undefined ? {} : { standalone: safariStandalone }),
    },
    addEventListener: () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('isIOS', () => {
  it('detects an iPhone', () => {
    setEnv({ ua: IPHONE });
    expect(isIOS()).toBe(true);
  });

  it('detects modern iPadOS, which pretends to be a Mac', () => {
    setEnv({ ua: IPAD_OS, touchPoints: 5 });
    expect(isIOS()).toBe(true);
  });

  it('does not mistake a real Mac for an iPad', () => {
    setEnv({ ua: MAC, touchPoints: 0 });
    expect(isIOS()).toBe(false);
  });

  it('does not flag Android', () => {
    setEnv({ ua: ANDROID, touchPoints: 5 });
    expect(isIOS()).toBe(false);
  });
});

describe('isInstalled', () => {
  it('is true when launched in standalone display mode', () => {
    setEnv({ ua: ANDROID, standaloneDisplay: true });
    expect(isInstalled()).toBe(true);
  });

  it("is true via Safari's own flag on iOS", () => {
    setEnv({ ua: IPHONE, safariStandalone: true });
    expect(isInstalled()).toBe(true);
  });

  it('is false in a plain browser tab', () => {
    setEnv({ ua: IPHONE, safariStandalone: false });
    expect(isInstalled()).toBe(false);
  });
});

describe('installState', () => {
  it('reports installed regardless of platform', () => {
    setEnv({ ua: IPHONE, safariStandalone: true });
    expect(installState()).toEqual({ kind: 'installed' });
  });

  it('falls back to instructions on an uninstalled iPhone', () => {
    // No beforeinstallprompt exists on iOS, so this must not be 'unavailable'
    // or the user gets no guidance and silently no notifications.
    setEnv({ ua: IPHONE, safariStandalone: false });
    expect(installState()).toEqual({ kind: 'ios' });
  });

  it('is unavailable on desktop with nothing on offer', () => {
    setEnv({ ua: MAC });
    expect(installState()).toEqual({ kind: 'unavailable' });
  });

  it('is unavailable on Android until Chrome offers the prompt', () => {
    // Chrome only fires beforeinstallprompt once its own criteria are met, so
    // an Android user can legitimately see nothing for a moment.
    setEnv({ ua: ANDROID });
    expect(installState()).toEqual({ kind: 'unavailable' });
  });
});
