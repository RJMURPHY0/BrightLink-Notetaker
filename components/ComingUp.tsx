'use client';

// "Coming up" (2026-09-25): the next few meetings in the person's own
// calendar, read-only through BrightLink's CRM (lib/crm-calendar.ts). One tap
// joins the call; another opens the recorder. Nothing shows when there is
// nothing booked; outside BrightLink, a person with no calendar connected gets
// one line saying where to connect it.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Mic, Video } from 'lucide-react';
import { CalendarUnavailable, CONNECT_CALENDAR_URL, fetchCalendar, type CalendarEvent, type CalendarResult } from '@/lib/crm-calendar';
import { isEmbedded } from '@/lib/embed-bridge';

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (same(d, today)) return `Today ${time}`;
  if (same(d, tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export default function ComingUp({ load = fetchCalendar }: { load?: (from: Date, to: Date) => Promise<CalendarResult> }) {
  const [state, setState] = useState<{ events: CalendarEvent[]; connected: boolean } | null>(null);
  const [error, setError] = useState('');
  const [embedded, setEmbedded] = useState(true);

  useEffect(() => {
    setEmbedded(isEmbedded());
    let cancelled = false;
    const from = new Date(Date.now() - 30 * 60_000);
    load(from, new Date(Date.now() + 7 * 86_400_000))
      .then((r) => {
        if (cancelled) return;
        if (r.reconnect.length) setError('Your calendar needs reconnecting in BrightLink → Settings → Connections.');
        const now = Date.now();
        setState({
          connected: r.connected,
          events: r.events.filter((e) => !e.allDay && new Date(e.end).getTime() > now).slice(0, 3),
        });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // No calendar route for this person (no CRM access, not deployed): the strip simply is not here.
        if (e instanceof CalendarUnavailable && e.notForThisPerson) return;
        setError(`Couldn't read your calendar: ${e.message}`);
      });
    return () => { cancelled = true; };
  }, [load]);

  if (error) return <p className="mb-4 text-[11px] text-ftc-mid">{error}</p>;
  if (!state) return null;
  if (!state.connected) {
    if (embedded) return null;
    return (
      <p className="mb-4 text-xs text-ftc-mid flex items-center gap-1.5">
        <CalendarDays className="w-3.5 h-3.5 text-brand" />
        <a href={CONNECT_CALENDAR_URL} target="_blank" rel="noreferrer" className="hover:text-ftc-gray underline-offset-2 hover:underline">
          Connect your calendar
        </a>
        <span>to see what’s coming up.</span>
      </p>
    );
  }
  if (state.events.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Coming up">
      <p className="text-xs font-semibold uppercase tracking-widest text-ftc-mid flex items-center gap-2 mb-2">
        <CalendarDays className="w-3.5 h-3.5 text-brand" /> Coming up
      </p>
      <ul className="grid gap-2 sm:grid-cols-3">
        {state.events.map((e) => (
          <li key={`${e.provider}:${e.id}`} className="rounded-2xl border border-surface-border bg-surface-card p-3 flex flex-col gap-2 min-w-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ftc-gray truncate">{e.title}</p>
              <p className="text-xs text-ftc-mid">
                {when(e.start)}{e.attendees.length > 0 ? ` · ${e.attendees.length} invited` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 mt-auto">
              {e.joinUrl && (
                <a href={e.joinUrl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-border px-2.5 py-1 text-xs text-ftc-gray hover:border-brand/50 touch-manipulation">
                  <Video className="w-3.5 h-3.5" /> Join
                </a>
              )}
              <Link href="/record"
                className="inline-flex items-center gap-1 rounded-lg bg-brand/10 text-brand px-2.5 py-1 text-xs font-medium hover:bg-brand/20 touch-manipulation">
                <Mic className="w-3.5 h-3.5" /> Record
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
