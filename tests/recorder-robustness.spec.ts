// Rules the browser recorder relies on to never lose speech silently,
// whatever the device. Dependency-free: no browser, no microphone needed.
import { test, expect } from '@playwright/test';
import { shouldSkipSilentChunk } from '../lib/chunk-skip';
import { pickBestMic, sameDeviceIds, type MicDevice } from '../lib/mic-select';

const MIN2 = 120_000;

test.describe('shouldSkipSilentChunk', () => {
  test('a watched, silent window is skipped', () => {
    expect(shouldSkipSilentChunk({ durationMs: MIN2, measuredMs: MIN2, audibleMs: 0 })).toBe(true);
  });

  test('a background tab (meter throttled to 1/s) is never skipped', () => {
    // 1 tick per second = 10% coverage, and every tick heard speech.
    expect(shouldSkipSilentChunk({ durationMs: MIN2, measuredMs: MIN2 / 10, audibleMs: 0 })).toBe(false);
  });

  test('a suspended audio context (meter saw nothing) is never skipped', () => {
    expect(shouldSkipSilentChunk({ durationMs: MIN2, measuredMs: 0, audibleMs: 0 })).toBe(false);
  });

  test('a little sound is enough to upload', () => {
    expect(shouldSkipSilentChunk({ durationMs: MIN2, measuredMs: MIN2, audibleMs: 6_000 })).toBe(false);
  });
});

test.describe('microphone fallback', () => {
  const devices: MicDevice[] = [
    { deviceId: 'default', label: 'Default - Headset Microphone (Jabra Link 380)' },
    { deviceId: 'communications', label: 'Communications - Headset Microphone (Jabra Link 380)' },
    { deviceId: 'jabra', label: 'Headset Microphone (Jabra Link 380)' },
    { deviceId: 'array', label: 'Microphone Array (Intel® Smart Sound Technology)' },
    { deviceId: 'stereo', label: 'Stereo Mix (Realtek Audio)' },
  ];

  test('auto-pick prefers the headset', () => {
    expect(pickBestMic(devices)?.deviceId).toBe('jabra');
  });

  test('a dead headset opened as the OS default excludes its real id too', () => {
    const dead = sameDeviceIds('default', 'Default - Headset Microphone (Jabra Link 380)', devices);
    expect(dead).toEqual(expect.arrayContaining(['default', 'communications', 'jabra']));
    expect(pickBestMic(devices, new Set(dead))?.deviceId).toBe('array');
  });

  test('when every real mic is dead there is nothing left to try', () => {
    expect(pickBestMic(devices, new Set(['jabra', 'array', 'stereo']))).toBeNull();
  });
});
