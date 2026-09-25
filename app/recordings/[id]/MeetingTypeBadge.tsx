'use client';

// The meeting's type, and a way to correct it.
//
// The type is worked out from the transcript at finalize. That is right most of
// the time and wrong on the borderline cases — an internal demo of your own
// product reads a lot like a sales call — so the label is editable. Without
// that, one bad guess is permanent and the dashboard's meeting-type filter
// stops being worth using.

import { useState, useRef, useEffect } from 'react';
import { MEETING_TYPES, type MeetingTypeFilter } from '@/lib/recording-filters';
import { useReadOnly } from './ReadOnlyContext';

const LABELS: Record<MeetingTypeFilter, string> = {
  general: '💬 General', standup: '🗓 Standup', sales: '📈 Sales',
  interview: '🎯 Interview', review: '📋 Review',
};

export default function MeetingTypeBadge({ id, initial }: { id: string; initial: string }) {
  // Anything unrecognised (including the 'auto' marker on a recording still
  // being processed) shows as General until finalize writes a real type.
  const known = (MEETING_TYPES as readonly string[]).includes(initial)
    ? (initial as MeetingTypeFilter)
    : 'general';

  const [type, setType] = useState<MeetingTypeFilter>(known);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const readOnly = useReadOnly();

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const choose = async (next: MeetingTypeFilter) => {
    setOpen(false);
    if (next === type) return;
    const previous = type;
    setType(next);           // optimistic: the dropdown should feel instant
    setSaving(true);
    try {
      const res = await fetch(`/api/recordings/${id}/meeting-type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingType: next }),
      });
      if (!res.ok) setType(previous);
    } catch {
      setType(previous);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={ref} className="relative hidden sm:inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Meeting type"
        disabled={saving || readOnly}
        className={`text-xs px-2 py-0.5 rounded-full bg-surface-raised border border-surface-border
                    text-ftc-mid hover:text-ftc-gray hover:border-brand/40 transition-colors
                    ${saving ? 'opacity-60' : ''}`}
      >
        {LABELS[type]}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] rounded-xl border border-surface-border bg-surface-card shadow-lg overflow-hidden">
          {MEETING_TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => choose(t)}
              className={`w-full text-left text-xs px-3 py-2 transition-colors ${
                t === type ? 'text-brand bg-brand/10' : 'text-ftc-gray hover:bg-surface-raised'
              }`}
            >
              {LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
