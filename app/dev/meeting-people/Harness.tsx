'use client';

// ?state=new|done|skipped|shared, ?voice=<text> simulates the mic result.
import { useEffect, useState } from 'react';
import MeetingPeopleCard, { type PeopleRpcClient } from '@/app/recordings/[id]/MeetingPeopleCard';
import ComingUp from '@/components/ComingUp';
import MeetingPeopleButton from '@/components/MeetingPeopleButton';
import type { CalendarResult } from '@/lib/crm-calendar';

type P = { kind: 'member' | 'contact'; id: string; name: string; email?: string; avatar_url?: string | null; company?: string | null; subtitle?: string | null; first_name?: string; last_name?: string };
const m = (id: string, name: string): P => ({ kind: 'member', id, name, email: `${name.toLowerCase().replace(' ', '.')}@ftc-ss.com`, avatar_url: null, subtitle: null });
const c = (id: string, first: string, last: string, company: string, title: string, photo = false): P => ({
  kind: 'contact', id, name: `${first} ${last}`, first_name: first, last_name: last, company,
  subtitle: `${title} · ${company}`, avatar_url: photo ? '/icon-192.png' : null, email: `${first.toLowerCase()}@${company.toLowerCase().replace(/\s+/g, '')}.co.uk`,
});
const TEAM = [m('u1', 'Milly Moss'), m('u2', 'John Powney'), m('u3', 'Lee Brookes'), m('u4', 'Leslie Lee'), m('u5', 'Sean Hamill'), m('u6', 'Corey Morgan'), m('u7', 'Jason Griffin')];
const CONTACTS = [
  c('c1', 'Lee', 'Eddleston', 'Wincanton', 'Operations Manager', true), c('c2', 'Lee', 'Reed', 'GXO Logistics', 'Operations Manager', true),
  c('c3', 'Dave', 'Smith', 'Kridan Handling', 'Director'), c('c4', 'John', 'Hill', 'DHL', 'Site Lead'), c('c5', 'Sarah', 'Smith', 'Kridan Handling', 'Parts Coordinator'),
];

function makeClient(): PeopleRpcClient {
  const params = new URLSearchParams(location.search);
  const state = params.get('state') ?? 'new';
  let people: P[] = state === 'done' || state === 'shared' ? [TEAM[0], CONTACTS[0]] : [];
  let status: string | null = state === 'done' ? 'done' : state === 'skipped' ? 'skipped' : null;
  const loaded = () => ({ access: state === 'shared' ? 'shared' : 'full', state: status, people, heard: ['Ryan Murphy', 'Milly', 'Dave Smith'] });
  const match = (name: string, company?: string | null) => {
    const [first, ...rest] = name.toLowerCase().split(' ');
    const last = rest.join(' ');
    const team = company ? [] : TEAM.filter((t) => { const [f, ...l] = t.name.toLowerCase().split(' '); return f === first && (!last || l.join(' ').startsWith(last)); });
    const contacts = CONTACTS.filter((x) => x.first_name!.toLowerCase() === first && (!last || x.last_name!.toLowerCase().startsWith(last)) && (!company || x.company!.toLowerCase().includes(company.toLowerCase())));
    return { name, company: company ?? null, team, contacts, contacts_total: contacts.length };
  };
  return {
    rpc: async (fn, args) => {
      await new Promise((r) => setTimeout(r, 200));
      switch (fn) {
        case 'meeting_people_get': return { data: loaded(), error: null };
        case 'meeting_people_search': {
          const q = String(args.p_query ?? '').toLowerCase().trim();
          const words = q ? q.split(/\s+/) : [];
          const hit = (p: P) => words.every((w) => `${p.name} ${p.email ?? ''} ${p.company ?? ''}`.toLowerCase().includes(w));
          const team = TEAM.filter(hit);
          const contacts = q.length >= 2 ? CONTACTS.filter(hit) : [];
          return { data: { team, team_total: team.length, contacts, contacts_total: contacts.length, contacts_capped: false }, error: null };
        }
        case 'meeting_people_match': {
          const names = args.p_names as { name: string; company?: string | null }[];
          return { data: names.map((n) => match(n.name, n.company)), error: null };
        }
        case 'meeting_people_set': {
          const add = args.p_add as { kind: string; id: string }[];
          const remove = args.p_remove as { kind: string; id: string }[];
          people = people.filter((p) => !remove.some((r) => r.id === p.id));
          for (const a of add) { const p = [...TEAM, ...CONTACTS].find((x) => x.id === a.id); if (p && !people.some((x) => x.id === p.id)) people.push(p); }
          status = people.length ? 'done' : status;
          return { data: loaded(), error: null };
        }
        case 'meeting_people_match_emails': {
          const emails = args.p_emails as string[];
          return { data: emails.filter((e) => !e.startsWith('ryan.murphy')).map((email) => ({
            email, person: [...TEAM, ...CONTACTS].find((p) => p.email === email) ?? null,
          })), error: null };
        }
        case 'meeting_link_skip': status = args.p_skip ? 'skipped' : null; return { data: loaded(), error: null };
        case 'meeting_people_create_contact': {
          const p = c(`n${Date.now()}`, String(args.p_first), String(args.p_last ?? ''), String(args.p_company ?? ''), 'New');
          CONTACTS.push(p); people.push(p); status = 'done';
          return { data: loaded(), error: null };
        }
      }
      return { data: null, error: { message: `unmocked ${fn}` } };
    },
  };
}

