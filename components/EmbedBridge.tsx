'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  STOP_RECORDING_EVENT, applyHostTheme, embedTitle, isEmbedded, onHostMessage, postToHost,
} from '@/lib/embed-bridge';

// Pages that only sign someone in. They talk to BrightLink themselves
// (app/auth/sso) and are never reported as a place.
const TRANSIENT = new Set(['/auth/sso', '/login']);

/**
 * Keeps BrightLink told where this frame is, and does what it asks. Renders
 * nothing, and does nothing at all outside a BrightLink frame.
 * See lib/embed-bridge.ts.
 */
export default function EmbedBridge() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const reportedOnce = useRef(false);

  // Where we are: the first real page says "ready", every move after "navigated".
  useEffect(() => {
    if (!isEmbedded() || !pathname || TRANSIENT.has(pathname)) return;
    const qs = search?.toString();
    const path = qs ? `${pathname}?${qs}` : pathname;
    postToHost({ type: reportedOnce.current ? 'navigated' : 'ready', path, title: embedTitle() });
    reportedOnce.current = true;
  }, [pathname, search]);

  // What BrightLink asks for.
  useEffect(() => {
    if (!isEmbedded()) return;
    return onHostMessage((msg) => {
      if (msg.type === 'navigate') router.replace(msg.path);
      else if (msg.type === 'theme') applyHostTheme(msg.theme);
      else if (msg.type === 'stop-recording') window.dispatchEvent(new Event(STOP_RECORDING_EVENT));
    });
  }, [router]);

  // Ctrl/⌘K inside the frame opens BrightLink's search, as it does everywhere else.
  useEffect(() => {
    if (!isEmbedded()) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        postToHost({ type: 'shortcut', key: 'search' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
