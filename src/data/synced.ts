/**
 * Data pulled from American High's public Google Calendar by
 * `npm run sync:calendar` (see scripts/sync-calendar.mjs), refreshed nightly
 * by .github/workflows/sync-calendar.yml.
 *
 * This is a *supplement*. The hand-verified data in calendar.ts always wins:
 * the feed has carried at least one flat error, and it omits several no-school
 * days. Synced schedule days only fill dates calendar.ts doesn't already pin.
 */

import raw from './synced.json';
import type { EventCategory } from './calendar';
import type { ScheduleId } from './schedules';

export type SyncedSchedule = { date: string; scheduleId: ScheduleId };

export type SyncedEvent = {
  date: string;
  endDate?: string;
  title: string;
  category: EventCategory;
  time?: string;
  location?: string;
};

export type SyncedData = {
  generatedAt: string;
  source: string;
  schoolYear: string;
  scheduleOverrides: SyncedSchedule[];
  events: SyncedEvent[];
};

export const SYNCED = raw as SyncedData;
