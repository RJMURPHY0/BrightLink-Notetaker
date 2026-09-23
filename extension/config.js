// Which Notetaker instance this extension talks to.
//
// Set at pairing time from the origin of the page that paired, so loading the
// unpacked extension and connecting from a local dev server points it at that
// dev server without a rebuild. Falls back to production.

export const DEFAULT_API_BASE = 'https://notetaker.brightlink.io';

// The origin this extension shipped against before the BrightLink Notetaker
// rename. Copies already in the Web Store paired against it and still send it
// as their apiBase, so it stays a live alias on the Vercel project and stays
// allowed below.
export const LEGACY_API_BASE = 'https://ftctranscribe-phi.vercel.app';

export async function apiBase() {
  const { auth } = await chrome.storage.local.get('auth');
  return auth?.apiBase || DEFAULT_API_BASE;
}