// ?calendar=none|off. The recording "started" at 14:40 today; the invite ran 14:30-15:30.
const REC_AT = (() => { const d = new Date(); d.setHours(14, 40, 0, 0); return d.toISOString(); })();
const at = (days: number, h: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString(); };
async function fakeCalendar(): Promise<CalendarResult> {
  await new Promise((r) => setTimeout(r, 300));
  const mode = new URLSearchParams(location.search).get('calendar');
  if (mode === 'none') return { connected: false, events: [], reconnect: [], errors: [] };
  return { connected: true, reconnect: [], errors: [], events: [
    { id: 'e0', provider: 'microsoft', title: 'Sales Performance Discussion', start: at(0, 14, 30), end: at(0, 15, 30), allDay: false,
      attendees: [
        { email: 'milly.moss@ftc-ss.com', name: 'Milly Moss' }, { email: 'john.powney@ftc-ss.com', name: 'John Powney' },
        { email: 'lee@wincanton.co.uk', name: 'Lee Eddleston' }, { email: 'priya.shah@kridan.co.uk', name: 'Priya Shah' },
      ], organizer: { email: 'ryan.murphy@ftc-ss.com', name: 'Ryan Murphy' }, joinUrl: null, webLink: null, location: null },
    { id: 'e1', provider: 'microsoft', title: 'Sentinel quote walkthrough', start: at(1, 13), end: at(1, 13, 30), allDay: false,
      attendees: [{ email: 'lee@wincanton.co.uk', name: 'Lee Eddleston' }], organizer: null, joinUrl: 'https://teams.microsoft.com/l/x', webLink: null, location: null },
    { id: 'e2', provider: 'google', title: 'Weekly sales stand-up', start: at(2, 9), end: at(2, 9, 15), allDay: false,
      attendees: [{ email: 'milly.moss@ftc-ss.com', name: null }, { email: 'john.powney@ftc-ss.com', name: null }], organizer: null, joinUrl: 'https://meet.google.com/x', webLink: null, location: null },
  ] };
}

export default function Harness() {
  const [client, setClient] = useState<PeopleRpcClient | null>(null);
  useEffect(() => setClient(makeClient()), []);
  return (
    <div className="min-h-screen bg-surface">
      {/* Stand-in for the recording page's header bar, where the button lives. */}
      <header className="sticky top-0 z-20 border-b border-surface-border bg-surface/80 backdrop-blur-md">
        <div className="max-w-[1100px] mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ftc-gray truncate">Sales Performance Discussion</p>
            <p className="text-xs text-ftc-mid">Harness · 24 Sept 2026</p>
          </div>
          {client && (
            <MeetingPeopleCard
              recordingId="rec-harness" client={client} recordedAt={REC_AT}
              calendarFetch={new URLSearchParams(location.search).get('calendar') === 'off' ? undefined : fakeCalendar}
              devSpeak={new URLSearchParams(location.search).get('voice') ?? undefined}
            />
          )}
          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-500/10 text-emerald-400">completed</span>
        </div>
      </header>
      <div className="max-w-[1100px] mx-auto p-4">
        {client && <ComingUp load={fakeCalendar} />}
        {/* Stand-in for a recordings-list row: the people icon sits above folder and bin. */}
        {client && (
          <div className="relative mb-4 rounded-2xl border border-surface-border bg-surface-card p-5 pr-20" data-harness-row>
            <p className="text-sm font-semibold text-ftc-gray">Email System Workflow Discussion</p>
            <p className="text-xs text-ftc-mid mt-1">24 Sept 2026, 14:49 · 37m</p>
            <div className="absolute top-1/2 right-3 -translate-y-1/2 flex flex-col gap-1 items-center">
              <MeetingPeopleButton recordingId="rec-harness" client={client} needsPeople />
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-surface-border bg-surface-card p-6 text-sm text-ftc-mid h-[600px]">AI notes</div>
      </div>
    </div>
  );
}
