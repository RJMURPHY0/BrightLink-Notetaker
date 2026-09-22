'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Folder, Check, Search } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

interface Folder { id: string; name: string }

export default function AssignFolderButton({
  recordingId,
  currentFolderId,
  folders,
}: {
  recordingId: string;
  currentFolderId: string | null;
  folders: Folder[];
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const router = useRouter();

  const assign = async (folderId: string | null) => {
    setOpen(false);
    setQuery('');
    setSaving(true);
    try {
      await fetch(`/api/recordings/${recordingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const filtered = query
    ? folders.filter(f => f.name.toLowerCase().includes(query.toLowerCase()))
    : folders;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          title={currentFolderId ? 'Move to folder' : 'Add to folder'}
          className={`p-1.5 rounded-lg transition-colors touch-manipulation ${
            currentFolderId
              ? 'text-brand hover:bg-brand/10'
              : 'text-surface-muted hover:text-ftc-mid hover:bg-surface-raised'
          } disabled:opacity-40`}
        >
          {saving ? (
            <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
          ) : (
            <Folder className="w-4 h-4" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        {/* Search — filter folders by name */}
        <div className="p-2 border-b border-surface-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-muted pointer-events-none" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search folders..."
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-surface-raised border border-surface-border text-ftc-gray placeholder:text-surface-muted focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        <div className="max-h-56 overflow-y-auto py-1">
          {currentFolderId && !query && (
            <>
              <button
                type="button"
                onClick={() => assign(null)}
                className="w-full text-left px-3 py-2 text-xs text-ftc-mid hover:bg-surface-raised transition-colors touch-manipulation"
              >
                Remove from folder
              </button>
              <div className="my-1 h-px bg-surface-border" />
            </>
          )}

          {folders.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-ftc-mid">No folders yet — create one above</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-ftc-mid text-center">No matches</p>
          ) : (
            filtered.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => assign(f.id)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-surface-raised transition-colors touch-manipulation ${
                  f.id === currentFolderId ? 'text-brand' : 'text-ftc-gray'
                }`}
              >
                <Folder className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                {f.id === currentFolderId && <Check className="w-3.5 h-3.5 ml-auto text-brand flex-shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
