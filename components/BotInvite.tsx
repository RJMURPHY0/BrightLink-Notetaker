// Send a bot into a meeting from a link.
//
// The third capture path, and the only one where speaker attribution is exact
// rather than inferred: Recall.ai gets a separate audio stream per participant
// from the platform, each already carrying that person's display name. No
// clustering, no voiceprints, no echo gate.
//
// Hidden entirely when RECALL_API_KEY is unset, rather than offering a button
// that always fails. Nothing else on the record page changes when bots are off.
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2 } from 'lucide-react';

type State = 'checking' | 'off' | 'idle' | 'sending' | 'error';

// Matched here purely to give instant feedback; the server validates again and
// is the actual gate.
const MEETING_LINK = /^https:\/\/([\w-]+\.)*(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|zoom\.us|webex\.com)\//i;

export default function BotInvite({ meetingType }: { meetingType: string }) {
  const [state, setState] = useState<State>('checking');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recall/bot')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => {
        if (!cancelled) setState(d.enabled ? 'idle' : 'off');
      })
      .catch(() => { if (!cancelled) setState('off'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'checking' || state === 'off') return null;

  const valid = MEETING_LINK.test(url.trim());

  async function send() {
    setError('');
    setState('sending');
    try {
      const res = await fetch('/api/recall/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl: url.trim(), meetingType }),
      });
      const data = await res.json() as { recordingId?: string; error?: string };
      if (!res.ok || !data.recordingId) {
        setError(data.error ?? 'Could not send the bot.');
        setState('error');
        return;
      }
      router.push(`/recordings/${data.recordingId}`);
    } catch {
      setError('Could not reach the server.');
      setState('error');
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-brand" />
        <p className="text-xs font-semibold uppercase tracking-widest text-ftc-mid">
          Or send a bot
        </p>
      </div>

      <p className="text-xs text-surface-muted leading-relaxed">
        Paste a Teams, Meet, Zoom or Webex link. The bot joins the call and gets each
        person&apos;s audio separately, so every name is exact. It appears in the
        participant list.
      </p>

      <input
        value={url}
        onChange={(e) => { setUrl(e.target.value); if (state === 'error') setState('idle'); }}
        placeholder="https://meet.google.com/abc-defg-hij"
        spellCheck={false}
        disabled={state === 'sending'}
        className="w-full rounded-xl border border-surface-border bg-white text-black placeholder:text-gray-400 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-60"
      />

      <button
        type="button"
        onClick={send}
        disabled={!valid || state === 'sending'}
        className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
      >
        {state === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
        {state === 'sending' ? 'Sending…' : 'Send bot to meeting'}
      </button>

      {url.trim() && !valid && (
        <p className="text-xs text-amber-500">
          That is not a Teams, Meet, Zoom or Webex link.
        </p>
      )}
      {state === 'error' && error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
