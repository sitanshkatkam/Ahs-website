import { describe, expect, it } from 'vitest';
import { isEditing } from './appUpdate';
import { RESUME_EVENTS } from './resume';

/**
 * Updates reach an installed PWA by reloading the page under the student. That
 * is normally free — settings are written to localStorage as they change — with
 * one exception worth protecting: text that only exists in React state. The
 * onboarding screen holds a grade and six class names until "Done" is pressed,
 * and a first-run student is exactly who is most likely to be on a stale build
 * when an update lands. Reloading mid-typing would look like the app deleting
 * their work.
 */

const el = (tag: string, editable = false): Element => {
  const node = { tagName: tag, isContentEditable: editable };
  return node as unknown as Element;
};

describe('isEditing', () => {
  it('holds a reload back while a field has focus', () => {
    expect(isEditing(el('INPUT'))).toBe(true);
    expect(isEditing(el('TEXTAREA'))).toBe(true);
    expect(isEditing(el('SELECT'))).toBe(true);
  });

  it('covers contenteditable, which is not a form tag', () => {
    expect(isEditing(el('DIV', true))).toBe(true);
    expect(isEditing(el('DIV', false))).toBe(false);
  });

  it('does not hold a reload back for ordinary focus', () => {
    // A focused button is the common case after any tap, and blocking on it
    // would defer updates almost permanently.
    expect(isEditing(el('BUTTON'))).toBe(false);
    expect(isEditing(el('A'))).toBe(false);
    expect(isEditing(el('BODY'))).toBe(false);
  });

  it('treats nothing focused as safe', () => {
    expect(isEditing(null)).toBe(false);
  });
});

describe('resume signals', () => {
  it('listens for more than visibilitychange', () => {
    // The whole bug: checking only on visibilitychange meant an installed PWA
    // resumed from a frozen state never looked for a new version, because the
    // launch code does not re-run and the poll timer was suspended with it.
    expect(RESUME_EVENTS).toContain('visibilitychange');
    expect(RESUME_EVENTS).toContain('pageshow');
    expect(RESUME_EVENTS).toContain('focus');
    expect(RESUME_EVENTS.length).toBeGreaterThanOrEqual(4);
  });

  it('is one shared list, so the clock and the updater cannot drift apart', async () => {
    const fromClock = (await import('./useNow')).RESUME_EVENTS;
    expect(fromClock).toBe(RESUME_EVENTS);
  });
});
