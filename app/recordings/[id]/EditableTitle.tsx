'use client';

import { useState, useRef } from 'react';
import { reportTitle, setEmbedTitle } from '@/lib/embed-bridge';

export default function EditableTitle({ id, initial }: { id: string; initial: string }) {
  const [title, setTitle] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === title) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/recordings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setTitle(trimmed);
        // Inside BrightLink, its browser tab follows the new name.
        setEmbedTitle(trimmed);
        reportTitle(trimmed);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={onKeyDown}
        disabled={saving}
        autoFocus
        className="font-semibold text-sm text-ftc-gray bg-surface-raised border border-brand rounded-lg px-2 py-0.5 outline-none w-full max-w-full sm:max-w-xs"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      title="Click to rename"
      className="group flex w-full min-w-0 items-center gap-1.5 text-left touch-manipulation"
    >
      <span className="block min-w-0 truncate font-semibold text-sm text-ftc-gray">{title}</span>
      <svg
        className="hidden h-3.5 w-3.5 flex-shrink-0 text-surface-muted transition-colors group-hover:text-brand sm:block"
        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        />
      </svg>
    </button>
  );
}
