// Pairing the Chrome extension with this account.
//
// The extension needs to call the API as the signed-in user. Rather than
// building a second login inside the extension — a second password prompt, a
// second session to keep alive, a second thing to get wrong — this page hands
// over the Supabase session the browser is already holding, once, with the
// user watching it happen.
//
// `chrome.runtime.sendMessage` from a web page only reaches an extension that
// named this origin in its manifest's `externally_connectable`, and the
// extension checks the origin again on receipt. So the handover is restricted
// at both ends and no other site can ask for it.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PRODUCT_NAME } from '@/lib/branding';

// Published id. Replaced at release; during development the unpacked extension
// gets a different id on each load, which the manual field below covers.
const DEFAULT_EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID ?? '';

type Status = 'idle' | 'connecting' | 'connected' | 'no-extension' | 'error';

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          id: string,
          message: unknown,
          cb: (response?: { ok?: boolean; error?: string }) => void,
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

export default function ExtensionPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [extensionId, setExtensionId] = useState(DEFAULT_EXTENSION_ID);
  const [email, setEmail] = useState('');

  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
    const saved = window.localStorage.getItem('ftc-extension-id');
    if (saved && !DEFAULT_EXTENSION_ID) setExtensionId(saved);
  }, []);

  const connect = useCallback(async () => {
    setError('');
    setStatus('connecting');

    const id = extensionId.trim();
    if (!/^[a-p]{32}$/.test(id)) {
      setStatus('error');
      setError('That does not look like an extension ID. Copy it from chrome://extensions.');
      return;
    }
    if (!window.chrome?.runtime?.sendMessage) {
      setStatus('no-extension');
      return;
    }

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setStatus('error');
      setError('You are signed out. Reload the page and sign in, then try again.');
      return;
    }

    window.localStorage.setItem('ftc-extension-id', id);

    window.chrome.runtime.sendMessage(
      id,
      {
        type: 'ftc-connect',
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
        email: session.user.email,
        // The extension refreshes the token itself once the hour is up, the
        // same way any Supabase client does. A meeting outlasts an access
        // token, so without this the uploads die two thirds of the way in.
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      (response) => {
        const lastError = window.chrome?.runtime?.lastError;
        if (lastError || !response) {
          setStatus('no-extension');
          return;
        }
        if (response.ok) setStatus('connected');
        else {
          setStatus('error');
          setError(response.error ?? 'The extension refused the connection.');
        }
      },
    );
  }, [extensionId]);

  return (
    <div className="min-h-screen bg-surface text-ftc-gray flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Connect the Chrome extension</h1>
          <p className="text-sm text-ftc-mid leading-relaxed">
            One click to record any Teams, Meet or Zoom call — no screen-share picker, and
            everyone gets their real name from the meeting&apos;s own participant list.
          </p>
        </div>

        {status === 'connected' ? (
          <div className="rounded-2xl border border-emerald-600/30 bg-emerald-500/10 p-5 space-y-2">
            <p className="font-medium text-emerald-400">Connected{email ? ` as ${email}` : ''}.</p>
            <p className="text-sm text-ftc-mid leading-relaxed">
              Open your meeting tab and click the {PRODUCT_NAME} icon in the toolbar. You can close this page.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-5 space-y-4">
            {!DEFAULT_EXTENSION_ID && (
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-ftc-mid">
                  Extension ID
                </span>
                <input
                  value={extensionId}
                  onChange={(e) => setExtensionId(e.target.value)}
                  placeholder="abcdefghijklmnopabcdefghijklmnop"
                  spellCheck={false}
                  className="w-full rounded-xl border border-surface-border bg-white text-black placeholder:text-gray-400 px-3 py-2.5 text-sm font-mono tracking-tight focus:outline-none focus:ring-2 focus:ring-brand/50"
                />
                <span className="block text-[11px] text-surface-muted leading-relaxed">
                  From <code className="text-ftc-mid">chrome://extensions</code>, under {PRODUCT_NAME}.
                  Only needed while the extension is loaded unpacked.
                </span>
              </label>
            )}

            <button
              type="button"
              onClick={connect}
              disabled={status === 'connecting'}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-60"
            >
              {status === 'connecting' ? 'Connecting…' : 'Connect this account'}
            </button>

            {status === 'no-extension' && (
              <p className="text-sm text-amber-500 leading-relaxed">
                Chrome could not reach the extension. Check it is installed and enabled at{' '}
                <code className="text-ftc-mid">chrome://extensions</code>, and that the ID above matches.
              </p>
            )}
            {status === 'error' && error && (
              <p className="text-sm text-red-400 leading-relaxed">{error}</p>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-surface-border bg-surface-card p-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-ftc-mid">What it records</p>
          <p className="text-sm text-ftc-mid leading-relaxed">
            Your microphone and the call arrive as two separate tracks, so your own words are never
            confused with anyone else&apos;s. The call keeps playing through your speakers as normal.
          </p>
        </div>
      </div>
    </div>
  );
}
