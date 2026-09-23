// Product identity: every name this app shows, and every name it must never change.
//
// DISPLAY names are what people see: the tab title, the login page, export
// footers, the meeting bot's name in a call, the PWA entry. Renaming the
// product is an edit to that block and nothing else.
//
// FROZEN identifiers are plumbing that other systems find this one by. They keep
// their original "FTC Transcribe" values on purpose:
//   * the published Chrome extension and shipped iOS builds call LEGACY_ORIGINS
//     and cannot be updated in lockstep with a deploy;
//   * the mobile URL scheme and the EAS project id are baked into build history;
//   * env var names are set as secrets in two separate Vercel projects;
//   * feature keys, doc-logo ids and VoiceProfile.source values are rows in the
//     shared database.
// Changing any of them breaks something that is already in the wild.
// lib/branding.test.ts pins the frozen set.
//
// Same split as lib/meeting-provider.ts, which keeps `teams` / `meet` as ids and
// resolves the badge separately. Stored data NEVER holds a display name.

// ── Display: change these to rename the product ─────────────────────────────

/** The product's full name: the tab title, export footers, the login page. */
export const PRODUCT_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'BrightLink Notetaker';

/** The product's own name, as the BrightLink | Notetaker lockup shows it. */
export const PRODUCT_SHORT_NAME = 'Notetaker';

/** The registered legal name, exactly as Companies House shows it (17459281). */
export const COMPANY_NAME = 'BRIGHTLINK (OS) LTD';

export const WEBSITE_URL = 'https://brightlink.io';

/** Where the app lives now. Everything new should link here. */
export const CANONICAL_ORIGIN =
  process.env.NEXT_PUBLIC_APP_ORIGIN || 'https://notetaker.brightlink.io';

/** Every name the product has shipped under before, newest first. */
export const LEGACY_PRODUCT_NAMES = ['FTC Transcribe'] as const;

/** The repo releases and auto-fix runs are filed against. */
export const GITHUB_REPO = 'RJMURPHY0/BrightLink-Notetaker';

// ── Frozen: never change these (see the module docstring) ───────────────────

/**
 * Origins this app answered on before the rebrand. The Chrome extension in the
 * Web Store and every installed iOS build still point at the first one, so it
 * stays a live alias on the Vercel project and stays in every CORS allowlist.
 */
export const LEGACY_ORIGINS = [
  'https://ftctranscribe-phi.vercel.app',
  'https://ftctranscribe.vercel.app',
] as const;

/** Every origin the app answers on, canonical first. */
export const ALL_ORIGINS = [CANONICAL_ORIGIN, ...LEGACY_ORIGINS] as const;

/** Deep-link scheme the iOS build registers. Baked into shipped binaries. */
export const MOBILE_URL_SCHEME = 'ftctranscribe';

/** Vercel project slug. Renaming it would drop the legacy .vercel.app alias. */
export const VERCEL_PROJECT = 'ftctranscribe';

/** What this app calls itself to the CRM's feedback and auto-fix pipelines. */
export const FEEDBACK_SOURCE = 'transcribe';

export interface ProductBrand {
  /** Stable machine id. Persisted in the database. Never renamed. */
  id: string;
  /** Display name. Overridable per environment. */
  name: string;
  /** Public path to the logo used beside the name. */
  logo: string;
}

/** The push-to-talk dictation desktop app (BrightLink Echo, formerly FTC Whisper). */
export const DICTATION_APP: ProductBrand = {
  id: 'dictation',
  name: process.env.NEXT_PUBLIC_DICTATION_APP_NAME || 'BrightLink Echo',
  logo: process.env.NEXT_PUBLIC_DICTATION_APP_LOGO || '/brand/dictation.png',
};

/** This app, for anywhere the product needs to name itself. */
export const TRANSCRIBE_APP: ProductBrand = {
  id: 'transcribe',
  name: PRODUCT_NAME,
  logo: process.env.NEXT_PUBLIC_APP_LOGO || '/logo.png',
};

/**
 * Where a voice training sample came from, in words the user recognises.
 * Keyed by VoiceProfile.source, so adding a source means adding a line here
 * rather than editing the voice-setup page.
 */
export const VOICE_SOURCE_LABEL: Record<string, string> = {
  enrollment: 'Enrolled',
  dictation: DICTATION_APP.name,
  match: 'Auto-learned',
  relabel: 'From rename',
  auto: 'Self-intro',
};

/** Logo shown beside a sample's source badge, when that source has one. */
export const VOICE_SOURCE_LOGO: Record<string, string> = {
  dictation: DICTATION_APP.logo,
};
