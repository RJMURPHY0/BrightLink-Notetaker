// Which Transcribe instance this extension talks to.
//
// Set at pairing time from the origin of the page that paired, so loading the
// unpacked extension and connecting from a local dev server points it at that
// dev server without a rebuild. Falls back to production.

export const DEFAULT_API_BASE = 'https://ftctranscribe-phi.vercel.app';

export async function apiBase() {
  const { auth } = await chrome.storage.local.get('auth');
  return auth?.apiBase || DEFAULT_API_BASE;
}
