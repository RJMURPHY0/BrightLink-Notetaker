// The rename guard.
//
// Echo learned this the hard way: a rebrand that touches a plumbing identifier
// strands something already in the wild, and nothing tells you until a customer
// reports it. Each value below is frozen because a system OUTSIDE this repo
// finds this app by it and cannot be updated in the same deploy. The test says
// why, so a future rename either leaves them alone or breaks here first.
//
// No browser and no database — lib/branding.ts is deliberately dependency-free.
import { test, expect } from '@playwright/test';

import {
  PRODUCT_NAME,
  PRODUCT_SHORT_NAME,
  COMPANY_NAME,
  CANONICAL_ORIGIN,
  LEGACY_ORIGINS,
  LEGACY_PRODUCT_NAMES,
  ALL_ORIGINS,
  MOBILE_URL_SCHEME,
  VERCEL_PROJECT,
  FEEDBACK_SOURCE,
  GITHUB_REPO,
  DICTATION_APP,
  TRANSCRIBE_APP,
  VOICE_SOURCE_LABEL,
} from '../lib/branding';

test.describe('display names', () => {
  test('the product names itself BrightLink Notetaker', () => {
    expect(PRODUCT_NAME).toBe('BrightLink Notetaker');
    expect(PRODUCT_SHORT_NAME).toBe('Notetaker');
    expect(COMPANY_NAME).toBe('BRIGHTLINK (OS) LTD');
  });

  test('the sibling dictation app is named Echo, not Whisper', () => {
    // Echo shipped under the new name in Sept 2026; this default was stale for
    // a while and surfaced "FTC Whisper" on every auto-learned voice sample.
    expect(DICTATION_APP.name).toBe('BrightLink Echo');
    expect(VOICE_SOURCE_LABEL.dictation).toBe('BrightLink Echo');
  });

  test('every shipped-under name is remembered', () => {
    expect(LEGACY_PRODUCT_NAMES).toContain('FTC Transcribe');
  });
});

test.describe('frozen identifiers', () => {
  test('the legacy origin stays allowed', () => {
    // The Chrome extension in the Web Store and every installed iOS build call
    // this host. Dropping it silently breaks them until each is republished.
    expect(LEGACY_ORIGINS).toContain('https://ftctranscribe-phi.vercel.app');
    expect(ALL_ORIGINS[0]).toBe(CANONICAL_ORIGIN);
    expect(ALL_ORIGINS).toContain('https://ftctranscribe-phi.vercel.app');
  });

  test('the canonical origin is the BrightLink subdomain', () => {
    expect(CANONICAL_ORIGIN).toBe('https://notetaker.brightlink.io');
  });

  test('the Vercel project slug is unchanged', () => {
    // Renaming the project drops the .vercel.app alias above with it.
    expect(VERCEL_PROJECT).toBe('ftctranscribe');
  });

  test('the mobile deep-link scheme is unchanged', () => {
    // Baked into every shipped binary; a new scheme is a new app to iOS.
    expect(MOBILE_URL_SCHEME).toBe('ftctranscribe');
  });

  test('the feedback/auto-fix source is unchanged', () => {
    // The CRM routes reports by this value, and old rows already carry it.
    expect(FEEDBACK_SOURCE).toBe('transcribe');
  });

  test('the brand id persisted on voice profiles is unchanged', () => {
    expect(TRANSCRIBE_APP.id).toBe('transcribe');
    expect(DICTATION_APP.id).toBe('dictation');
  });
});

test.describe('no stored display names', () => {
  test('every VoiceProfile.source resolves to a label', () => {
    // Stored data holds the source id, never the product's name — that is what
    // makes a rebrand an edit to one module.
    for (const source of ['enrollment', 'dictation', 'match', 'relabel', 'auto']) {
      expect(VOICE_SOURCE_LABEL[source]).toBeTruthy();
    }
  });

  test('the repo the auto-fixer files against is the renamed one', () => {
    expect(GITHUB_REPO).toBe('RJMURPHY0/BrightLink-Notetaker');
  });
});
