'use client';

// Who was in this meeting, from the recordings list (2026-09-25).
//
// A people icon beside the folder and bin on every row. It opens a compact
// picker like the CRM's list "assign" popover: one search, Your team and
// Contacts as sections, the tick first in each row. Ticking a colleague shares
// the meeting with them read-only; ticking a contact puts it on their record.
// Every tick saves as it is made, through the same RPCs as the recording
// page's picker (MeetingPeopleCard), which also owns the fuller flow (voice,
// calendar invitees, adding a new contact).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, Users } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';
import {
  Avatar, PickTick, keyOf, displayName,
  type Loaded, type Person, type PeopleRpcClient, type SearchResult,
} from '@/app/recordings/[id]/MeetingPeopleCard';

export default function MeetingPeopleButton({ recordingId, needsPeople, client }: {
  recordingId: string;
  /** Nobody linked yet on my own meeting: the icon is highlighted. */
  needsPeople?: boolean;
  client?: PeopleRpcClient;
}) {
  const supabase = useMemo<PeopleRpcClient>(() => client ?? (createClient() as unknown as PeopleRpcClient), [client]);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(0);
  const changed = useRef(false);
  const seq = useRef(0);

  // Loaded on open only, so a long list costs nothing until it is used.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: res, error: e } = await supabase.rpc('meeting_people_get', { p_recording_id: recordingId });
      if (cancelled) return;
      if (e) { setError('Couldn’t load who was in this meeting.'); return; }
      setData(res as Loaded);
    })();
    return () => { cancelled = true; };
  }, [open, supabase, recordingId]);

  useEffect(() => {
    if (!open || data?.access !== 'full') return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const { data: res, error: e } = await supabase.rpc('meeting_people_search', {
        p_recording_id: recordingId, p_query: query, p_scope: 'all', p_limit: 12,
      });
      if (n !== seq.current) return;
      if (e) { setError('Search failed. Try again.'); return; }
      setResults(res as SearchResult);
    }, query ? 180 : 0);
    return () => clearTimeout(t);
  }, [open, query, data?.access, supabase, recordingId]);

  const picked = useMemo(() => new Set((data?.people ?? []).map(keyOf)), [data]);

  const toggle = async (p: Person) => {
    const on = picked.has(keyOf(p));
    setData((d) => d && { ...d, people: on ? d.people.filter((x) => keyOf(x) !== keyOf(p)) : [...d.people, p] });
    setSaving((n) => n + 1);
    setError('');
    const { data: res, error: e } = await supabase.rpc('meeting_people_set', {
      p_recording_id: recordingId,
      p_add: on ? [] : [{ kind: p.kind, id: p.id, method: 'search' }],
      p_remove: on ? [{ kind: p.kind, id: p.id }] : [],
    });
    setSaving((n) => n - 1);
    if (e) {
      setError('Couldn’t save that change. Try again.');
      const { data: again } = await supabase.rpc('meeting_people_get', { p_recording_id: recordingId });
      if (again) setData(again as Loaded);
      return;
    }
    changed.current = true;
    setData(res as Loaded);
  };

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setQuery('');
      // The row's "Link people" marker comes from the server.
      if (changed.current) { changed.current = false; router.refresh(); }
    }
  };

  // Picked people first, then everyone else the search found.
  const people = data?.people ?? [];
  const q = query.trim().toLowerCase();
  const pickedShown = people.filter((p) => !q || `${displayName(p)} ${p.email ?? ''} ${p.company ?? ''}`.toLowerCase().includes(q));
  const team = (results?.team ?? []).filter((p) => !picked.has(keyOf(p)));
  const contacts = (results?.contacts ?? []).filter((p) => !picked.has(keyOf(p)));
  const readOnly = data && data.access !== 'full';

  const row = (p: Person, disabled = false) => (
    <button
      key={keyOf(p)}
      type="button"
      disabled={disabled}
      onClick={() => void toggle(p)}
      className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors touch-manipulation disabled:cursor-default ${
        picked.has(keyOf(p)) ? 'bg-green-500/[0.07]' : 'hover:bg-surface-raised'
      }`}
    >
      {!disabled && <PickTick on={picked.has(keyOf(p))} size={24} />}
      <Avatar person={p} size={22} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-ftc-gray truncate">{displayName(p)}</span>
        {p.kind === 'contact' && (p.company || p.subtitle) && (
          <span className="block text-[10px] text-ftc-mid truncate">{p.company || p.subtitle}</span>
        )}
      </span>
    </button>
  );
  const heading = (label: string) => (
    <p className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-surface-muted">{label}</p>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Who was in this meeting"
          aria-label="Who was in this meeting"
          className={`p-1.5 rounded-lg transition-colors touch-manipulation ${
            needsPeople ? 'text-brand hover:bg-brand/10' : 'text-surface-muted hover:text-ftc-mid hover:bg-surface-raised'
          }`}
        >
          <Users className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between px-3 pt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ftc-mid">In this meeting</p>
          {saving > 0 && <Loader2 className="w-3 h-3 animate-spin text-ftc-mid" />}
        </div>

        {!data ? (
          error ? null : <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-ftc-mid" /></div>
        ) : data.access === null ? (
          <p className="px-3 py-3 text-xs text-ftc-mid">Only the person who recorded this can change who was in it.</p>
        ) : readOnly ? (
          <div className="p-1.5">
            {people.length === 0 ? <p className="px-2 py-2 text-xs text-ftc-mid">Nobody linked.</p> : people.map((p) => row(p, true))}
            <p className="px-2 pt-1 pb-1 text-[10px] text-surface-muted">Shared with you</p>
          </div>
        ) : (
          <>
            <div className="p-2">
              <label className="group relative block">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-muted group-focus-within:text-brand pointer-events-none transition-colors" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your team and contacts"
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-surface-raised border border-surface-border text-ftc-gray placeholder:text-surface-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>
            </div>
            <div className="max-h-72 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
              {pickedShown.length > 0 && <>{heading('Linked')}{pickedShown.map((p) => row(p))}</>}
              {team.length > 0 && <>{heading('Your team')}{team.map((p) => row(p))}</>}
              {contacts.length > 0 && <>{heading('Contacts')}{contacts.map((p) => row(p))}</>}
              {results && pickedShown.length + team.length + contacts.length === 0 && (
                <p className="px-2 py-3 text-xs text-ftc-mid text-center">Nothing matches</p>
              )}
              {results && q.length < 2 && (
                <p className="px-2 pt-2 text-[10px] text-surface-muted">Type a name to search contacts too.</p>
              )}
            </div>
          </>
        )}
        {error && <p className="px-3 pb-2.5 text-xs text-red-400">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}
