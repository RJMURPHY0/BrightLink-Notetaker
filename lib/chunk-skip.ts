// Whether the recorder may skip uploading a chunk because it held no sound.
//
// Skipping silent chunks saves a transcription call, but a wrong skip deletes
// part of a meeting with no way back, so the rule only skips when the level
// meter actually watched the window and heard nothing:
//
//  - The meter is a 100 ms timer, and browsers throttle timers in background
//    tabs (to 1/s, or 1/min under intensive throttling) and suspend audio
//    contexts on phones. The old rule divided the ticks it saw by the whole
//    window, so a meeting recorded while the user sat in the Teams tab read as
//    near-silent and whole two-minute chunks of speech were never uploaded.
//    Only windows the meter covered can be judged.
//  - "Heard" uses a low floor (AUDIBLE_RMS), not the speech threshold: a far
//    or quiet speaker on a low-gain laptop mic sits below the speech threshold
//    and is still speech.
//
// Dependency-free so it is unit-testable.

/** RMS above which a 100 ms frame counts as sound rather than room tone. */
export const AUDIBLE_RMS = 0.003;
/** Skip only below this share of audible frames. */
export const SKIP_AUDIBLE_RATIO = 0.04;
/** The meter must have watched at least this share of the window. */
export const MIN_METER_COVERAGE = 0.8;

export function shouldSkipSilentChunk(w: { durationMs: number; measuredMs: number; audibleMs: number }): boolean {
  if (w.durationMs <= 0 || w.measuredMs <= 0) return false;
  if (w.measuredMs / w.durationMs < MIN_METER_COVERAGE) return false;
  return w.audibleMs / w.measuredMs < SKIP_AUDIBLE_RATIO;
}
