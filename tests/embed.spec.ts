// BrightLink shows the Notetaker inside its own pages, in a frame
// (lib/embed-bridge.ts here, src/features/meetings/ in the CRM). Two things must
// hold or the embed either breaks or opens a hole: the protocol constants match
// the CRM's, and only BrightLink may frame the app or drive it.
//
// The first block needs no browser and no database; the header check runs
// against BASE_URL like the smoke tests.
import { test, expect } from '@playwright/test';

import {
  BRIDGE_NS,
  BRIDGE_VERSION,
  STOP_RECORDING_EVENT,
  isAllowedHostOrigin,
} from '../lib/embed-bridge';

test.describe('BrightLink embed bridge', () => {
  test('speaks the protocol the CRM speaks (src/features/meetings/notetakerBridge.ts)', () => {
    expect(BRIDGE_NS).toBe('brightlink-embed');
    expect(BRIDGE_VERSION).toBe(1);
    expect(STOP_RECORDING_EVENT).toBe('bl:stop-recording');
  });

  test('only BrightLink may drive the frame', () => {
    expect(isAllowedHostOrigin('https://app.brightlink.io')).toBe(true);
    expect(isAllowedHostOrigin('https://www.brightlink.io')).toBe(true);
    expect(isAllowedHostOrigin('https://evil.example')).toBe(false);
    expect(isAllowedHostOrigin('https://app.brightlink.io.evil.example')).toBe(false);
    expect(isAllowedHostOrigin('http://app.brightlink.io')).toBe(false);
    if (process.env.NODE_ENV !== 'development') {
      expect(isAllowedHostOrigin('http://localhost:5196')).toBe(false);
    }
  });
});

test.describe('framing headers', () => {
  test('BrightLink may frame the app, and the old DENY is gone', async ({ request }) => {
    const res = await request.get('/install');
    expect(res.status()).toBe(200);
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("frame-ancestors 'self' https://app.brightlink.io https://www.brightlink.io");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(res.headers()['x-frame-options']).toBeUndefined();
  });
});
