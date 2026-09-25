'use client';

// "Who was in this meeting?" (2026-09-25)
//
// Shown at the top of a recording straight after Stop, while the meeting is
// still processing, so the wait is used rather than blocked. The person who
// recorded it links the people who were there:
//   - colleagues (Your team): the meeting is then shared with them, read-only;
//   - CRM contacts: the meeting then shows on their record's Meetings tab;
//   - someone new: added as a contact on the spot.
// One search covers both (All / Your team / Contacts), and the mic takes
// "Milly, John and Lee were in this meeting": a colleague who is the only one
// with that first name is picked at once; anyone ambiguous gets a choice.
// Every pick saves as it is made. Skip means never ask again for this meeting.
//
// All reads and writes are the CRM's SECURITY DEFINER RPCs (migration
// 20260925092301_meeting_people.sql), called as the signed-in user, which
// apply the same access rule as canAccessRecording plus the CRM's contacts
// permissions. Names heard in the call only ever SUGGEST; nothing links itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, Loader2, Mic, Search, UserPlus, Users, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { parseSpokenNames, splitName, type SpokenName } from '@/lib/spoken-names';
import { openCrmContact } from '@/lib/embed-bridge';
import { CalendarUnavailable, eventForRecording, fetchCalendar, type CalendarEvent, type CalendarResult } from '@/lib/crm-calendar';

type Kind = 'member' | 'contact';
interface Person {
  kind: Kind;
  id: string;
  name: string | null;
  email?: string | null;
  avatar_url?: string | null;
  company?: string | null;
  subtitle?: string | null;
  method?: string;
}
interface Loaded {
  access: 'full' | 'shared' | null;
  state: 'done' | 'skipped' | null;
  people: Person[];
  heard: string[];
}
interface SearchResult {
  team: Person[];
  team_total: number;
  contacts: Person[];
  contacts_total: number;
  contacts_capped: boolean;
}
interface MatchRow {
  name: string;
  company: string | null;
  team: Person[];
  contacts: Person[];
  contacts_total: number;
}
type Tab = 'all' | 'team' | 'contacts';

const keyOf = (p: { kind: Kind; id: string }) => `${p.kind}:${p.id}`;
const displayName = (p: Person) => p.name || p.email || 'Unnamed';

// ─── Avatar: the photo when there is one, else coloured initials ────────────

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
function hue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
function Avatar({ person, size = 32 }: { person: Person; size?: number }) {
  const [failed, setFailed] = useState(false);
  const name = displayName(person);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (person.avatar_url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatar_url}
        alt=""
        onError={() => setFailed(true)}
        className="rounded-full object-cover flex-shrink-0 bg-surface-raised"
        style={style}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0"
      style={{ ...style, background: `hsl(${hue(person.id)} 45% 42%)` }}
    >
      {initials(name)}
    </span>
  );
}

function TeamBadge() {
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-brand/10 text-brand flex-shrink-0">Team</span>
  );
}

// ─── Speech (Chrome, Edge, Safari) ───────────────────────────────────────────

type SR = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null;
  start: () => void; stop: () => void;
};
function speechCtor(): (new () => SR) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ─── The card ────────────────────────────────────────────────────────────────

