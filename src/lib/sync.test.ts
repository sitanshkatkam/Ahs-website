import { describe, expect, it } from 'vitest';
import { pickSynced, touchesSchedule } from './sync';
import { DEFAULT_SETTINGS, type Settings } from './storage';

/**
 * Sync carries the schedule and nothing else. The test that matters most is
 * the negative one: grades must not travel. Keeping them on
 * the device is the reason the privacy page can still say a student's grades
 * never leave their phone, so a field quietly joining the synced set would
 * turn that sentence into a lie without anything visibly breaking.
 */

const full: Settings = {
  ...DEFAULT_SETTINGS,
  classes: [{ period: 1, name: 'AP Chemistry', teacher: 'Nguyen', room: '412' }],
  gradeLevel: 11,
  extraPeriods: [{ period: 0, enabled: true, start: '07:30', end: '08:25' }],
  customOverrides: [{ date: '2027-03-11', scheduleId: 'rally', label: 'Changed by you' }],
  grades: [{ period: 1, semester: 's1', letter: 'A' }],
  clubs: [{ id: 'c1', name: 'Robotics', frequency: 'weekly', weekday: 2, week: 1, room: '512' }],
  theme: 'dark',
};

describe('what syncs', () => {
  it('carries the schedule', () => {
    const out = pickSynced(full);
    expect(out.classes).toEqual(full.classes);
    expect(out.gradeLevel).toBe(11);
    expect(out.extraPeriods).toEqual(full.extraPeriods);
    expect(out.customOverrides).toEqual(full.customOverrides);
  });

  it('leaves grades on the device', () => {
    const out = pickSynced(full) as Record<string, unknown>;
    expect(out.grades).toBeUndefined();
  });

  it('leaves device preferences behind', () => {
    // Alerts on your phone but not on a school Chromebook, and a theme chosen
    // for one screen shouldn't follow you to another.
    const out = pickSynced(full) as Record<string, unknown>;
    expect(out.theme).toBeUndefined();
    expect(out.notifications).toBeUndefined();
    expect(out.tourSeen).toBeUndefined();
    expect(out.installDismissed).toBeUndefined();
  });

  it('sends exactly these keys, so nothing joins by accident', () => {
    // This list is the privacy promise in code form. Anything added here has to
    // be a deliberate decision, and has to be reflected on the privacy page.
    expect(Object.keys(pickSynced(full)).sort()).toEqual([
      'classes',
      'clubs',
      'customOverrides',
      'extraPeriods',
      'gradeLevel',
    ]);
  });

  it('carries clubs, which are schedule rather than secret', () => {
    expect(pickSynced(full).clubs).toEqual(full.clubs);
    expect(touchesSchedule({ clubs: [] })).toBe(true);
  });
});

describe('touchesSchedule', () => {
  it('is true for schedule edits', () => {
    expect(touchesSchedule({ classes: [] })).toBe(true);
    expect(touchesSchedule({ gradeLevel: 12 })).toBe(true);
    expect(touchesSchedule({ extraPeriods: [] })).toBe(true);
    expect(touchesSchedule({ customOverrides: [] })).toBe(true);
  });

  it('is false for everything else, so a theme flip costs no upload', () => {
    expect(touchesSchedule({ theme: 'dark' })).toBe(false);
    expect(touchesSchedule({ grades: [] })).toBe(false);
    expect(touchesSchedule({ tourSeen: true })).toBe(false);
    expect(touchesSchedule({})).toBe(false);
  });

  it('notices a schedule key even when set to undefined', () => {
    // Clearing your grade level is still a change worth syncing.
    expect(touchesSchedule({ gradeLevel: undefined })).toBe(true);
  });
});
