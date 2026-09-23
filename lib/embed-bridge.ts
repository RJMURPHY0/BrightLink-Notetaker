/**
 * The Notetaker's side of being shown inside BrightLink.
 *
 * BrightLink (the CRM, app.brightlink.io) shows these screens in a frame under
 * its own /meetings pages, with its own sidebar, top bar and header. Embedded,
 * this app hides its global chrome (anything marked `data-nt-chrome`) and talks
 * to BrightLink only through window.postMessage, in the protocol below. The CRM
 * has the mirror of this file (src/features/meetings/notetakerBridge.ts); keep
 * the two in step, and bump BRIDGE_VERSION on any breaking change.
 *
 * Who may frame this app is decided by the browser from the CSP frame-ancestors
 * header (next.config.js). This file adds the same rule on messages: a message
 * counts only from the parent window, from an allowed origin.
 *
 * Standalone (its own tab, the PWA, the extension's pages) nothing here runs.
 */

export const BRIDGE_NS = 'brightlink-embed';
export const BRIDGE_VERSION = 1;

export type BridgeTheme = 'light' | 'dark';
export type RecordingState = 'recording' | 'paused' | 'saving';

/** BrightLink → Notetaker. */
export type HostMessage =
  | { type: 'auth'; tokenHash: string | null }
  | { type: 'auth-error'; message: string }
  | { type: 'navigate'; path: string }
  | { type: 'theme'; theme: BridgeTheme }
  | { type: 'stop-recording' }
  /** Re-read the page's data in place: the frame sat hidden and may be stale. */
  | { type: 'refresh' };

/** Notetaker → BrightLink. */
export type GuestMessage =
  | { type: 'auth-request'; currentUserId: string | null }
  | { type: 'auth-failed'; message: string }
  | { type: 'ready'; path: string; title: string }
  | { type: 'navigated'; path: string; title: string }
  | { type: 'title'; title: string }
  | { type: 'recording'; state: RecordingState | null; seconds: number }
  | { type: 'shortcut'; key: 'search' };

/** Fired on window when BrightLink asks the recorder to stop and save. */
export const STOP_RECORDING_EVENT = 'bl:stop-recording';

const DEFAULT_HOSTS = ['https://app.brightlink.io'];

function configuredHosts(): string[] {
  const extra = (process.env.NEXT_PUBLIC_CRM_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...DEFAULT_HOSTS, ...extra];
}

/** The pages allowed to embed this app. In development, any localhost port too. */
export function isAllowedHostOrigin(origin: string): boolean {
  if (configuredHosts().includes(origin)) return true;
  return process.env.NODE_ENV === 'development' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** True inside any frame. Cross-origin access to window.top throws in some browsers. */
export function isFramed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Set before first paint by the inline script in app/layout.tsx. */
export function isEmbedded(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.embed === '1';
}

let knownHostOrigin: string | null = null;

/** The parent's origin, once it is known and allowed. */
function hostOrigin(): string | null {
  if (knownHostOrigin) return knownHostOrigin;
  try {
    const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    const first = ancestors && ancestors.length > 0 ? ancestors[0] : null;
    if (first && isAllowedHostOrigin(first)) return (knownHostOrigin = first);
  } catch { /* not exposed in this browser */ }
  try {
    const ref = document.referrer ? new URL(document.referrer).origin : null;
    if (ref && isAllowedHostOrigin(ref)) return (knownHostOrigin = ref);
  } catch { /* no referrer */ }
  return null;
}

export function postToHost(msg: GuestMessage): void {
  if (!isFramed()) return;
  // Until the parent is known (Firefox exposes no ancestorOrigins, and after a
  // same-site reload the referrer is this app), fall back to "*". Only the
  // origins in frame-ancestors can be the parent at all.
  window.parent.postMessage({ ns: BRIDGE_NS, v: BRIDGE_VERSION, ...msg }, hostOrigin() ?? '*');
}

const text = (v: unknown, max = 300): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const safePath = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= 2048 && v.startsWith('/') && !v.startsWith('//') ? v : null;

/** A message from BrightLink, or null for anything else (any page can post to any window). */
export function parseHostMessage(event: MessageEvent): HostMessage | null {
  if (typeof window === 'undefined' || event.source !== window.parent) return null;
  if (!isAllowedHostOrigin(event.origin)) return null;
  const d = event.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.ns !== BRIDGE_NS || d.v !== BRIDGE_VERSION) return null;
  knownHostOrigin = event.origin;

  switch (d.type) {
    case 'auth': {
      const hash = d.tokenHash;
      if (hash === null) return { type: 'auth', tokenHash: null };
      return typeof hash === 'string' && /^[A-Za-z0-9_-]{8,512}$/.test(hash) ? { type: 'auth', tokenHash: hash } : null;
    }
    case 'auth-error': {
      const message = text(d.message);
      return message === null ? null : { type: 'auth-error', message };
    }
    case 'navigate': {
      const path = safePath(d.path);
      return path === null ? null : { type: 'navigate', path };
    }
    case 'theme':
      return d.theme === 'light' || d.theme === 'dark' ? { type: 'theme', theme: d.theme } : null;
    case 'stop-recording':
      return { type: 'stop-recording' };
    case 'refresh':
      return { type: 'refresh' };
    default:
      return null;
  }
}

export function onHostMessage(handler: (msg: HostMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    const msg = parseHostMessage(event);
    if (msg) handler(msg);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** The recorder's state, for BrightLink's "Recording 12:03" and its stop guard. */
export function reportRecording(state: RecordingState | null, seconds: number): void {
  if (isEmbedded()) postToHost({ type: 'recording', state, seconds: Math.max(0, Math.floor(seconds)) });
}

// The name of the meeting on screen, set by <EmbedTitle> and cleared when that
// page goes. Read by EmbedBridge so a "navigated" message carries it: the page's
// effects run before the layout's, so a separate message would arrive first and
// be overwritten by the navigation's empty title.
let currentTitle = '';

export function setEmbedTitle(title: string): void {
  currentTitle = title;
}

export function embedTitle(): string {
  return currentTitle;
}

/** The name of the meeting on screen, for BrightLink's tab title. */
export function reportTitle(title: string): void {
  if (isEmbedded()) postToHost({ type: 'title', title });
}

/**
 * Light or dark as BrightLink says, without touching this app's own saved
 * choice (localStorage ftc-theme). Remembered for this frame only, so the next
 * page load paints in it before first frame (app/layout.tsx).
 */
export function applyHostTheme(theme: BridgeTheme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try { sessionStorage.setItem('bl-theme', theme); } catch { /* storage blocked */ }
}