/** The one thing the card needs from Supabase; the dev harness passes a stand-in. */
export type PeopleRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export default function MeetingPeopleCard({ recordingId, recordedAt, client, devSpeak, calendarFetch }: {
  recordingId: string;
  /** When the recording started: finds the calendar event it belongs to. */
  recordedAt?: string;
  client?: PeopleRpcClient;
  /** Dev harness only: act as if this was said into the mic once loaded. */
  devSpeak?: string;
  /** Dev harness only: a stand-in for the CRM calendar read. */
  calendarFetch?: (from: Date, to: Date) => Promise<CalendarResult>;
}) {
  const supabase = useMemo<PeopleRpcClient>(() => client ?? (createClient() as unknown as PeopleRpcClient), [client]);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [saving, setSaving] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [suggestions, setSuggestions] = useState<Person[]>([]);
  const [choices, setChoices] = useState<MatchRow[]>([]);
  const [unmatched, setUnmatched] = useState<SpokenName[]>([]);
  const [creating, setCreating] = useState<{ first: string; last: string; company: string; email: string } | null>(null);
  // The calendar event this recording belongs to, and who it invited.
  const [invite, setInvite] = useState<{ event: CalendarEvent; people: { email: string; name: string | null; person: Person | null }[] } | null>(null);
  const [calendarNote, setCalendarNote] = useState('');
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [voiceNote, setVoiceNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const srRef = useRef<SR | null>(null);
  const searchSeq = useRef(0);
  const canSpeak = typeof window !== 'undefined' && !!speechCtor();

  const picked = useMemo(() => new Set((data?.people ?? []).map(keyOf)), [data]);

  // ── Load ──
  const load = useCallback(async () => {
    const { data: res, error } = await supabase.rpc('meeting_people_get', { p_recording_id: recordingId });
    if (error) { setLoadError('Couldn’t load who was in this meeting.'); return; }
    const d = res as Loaded;
    setData(d);
    if (d.access === 'full' && !d.state && d.people.length === 0) setExpanded(true);
  }, [supabase, recordingId]);
  useEffect(() => { void load(); }, [load]);

  // Names heard in the call become one-tap suggestions when they point at one
  // person. They never link on their own.
  useEffect(() => {
    if (!data || data.access !== 'full' || data.heard.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data: rows } = await supabase.rpc('meeting_people_match', {
        p_recording_id: recordingId,
        p_names: data.heard.slice(0, 12).map((name) => ({ name })),
      });
      if (cancelled || !Array.isArray(rows)) return;
      const out: Person[] = [];
      for (const r of rows as MatchRow[]) {
        const one = r.team.length === 1 ? r.team[0]
          : r.team.length === 0 && r.contacts_total === 1 && r.name.includes(' ') ? r.contacts[0] : null;
        if (one && !out.some((p) => keyOf(p) === keyOf(one))) out.push(one);
      }
      setSuggestions(out);
    })();
    return () => { cancelled = true; };
  }, [data?.access, data?.heard, supabase, recordingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Invitees of the calendar event this recording ran during. Offered with one
  // tap ("Add all"); never linked on their own, because invited is not attended.
  useEffect(() => {
    if (!data || data.access !== 'full' || !recordedAt) return;
    const at = new Date(recordedAt);
    if (Number.isNaN(at.getTime())) return;
    let cancelled = false;
    (async () => {
      let result: CalendarResult;
      try {
        result = await (calendarFetch ?? fetchCalendar)(new Date(at.getTime() - 3 * 3600_000), new Date(at.getTime() + 3 * 3600_000));
      } catch (e) {
        if (!cancelled && !(e instanceof CalendarUnavailable && e.notForThisPerson)) setCalendarNote(`Couldn't read your calendar: ${(e as Error).message}`);
        return;
      }
      if (cancelled || !result.connected) return;
      if (result.reconnect.length) { setCalendarNote('Your calendar needs reconnecting in BrightLink → Settings → Connections.'); return; }
      const event = eventForRecording(result.events, at);
      if (!event) return;
      const invited = [...event.attendees, ...(event.organizer ? [event.organizer] : [])];
      const emails = Array.from(new Set(invited.map((a) => a.email)));
      if (emails.length === 0) return;
      const { data: rows, error } = await supabase.rpc('meeting_people_match_emails', { p_recording_id: recordingId, p_emails: emails });
      if (cancelled) return;
      if (error || !Array.isArray(rows)) { setCalendarNote('Couldn’t match the invite to your contacts.'); return; }
      const nameOf = (email: string) => invited.find((a) => a.email === email)?.name ?? null;
      setInvite({
        event,
        people: (rows as { email: string; person: Person | null }[]).map((r) => ({ email: r.email, name: nameOf(r.email), person: r.person })),
      });
    })();
    return () => { cancelled = true; };
  }, [data?.access, recordedAt, supabase, recordingId, calendarFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search (debounced; always both groups so the tabs can count) ──
  useEffect(() => {
    if (!expanded) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data: res, error } = await supabase.rpc('meeting_people_search', {
        p_recording_id: recordingId, p_query: query, p_scope: 'all', p_limit: 12,
      });
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (error) { setSaveError('Search failed. Try again.'); return; }
      setResults(res as SearchResult);
      setHighlight(0);
    }, query ? 180 : 0);
    return () => clearTimeout(t);
  }, [query, expanded, supabase, recordingId]);

  // ── Save (each pick on its own) ──
  const apply = useCallback(async (add: Person[], remove: Person[] = [], method = 'search') => {
    if (add.length === 0 && remove.length === 0) return;
    // Optimistic: the chip appears at once.
    setData((d) => d && {
      ...d,
      people: [
        ...d.people.filter((p) => !remove.some((r) => keyOf(r) === keyOf(p))),
        ...add.filter((a) => !d.people.some((p) => keyOf(p) === keyOf(a))),
      ],
    });
    setSaving((n) => n + 1);
    setSaveError('');
    const { data: res, error } = await supabase.rpc('meeting_people_set', {
      p_recording_id: recordingId,
      p_add: add.map((p) => ({ kind: p.kind, id: p.id, method })),
      p_remove: remove.map((p) => ({ kind: p.kind, id: p.id })),
    });
    setSaving((n) => n - 1);
    if (error) {
      setSaveError('Couldn’t save that change. Try again.');
      void load();
      return;
    }
    setData(res as Loaded);
  }, [supabase, recordingId, load]);

  const toggle = (p: Person) => (picked.has(keyOf(p)) ? apply([], [p]) : apply([p]));

  const skip = async () => {
    setSaveError('');
    const { data: res, error } = await supabase.rpc('meeting_link_skip', { p_recording_id: recordingId, p_skip: true });
    if (error) { setSaveError('Couldn’t save that. Try again.'); return; }
    setData(res as Loaded);
    setExpanded(false);
  };

  const reopen = async () => {
    setExpanded(true);
    if (data?.state === 'skipped') {
      const { data: res } = await supabase.rpc('meeting_link_skip', { p_recording_id: recordingId, p_skip: false });
      if (res) setData(res as Loaded);
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // ── New contact ──
  const startCreate = (name: string, company?: string, email?: string) => {
    const { first, last } = splitName(name);
    setCreating({ first, last, company: company ?? '', email: email ?? '' });
  };
  const create = async () => {
    if (!creating || !creating.first.trim()) return;
    setSaving((n) => n + 1);
    setSaveError('');
    const { data: res, error } = await supabase.rpc('meeting_people_create_contact', {
      p_recording_id: recordingId,
      p_first: creating.first, p_last: creating.last || null,
      p_email: creating.email || null, p_company: creating.company || null,
    });
    setSaving((n) => n - 1);
    if (error) { setSaveError(error.message?.includes('email') ? 'That email address doesn’t look right.' : 'Couldn’t add that contact. Try again.'); return; }
    const name = `${creating.first} ${creating.last}`.trim().toLowerCase();
    setData(res as Loaded);
    setCreating(null);
    setQuery('');
    setUnmatched((u) => u.filter((n) => n.name.toLowerCase() !== name));
    // An invitee added as a new contact is no longer "not in the CRM".
    if (creating.email) {
      const email = creating.email.trim().toLowerCase();
      setInvite((iv) => iv && { ...iv, people: iv.people.filter((p) => p.email !== email) });
    }
  };

  // ── Voice ──
  const resolveSpoken = useCallback(async (spoken: SpokenName[]) => {
    if (spoken.length === 0) { setVoiceNote('Didn’t catch any names. Try again, or type them.'); return; }
    setVoiceNote('');
    const { data: rows, error } = await supabase.rpc('meeting_people_match', {
      p_recording_id: recordingId,
      p_names: spoken.map((s) => ({ name: s.name, company: s.company ?? null })),
    });
    if (error || !Array.isArray(rows)) { setSaveError('Couldn’t match those names. Try again.'); return; }
    const sure: Person[] = [];
    const ask: MatchRow[] = [];
    const none: SpokenName[] = [];
    (rows as MatchRow[]).forEach((r, i) => {
      const certainContact = r.team.length === 0 && r.contacts_total === 1 && (r.name.includes(' ') || !!r.company);
      if (r.team.length === 1) sure.push(r.team[0]);
      else if (certainContact) sure.push(r.contacts[0]);
      else if (r.team.length + r.contacts.length > 0) ask.push(r);
      else none.push(spoken[i]);
    });
    if (sure.length) await apply(sure, [], 'voice');
    setChoices(ask);
    setUnmatched(none);
  }, [supabase, recordingId, apply]);

  const toggleMic = () => {
    if (listening) { srRef.current?.stop(); return; }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const sr = new Ctor();
    sr.lang = navigator.language || 'en-GB';
    sr.interimResults = true;
    sr.continuous = false;
    let finalText = '';
    sr.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else live += r[0].transcript;
      }
      setInterim((finalText + live).trim());
    };
    sr.onerror = (e) => {
      setListening(false);
      setInterim('');
      if (e.error === 'not-allowed') setVoiceNote('Microphone blocked. Allow it in the browser, or type the names.');
      else if (e.error !== 'aborted' && e.error !== 'no-speech') setVoiceNote('Couldn’t hear that. Try again.');
    };
    sr.onend = () => {
      setListening(false);
      setInterim('');
      srRef.current = null;
      if (finalText.trim()) void resolveSpoken(parseSpokenNames(finalText));
    };
    srRef.current = sr;
    setVoiceNote('');
    setListening(true);
    sr.start();
  };
  useEffect(() => () => srRef.current?.stop(), []);
  const spokeOnce = useRef(false);
  useEffect(() => {
    if (!devSpeak || !data || spokeOnce.current) return;
    spokeOnce.current = true;
    void resolveSpoken(parseSpokenNames(devSpeak));
  }, [devSpeak, data, resolveSpoken]);

  // ── Rows for the current tab ──
  const rows: Person[] = useMemo(() => {
    if (!results) return [];
    if (tab === 'team') return results.team;
    if (tab === 'contacts') return results.contacts;
    return [...results.team, ...results.contacts];
  }, [results, tab]);

  const showCreate = query.trim().length >= 2 && tab !== 'team';
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[highlight]) void toggle(rows[highlight]);
      else if (showCreate) startCreate(query.trim());
    } else if (e.key === 'Escape') { setQuery(''); }
  };

  if (loadError) {
    return <p className="mb-4 text-xs text-red-400">{loadError} <button className="underline" onClick={() => { setLoadError(''); void load(); }}>Try again</button></p>;
  }
  if (!data || data.access === null) return null;

  const people = data.people;
  const readOnly = data.access !== 'full';

  // ── Folded: an avatar row under the title ──
  if (!expanded) {
    if (readOnly && people.length === 0) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-surface-border bg-surface-card px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-ftc-mid flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-brand" /> In this meeting
        </span>
        {people.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {people.map((p) => (
              <PersonChip key={keyOf(p)} person={p} />
            ))}
          </div>
        ) : (
          <span className="text-xs text-ftc-mid">No people linked</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {readOnly ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-raised text-ftc-mid">Shared with you</span>
          ) : (
            <button type="button" onClick={reopen} className="text-xs font-medium text-brand hover:underline touch-manipulation">
              {people.length > 0 ? 'Edit' : 'Link people'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Open: pick people ──
  const counts = { all: (results?.team_total ?? 0) + (results?.contacts_total ?? 0), team: results?.team_total ?? 0, contacts: results?.contacts_total ?? 0 };
  // Someone already offered from the calendar invite is not offered twice.
  const invited = new Set((invite?.people ?? []).flatMap((p) => (p.person ? [keyOf(p.person)] : [])));
  const visibleSuggestions = suggestions.filter((s) => !picked.has(keyOf(s)) && !invited.has(keyOf(s)));

  return (
    <section className="mb-4 rounded-2xl border border-brand/30 bg-surface-card p-4 sm:p-5" aria-label="Who was in this meeting">
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-ftc-gray">Who was in this meeting?</h2>
          <p className="text-xs text-ftc-mid mt-0.5">Colleagues get the notes. Contacts get it on their record.</p>
        </div>
        {saving > 0 ? (
          <span className="text-[11px] text-ftc-mid flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving</span>
        ) : people.length > 0 ? (
          <span className="text-[11px] text-ftc-mid flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" /> Saved</span>
        ) : null}
      </div>

      {/* Picked */}
      {people.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {people.map((p) => (
            <PersonChip key={keyOf(p)} person={p} onRemove={() => apply([], [p])} />
          ))}
        </div>
      )}

      {/* Search + mic */}
      <div className="flex items-center gap-2">
        <label className="group flex-1 flex items-center gap-2 rounded-lg border border-surface-border bg-surface-raised px-3 h-10 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 transition-colors">
          <Search className="w-4 h-4 text-surface-muted group-hover:text-brand group-focus-within:text-brand transition-colors flex-shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={listening ? interim : query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            readOnly={listening}
            placeholder={listening ? 'Listening… say their names' : 'Search your team and contacts'}
            className="flex-1 min-w-0 bg-transparent text-sm text-ftc-gray placeholder:text-surface-muted outline-none"
            aria-label="Search people"
          />
          {query && !listening && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear" className="text-surface-muted hover:text-ftc-gray">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>
        {canSpeak && (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? 'Stop listening' : 'Say who was there'}
            title={listening ? 'Stop' : 'Say who was there'}
            className={`h-10 w-10 flex-shrink-0 rounded-lg border flex items-center justify-center transition-colors touch-manipulation ${
              listening ? 'bg-brand border-brand text-white animate-pulse' : 'border-surface-border bg-surface-raised text-ftc-mid hover:text-brand hover:border-brand/50'
            }`}
          >
            <Mic className="w-4 h-4" />
          </button>
        )}
      </div>
      {voiceNote && <p className="mt-2 text-xs text-amber-400">{voiceNote}</p>}

      {/* Spoken names that need a choice */}
      {choices.length > 0 && (
        <div className="mt-3 space-y-2">
          {choices.map((c, i) => (
            <div key={`${c.name}-${i}`} className="rounded-xl border border-surface-border bg-surface-raised p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-ftc-mid">
                  Which <span className="text-ftc-gray font-medium">{c.name}</span>{c.company ? ` from ${c.company}` : ''}?
                  {c.contacts_total > c.contacts.length && <span> Showing {c.contacts.length} of {c.contacts_total > 50 ? '50+' : c.contacts_total}.</span>}
                </p>
                <button type="button" onClick={() => setChoices((cs) => cs.filter((_, j) => j !== i))} className="text-surface-muted hover:text-ftc-gray" aria-label="Dismiss">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[...c.team, ...c.contacts].map((p) => (
                  <button
                    key={keyOf(p)}
                    type="button"
                    onClick={() => { void apply([p], [], 'voice'); setChoices((cs) => cs.filter((_, j) => j !== i)); }}
                    className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card pl-1 pr-2.5 py-1 text-xs text-ftc-gray hover:border-brand/50 touch-manipulation"
                  >
                    <Avatar person={p} size={20} />
                    <span className="truncate max-w-[180px]">{displayName(p)}</span>
                    {p.kind === 'member' ? <TeamBadge /> : p.company ? <span className="text-ftc-mid truncate max-w-[120px]">{p.company}</span> : null}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { startCreate(c.name, c.company ?? undefined); setChoices((cs) => cs.filter((_, j) => j !== i)); }}
                  className="flex items-center gap-1 rounded-full border border-dashed border-surface-border px-2.5 py-1 text-xs text-ftc-mid hover:text-brand hover:border-brand/50"
                >
                  <UserPlus className="w-3 h-3" /> Someone else
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Spoken names nobody matched */}
      {unmatched.length > 0 && !creating && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ftc-mid">Not found:</span>
          {unmatched.map((u) => (
            <button
              key={u.name + (u.company ?? '')}
              type="button"
              onClick={() => startCreate(u.name, u.company)}
              className="flex items-center gap-1 rounded-full border border-dashed border-surface-border px-2.5 py-1 text-xs text-ftc-gray hover:border-brand/50"
            >
              <UserPlus className="w-3 h-3 text-brand" /> Add {u.name}
            </button>
          ))}
        </div>
      )}

      {/* New contact */}
      {creating && (
        <div className="mt-3 rounded-xl border border-surface-border bg-surface-raised p-3">
          <p className="text-xs font-semibold text-ftc-gray mb-2">New contact</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ['first', 'First name'], ['last', 'Last name'], ['company', 'Company'], ['email', 'Email (optional)'],
            ] as const).map(([k, label]) => (
              <input
                key={k}
                value={creating[k]}
                onChange={(e) => setCreating((c) => c && { ...c, [k]: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setCreating(null); }}
                placeholder={label}
                aria-label={label}
                autoFocus={k === (creating.first ? 'last' : 'first')}
                type={k === 'email' ? 'email' : 'text'}
                className="h-9 rounded-lg border border-surface-border bg-surface-card px-3 text-sm text-ftc-gray placeholder:text-surface-muted outline-none focus:border-brand"
              />
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={() => setCreating(null)} className="text-xs text-ftc-mid hover:text-ftc-gray px-2 py-1">Cancel</button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={!creating.first.trim()}
              className="text-xs bg-brand text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* From your calendar */}
      {invite && (() => {
        const known = invite.people.filter((p) => p.person && !picked.has(keyOf(p.person))).map((p) => p.person as Person);
        const unknown = invite.people.filter((p) => !p.person);
        if (known.length === 0 && unknown.length === 0) return null;
        const when = new Date(invite.event.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return (
          <div className="mt-3 rounded-xl border border-surface-border bg-surface-raised p-2.5">
            <div className="flex items-center gap-2 mb-1.5">
              <CalendarDays className="w-3.5 h-3.5 text-brand flex-shrink-0" />
              <p className="text-xs text-ftc-mid flex-1 min-w-0 truncate">
                Invited to <span className="text-ftc-gray font-medium">{invite.event.title}</span> · {when}
              </p>
              {known.length > 1 && (
                <button type="button" onClick={() => apply(known, [], 'calendar')} className="text-xs font-semibold text-brand hover:underline flex-shrink-0 touch-manipulation">
                  Add all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {known.map((p) => (
                <button
                  key={keyOf(p)}
                  type="button"
                  onClick={() => apply([p], [], 'calendar')}
                  className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card pl-1 pr-2.5 py-1 text-xs text-ftc-gray hover:border-brand/50 touch-manipulation"
                >
                  <Avatar person={p} size={20} />
                  <span className="truncate max-w-[160px]">{displayName(p)}</span>
                  {p.kind === 'member' && <TeamBadge />}
                  <span className="text-brand font-semibold">+</span>
                </button>
              ))}
              {unknown.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => startCreate(u.name && !u.name.includes('@') ? u.name : u.email.split('@')[0].replace(/[._-]+/g, ' '), undefined, u.email)}
                  title={`${u.email} is not in the CRM yet`}
                  className="flex items-center gap-1 rounded-full border border-dashed border-surface-border px-2.5 py-1 text-xs text-ftc-mid hover:text-ftc-gray hover:border-brand/50 touch-manipulation"
                >
                  <UserPlus className="w-3 h-3 text-brand" /> Add {u.name && !u.name.includes('@') ? u.name : u.email}
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {calendarNote && <p className="mt-2 text-[11px] text-ftc-mid">{calendarNote}</p>}

      {/* Heard in the call */}
      {visibleSuggestions.length > 0 && !query && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ftc-mid">Heard in the call:</span>
          {visibleSuggestions.map((p) => (
            <button
              key={keyOf(p)}
              type="button"
              onClick={() => apply([p], [], 'suggestion')}
              className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-raised pl-1 pr-2.5 py-1 text-xs text-ftc-gray hover:border-brand/50 touch-manipulation"
            >
              <Avatar person={p} size={20} />
              {displayName(p)}
              <span className="text-brand font-semibold">+</span>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-3 flex items-center gap-1 border-b border-surface-border" role="tablist">
        {(['all', 'team', 'contacts'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => { setTab(t); setHighlight(0); }}
            className={`px-3 py-2 text-xs font-medium -mb-px border-b-2 transition-colors touch-manipulation ${
              tab === t ? 'border-brand text-ftc-gray' : 'border-transparent text-ftc-mid hover:text-ftc-gray'
            }`}
          >
            {t === 'all' ? 'All' : t === 'team' ? 'Your team' : 'Contacts'}
            {results && (t !== 'contacts' || query.trim().length >= 2) && (
              <span className="ml-1.5 text-surface-muted tabular-nums">
                {t === 'contacts' && results.contacts_capped ? '2000+' : counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Results */}
      <ul className="mt-1 max-h-72 overflow-y-auto overscroll-contain" role="listbox" aria-label="People">
        {searching && !results && (
          <li className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-ftc-mid" /></li>
        )}
        {rows.map((p, i) => {
          const on = picked.has(keyOf(p));
          return (
            <li key={keyOf(p)}>
              <button
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(p)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors touch-manipulation ${
                  i === highlight ? 'bg-surface-raised' : ''
                }`}
              >
                <Avatar person={p} />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm text-ftc-gray truncate">{displayName(p)}</span>
                    {p.kind === 'member' && <TeamBadge />}
                  </span>
                  <span className="block text-xs text-ftc-mid truncate">
                    {p.subtitle || (p.kind === 'member' ? p.email : p.email) || ''}
                  </span>
                </span>
                <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                  on ? 'bg-brand border-brand text-white' : 'border-surface-muted text-transparent'
                }`}>
                  <Check className="w-3 h-3" />
                </span>
              </button>
            </li>
          );
        })}
        {results && rows.length === 0 && !searching && (
          <li className="px-2 py-4 text-xs text-ftc-mid text-center">
            {tab === 'contacts' && query.trim().length < 2 ? 'Type a name to search contacts.' : 'Nothing matches.'}
          </li>
        )}
        {results && tab === 'all' && query.trim().length < 2 && rows.length > 0 && (
          <li className="px-2 pt-2 text-[11px] text-surface-muted">Type a name to search contacts too.</li>
        )}
        {showCreate && (
          <li>
            <button
              type="button"
              onClick={() => startCreate(query.trim())}
              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left text-sm text-brand hover:bg-surface-raised touch-manipulation"
            >
              <span className="w-8 h-8 rounded-full border border-dashed border-brand/50 flex items-center justify-center flex-shrink-0">
                <UserPlus className="w-4 h-4" />
              </span>
              Add “{query.trim()}” as a new contact
            </button>
          </li>
        )}
      </ul>

      {saveError && <p className="mt-2 text-xs text-red-400">{saveError}</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        {people.length === 0 ? (
          <button type="button" onClick={skip} className="text-xs font-medium text-ftc-mid hover:text-ftc-gray px-3 py-2 rounded-lg touch-manipulation">
            Skip
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setExpanded(false); setQuery(''); setChoices([]); setUnmatched([]); setCreating(null); }}
            className="text-xs font-semibold bg-brand text-white px-4 py-2 rounded-lg touch-manipulation"
          >
            Done
          </button>
        )}
      </div>
    </section>
  );
}

function PersonChip({ person, onRemove }: { person: Person; onRemove?: () => void }) {
  const clickable = person.kind === 'contact';
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-raised pl-0.5 pr-1.5 py-0.5 max-w-full">
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && openCrmContact(person.id)}
        title={clickable ? 'Open in the CRM' : 'Your team'}
        className="flex items-center gap-1.5 min-w-0 disabled:cursor-default"
      >
        <Avatar person={person} size={22} />
        <span className="text-xs text-ftc-gray truncate max-w-[160px]">{displayName(person)}</span>
      </button>
      {person.kind === 'member' && <TeamBadge />}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${displayName(person)}`} className="text-surface-muted hover:text-red-400 p-0.5">
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
