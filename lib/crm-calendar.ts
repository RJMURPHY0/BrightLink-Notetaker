// The recorder's own calendar, read through BrightLink's CRM (2026-09-25).
//
// Calendar connections live in the CRM (api/calendar.ts there): one read-only
// Outlook or Google connection per person, used by both products. This app
// calls it from the browser with the person's own Supabase token (the two
// share one login), and the CRM allows this app's origins for that route.

import { createClient } from '@/lib/supabase/client';
import { CRM_ORIGIN } from '@/lib/embed-bridge';

export interface CalendarAttendee { email: string; name: string | null }
export interface CalendarEvent {
  id: string;
  provider: 'microsoft' | 'google';
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: CalendarAttendee[];
  organizer: CalendarAttendee | null;
  joinUrl: string | null;
  webLink: string | null;
  location: string | null;
}
export interface CalendarResult {
  connected: boolean;
  events: CalendarEvent[];
  reconnect: ('microsoft' | 'google')[];
  errors: string[];
}

/** A calendar read that failed. `status` 401/402/403/404 means the calendar is not available to this person at all. */
export class CalendarUnavailable extends Error {
  constructor(message: string, public status: number) { super(message); }
  get notForThisPerson(): boolean { return [401, 402, 403, 404].includes(this.status); }
}

export async function fetchCalendar(from: Date, to: Date): Promise<CalendarResult> {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');
  const url = `${CRM_ORIGIN}/api/calendar?action=events&from=${from.toISOString()}&to=${to.toISOString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new CalendarUnavailable((body as { error?: string }).error || `Calendar unavailable (${res.status})`, res.status);
  return body as CalendarResult;
}

/** The event a recording belongs to: the one running when it started (15 min grace either side), longest overlap first. */
export function eventForRecording(events: CalendarEvent[], recordedAt: Date): CalendarEvent | null {
  const t = recordedAt.getTime();
  const grace = 15 * 60_000;
  const hits = events
    .filter((e) => !e.allDay)
    .filter((e) => new Date(e.start).getTime() - grace <= t && t <= new Date(e.end).getTime() + grace);
  if (hits.length === 0) return null;
  // Closest start wins (a recording usually starts at, or just after, the meeting).
  return hits.sort((a, b) => Math.abs(new Date(a.start).getTime() - t) - Math.abs(new Date(b.start).getTime() - t))[0];
}

/** Where to connect a calendar (the CRM's Connections page). */
export const CONNECT_CALENDAR_URL = `${CRM_ORIGIN}/settings/connections`;
