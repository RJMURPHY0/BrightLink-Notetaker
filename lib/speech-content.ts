// How much was actually said in a transcript, and what to tell the user when
// the answer is "not enough to summarise".
//
// Observed 25 Sep 2026: a quick test meeting ("testing testing testing") came
// back with the transcript "you" and the page read "Analysis failed — check
// your API keys". The keys were fine. "you" is what Whisper emits when handed
// near-silence, so the microphone had delivered nothing usable, and the
// analysis step then failed the recording because there was nothing to
// summarise — telling the user to fix the wrong thing, and offering a Retry
// that could never succeed.
//
// A meeting with no speech is not a failed meeting. It completes, and the notes
// say plainly what happened. Dependency-free so it is unit-testable.

/** Below this many words, a failed summary is treated as "too little said". */
export const SHORT_TRANSCRIPT_WORDS = 40;

// Whole-transcript outputs Whisper produces for silence or room tone. Matched
// only against the ENTIRE transcript, never a segment inside a real meeting,
// so a genuine "thank you" in conversation is untouched.
const SILENCE_ONLY = new Set([
  'you',
  'thank you',
  'thanks',
  'bye',
  'okay',
  'so',
  'uh',
  'um',
  'hmm',
]);

export function normaliseTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}' ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(text: string): number {
  const flat = normaliseTranscript(text);
  return flat ? flat.split(' ').length : 0;
}

/**
 * 'none' — nothing that looks like speech (empty, or only a silence artefact).
 * 'short' — real words, but few enough that an empty summary is expected.
 * null — a normal meeting; an analysis failure is a real failure.
 */
export function speechContent(text: string | null | undefined): 'none' | 'short' | null {
  const flat = normaliseTranscript(text ?? '');
  if (!flat) return 'none';
  // Repeats of one artefact ("you you", "thank you thank you") are still silence.
  const collapsed = flat.replace(/\b(.+?)(?: \1\b)+/g, '$1');
  if (SILENCE_ONLY.has(collapsed)) return 'none';
  return wordCount(flat) < SHORT_TRANSCRIPT_WORDS ? 'short' : null;
}

export const NO_SPEECH_OVERVIEW =
  'No speech was detected in this recording. If people were talking, the microphone was probably muted or the wrong one was selected — check the microphone choice in Settings and record again.';

export const SHORT_RECORDING_OVERVIEW =
  'Short recording — too little was said to produce notes. The full transcript is on the right.';
