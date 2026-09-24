'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isFramed, onHostMessage, postToHost } from '@/lib/embed-bridge';

// Signs in someone who arrived from BrightLink, then hard-navigates to `next`
// (a same-origin path only).
//
//  - Inside BrightLink (a frame): ask BrightLink. It answers "carry on" when this
//    app is already signed in as the same person, otherwise it sends a
//    single-use sign-in token.
//  - A new tab from BrightLink: the token arrives in the URL hash (#token_hash=).
//  - Older BrightLink builds hand over their own access + refresh token. Kept so
//    a link from a BrightLink deploy that predates the token flow still works;
//    it makes both apps renew one session, which is exactly what the token flow
//    removes, so drop it once every BrightLink deploy sends a token.
//
// The token is Supabase's own single-use magic-link token, minted by BrightLink
// (api/notetaker/handoff) and never emailed. Redeeming it with verifyOtp gives
// this app a session of its own.

const HOST_REPLY_MS = 15_000;

// Neither auth call may hold the page up: BrightLink restarts a frame that has
// not asked to sign in within a few seconds, and a slow "who am I" check is
// cheaper treated as "nobody" (BrightLink then sends a token) than waited on.
const WHO_AM_I_MS = 3_000;
const REDEEM_MS = 15_000;

function within<T>(p: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { try { resolve(fallback()); } catch (e) { reject(e); } }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// A sign-in that keeps bouncing (this page → /login → back here) is stopped
// and said, never looped. Only bounces count, so "Try again" always works.
const LOOP_KEY = 'bl-sso-attempts';
const LOOP_WINDOW_MS = 60_000;
const LOOP_MAX = 3;

function tooManyAttempts(): boolean {
  try {
    const now = Date.now();
    const recent = (JSON.parse(sessionStorage.getItem(LOOP_KEY) ?? '[]') as number[]).filter((t) => now - t < LOOP_WINDOW_MS);
    recent.push(now);
    sessionStorage.setItem(LOOP_KEY, JSON.stringify(recent));
    return recent.length > LOOP_MAX;
  } catch {
    return false;
  }
}

type HostReply = { tokenHash: string | null } | { error: string };

export default function SsoPage() {
  // Strict Mode mounts effects twice in dev: guard so the token is redeemed once.
  const ran = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [framed, setFramed] = useState(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    setFramed(isFramed());

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const nextParam = hash.get('next') ?? query.get('next') ?? '/';
    const dest = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

    // BrightLink's light or dark, remembered for this frame only, so every page
    // after this one paints in it from the first frame (see app/layout.tsx).
    const hostTheme = query.get('theme');
    if (isFramed() && (hostTheme === 'light' || hostTheme === 'dark')) {
      try { sessionStorage.setItem('bl-theme', hostTheme); } catch { /* storage blocked */ }
    }

    const supabase = createClient();
    // HARD navigation, not router.replace(): a full document load guarantees the
    // freshly written session cookies go with the very first request to `dest`,
    // and it strips any token out of the URL.
    const go = () => window.location.replace(dest);
    const fail = (message: string) => {
      setProblem(message);
      postToHost({ type: 'auth-failed', message });
    };
    const redeem = async (tokenHash: string) => {
      const { error } = await within(
        supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' }),
        REDEEM_MS,
        () => { throw new Error('signing in took too long'); },
      );
      if (error) throw error;
    };

    let bounced = false;
    try {
      const ref = new URL(document.referrer);
      bounced = ref.origin === window.location.origin && ref.pathname === '/login';
    } catch { /* no referrer */ }
    if (bounced && tooManyAttempts()) {
      fail('Signing in keeps starting again. Sign in in a new tab, then try again.');
      return;
    }

    (async () => {
      try {
        const tokenHash = hash.get('token_hash') ?? query.get('token_hash');
        if (tokenHash) {
          await redeem(tokenHash);
          go();
          return;
        }

        const accessToken = hash.get('access_token') ?? query.get('access_token');
        const refreshToken = hash.get('refresh_token') ?? query.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) {
            window.location.replace('/login');
            return;
          }
          go();
          return;
        }

        if (isFramed()) {
          // Who this app is signed in as now, verified with the auth server.
          const currentUserId = await within(
            supabase.auth.getUser().then(({ data }) => data.user?.id ?? null, () => null),
            WHO_AM_I_MS,
            () => null,
          );

          const reply = await new Promise<HostReply>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const stop = onHostMessage((msg) => {
              if (msg.type !== 'auth' && msg.type !== 'auth-error') return;
              stop();
              clearTimeout(timer);
              resolve(msg.type === 'auth' ? { tokenHash: msg.tokenHash } : { error: msg.message });
            });
            timer = setTimeout(() => {
              stop();
              resolve({ error: 'BrightLink did not answer. Reload the page to try again.' });
            }, HOST_REPLY_MS);
            postToHost({ type: 'auth-request', currentUserId });
          });

          if ('error' in reply) {
            fail(reply.error);
            return;
          }
          if (reply.tokenHash) await redeem(reply.tokenHash);
          go();
          return;
        }

        window.location.replace('/login');
      } catch (e) {
        fail(e instanceof Error && e.message ? `Could not sign you in: ${e.message}` : 'Could not sign you in.');
      }
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      {problem ? (
        <div className="max-w-sm text-center">
          <p className="text-sm text-ftc-gray">{problem}</p>
          {/* Inside BrightLink the login page is not shown in the frame, so
              signing in by hand happens in a tab of its own; the frame shares
              its cookies once it is done. */}
          <a
            href="/login"
            target={framed ? '_blank' : undefined}
            rel={framed ? 'noopener' : undefined}
            className="mt-3 inline-block text-sm text-brand underline underline-offset-2"
          >
            {framed ? 'Sign in in a new tab' : 'Sign in another way'}
          </a>
        </div>
      ) : (
        <p className="text-ftc-mid text-sm">Signing in…</p>
      )}
    </div>
  );
}
