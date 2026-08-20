import { describe, expect, it } from 'vitest';
import { countdownParts, formatCountdown } from './date';

describe('countdown display', () => {
  it('shows whole minutes above the five-minute mark', () => {
    expect(countdownParts(47 * 60 + 30)).toEqual({ value: '47', unit: 'min' });
    expect(countdownParts(6 * 60)).toEqual({ value: '6', unit: 'min' });
  });

  it('hands over to seconds exactly at five minutes', () => {
    // 5:00 is still minutes-only; one second later the seconds appear.
    expect(countdownParts(300)).toEqual({ value: '5', unit: 'min' });
    expect(countdownParts(299)).toEqual({ value: '4:59', unit: null });
  });

  it('keeps m:ss under a minute rather than dropping the minute digit', () => {
    expect(countdownParts(45)).toEqual({ value: '0:45', unit: null });
    expect(countdownParts(0)).toEqual({ value: '0:00', unit: null });
    expect(countdownParts(-5)).toEqual({ value: '0:00', unit: null });
  });

  it('compacts long waits to hours and minutes', () => {
    expect(countdownParts(3600 + 12 * 60)).toEqual({ value: '1h 12m', unit: null });
    expect(countdownParts(3600)).toEqual({ value: '1h 0m', unit: null });
  });

  it('never shows a seconds digit above the threshold', () => {
    // Every value in a full period's worth of seconds, spot-checked for ":".
    for (let s = 300; s < 3600; s += 7) {
      expect(countdownParts(s).value).not.toContain(':');
    }
  });

  it('joins to a single string for plain-text callers', () => {
    expect(formatCountdown(47 * 60)).toBe('47 min');
    expect(formatCountdown(90)).toBe('1:30');
  });
});
