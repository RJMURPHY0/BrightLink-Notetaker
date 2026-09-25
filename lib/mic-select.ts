// Best-microphone auto-detect, ported from FTC Whisper's recorder ranking
// (recorder.py _auto_rank/_pick_best_input). Name-based, no audio sampling:
// instant, deterministic, safe to run on every stream open.
//
// Lower rank is better. External mics beat the built-in array: plugging in a
// headset must switch to it even when the OS keeps the laptop mic as default.
// Bluetooth hands-free profiles late (they sound terrible), loopback/virtual
// endpoints last (they hear the speakers, not the user).

import { CONFERENCING_HINTS } from './capture-support';

export type MicDevice = { deviceId: string; label: string };

const VIRTUAL = [
  'stereo mix', 'sound mapper', 'primary sound', 'what u hear', 'wave out',
  'pc speaker', 'loopback', 'virtual', 'cable', 'eshare',
  'voicemeeter', 'vb-audio', 'obs', 'ndi',
  // Localised Windows loopback endpoints
  'stereomix', 'mixage', 'mezcla', 'missaggio', 'микшер', 'ミキサー',
  // Conferencing apps' own virtual endpoints. Same list the meeting detector
  // uses, kept in one place so the two cannot drift: here they must never be
  // picked as a microphone (they hear the speakers, not the user), there their
  // presence hints that a meeting app is installed.
  ...CONFERENCING_HINTS,
];
const BT_HANDSFREE = ['bluetooth', 'hands-free', 'hfp', ' ag audio'];
const DEDICATED = [
  'headset', 'usb audio', 'usb mic', 'webcam', 'logi', 'jabra', 'yeti',
  'rode', 'shure', 'blue ', 'elgato', 'samson', 'snowball', 'at2020',
  'fifine', 'hyperx', 'steelseries', 'airpods', 'earpods',
];
const BUILT_IN = ['microphone', 'mic', 'array'];

export function rankMic(label: string): number {
  const n = (label || '').toLowerCase();
  if (VIRTUAL.some(v => n.includes(v))) return 4;
  if (BT_HANDSFREE.some(b => n.includes(b))) return 3;
  if (DEDICATED.some(s => n.includes(s))) return 0;
  if (BUILT_IN.some(s => n.includes(s))) return 1;
  return 2;
}

// Chrome on Windows exposes pseudo entries whose deviceId is 'default' /
// 'communications' duplicating a real device. Rank only real devices; use the
// 'default' pseudo label (minus its prefix) to break ties, mirroring
// Whisper's OS-default tie-break.
//
// `exclude` holds devices already proven dead in this session (they delivered
// digital silence), so a fallback never lands back on one of them.
export function pickBestMic(devices: MicDevice[], exclude: ReadonlySet<string> = new Set()): MicDevice | null {
  const real = devices.filter(
    d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications' && !exclude.has(d.deviceId)
  );
  if (!real.length) return null;
  const defaultEntry = devices.find(d => d.deviceId === 'default');
  const defaultLabel = (defaultEntry?.label || '')
    .replace(/^default\s*-\s*/i, '')
    .trim()
    .toLowerCase();
  const bestRank = Math.min(...real.map(d => rankMic(d.label)));
  const best = real.filter(d => rankMic(d.label) === bestRank);
  if (defaultLabel) {
    const osDefault = best.find(
      d => d.label.trim().toLowerCase() === defaultLabel
    );
    if (osDefault) return osDefault;
  }
  return best[0];
}

export async function listMics(): Promise<MicDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'audioinput')
    .map(d => ({ deviceId: d.deviceId, label: d.label }));
}

// Stored preference semantics: missing or 'auto' → auto-detect best mic;
// 'system' → browser/OS default; anything else → explicit deviceId.
export async function getAudioConstraint(): Promise<MediaTrackConstraints | boolean> {
  let preferred: string | null = null;
  try {
    preferred = localStorage.getItem('preferredMicId');
  } catch {}
  if (preferred === 'system') return true;
  if (preferred && preferred !== 'auto') return { deviceId: { ideal: preferred } };
  try {
    const best = pickBestMic(await listMics());
    // Labels are empty until mic permission has been granted once; ranking
    // is meaningless then, so fall back to the default device.
    if (best && best.label) return { deviceId: { ideal: best.deviceId } };
  } catch {}
  return true;
}

/**
 * The next microphone to try once the current one has proven dead, or null
 * when every device on this machine has been tried.
 *
 * Used whatever the saved preference says: a microphone that delivers pure
 * digital silence (muted in the OS, a switched-off headset whose dongle is
 * still plugged in, a dock with nothing in its jack) records nothing, and no
 * one choosing a device means "record nothing". The recorder tells the user
 * which device it moved to.
 */
export async function getFallbackAudioConstraint(dead: ReadonlySet<string>): Promise<MediaTrackConstraints | null> {
  try {
    const next = pickBestMic(await listMics(), dead);
    if (next) return { deviceId: { exact: next.deviceId } };
  } catch {}
  return null;
}

/**
 * Every device id that is the same physical microphone as this track.
 *
 * A track opened on the OS default reports the pseudo id 'default' and a label
 * like "Default - Microphone Array (Realtek)". Marking only 'default' dead
 * would let the fallback pick the very same microphone under its real id, so
 * the real entry is matched by label too.
 */
export function sameDeviceIds(trackDeviceId: string, trackLabel: string, devices: MicDevice[]): string[] {
  const strip = (l: string) => l.replace(/^(default|communications)\s*-\s*/i, '').trim().toLowerCase();
  const label = strip(trackLabel);
  const ids = new Set<string>();
  if (trackDeviceId) ids.add(trackDeviceId);
  for (const d of devices) {
    if (label && strip(d.label) === label) ids.add(d.deviceId);
  }
  return Array.from(ids);
}
