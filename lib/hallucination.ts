// Whisper invents speech in silence, and what it invents is YouTube.
//
// Trained on a very large pile of auto-generated video subtitles, Whisper has
// learned that a stretch of audio with no words in it is usually the end of a
// video, and the end of a video is usually somebody asking you to like and
// subscribe. Handed near-silence it therefore emits, with total confidence, a
// sign-off in whatever language that sign-off was most common in — very often
// Russian or Ukrainian, because those subtitle corpora are enormous.
//
// Observed live on recording "Office Space Planning Discussion", 22 Sep 2026:
// the mic channel of a Google Meet call was attributed to Ryan and read
//
//   "Якщо вам подобається ця рецептка, яку я робив, не забудьте поставити
//    мені лайк і підписатися на канал, щоб не пропустити нових рецептів!"
//
//   ("If you liked this recipe I made, don't forget to like and subscribe so
//    you don't miss any new recipes!")
//
// Nobody said that, in any language. The mic channel of an online meeting is
// the worst case for this by construction: you spend most of a call listening,
// so your own channel is mostly silence, which is exactly the input that
// triggers the failure.
//
// Two defences, in order of how much they buy:
//
//   1. Pin the language (lib/ai.ts). Auto-detect is re-run per chunk and a
//      chunk of room tone can detect as anything; pinning removes the entire
//      class of foreign-language inventions at the source.
//   2. This module, for what still gets through in the expected language.
//
// The tests are structural rather than a list of banned sentences, because a
// blocklist only ever catches the hallucination you have already seen. Whisper
// itself reports the three numbers that give it away, and a script mismatch
// catches every non-Latin invention at once without naming any of them.

/** A segment as Whisper's `verbose_json` returns it, with its own confidence. */
export interface ScoredSegment {
  start: number;
  end: number;
  text: string;
  /** P(this window contains no speech). Whisper's own estimate. */
  noSpeechProb?: number;
  /** Mean log-probability of the emitted tokens. Near 0 is confident. */
  avgLogprob?: number;
  /** gzip ratio of the text. High means the model looped. */
  compressionRatio?: number;
}

export interface FilterOptions {
  /** ISO 639-1 code the transcription was pinned to, e.g. 'en'. */
  language?: string;
}

export interface FilterResult<T> {
  kept: T[];
  dropped: Array<{ segment: T; reason: string }>;
}

// Whisper's own published decoding heuristic: a window is treated as silence
// when it both looks like silence and was transcribed without confidence.
// Either signal alone is too noisy — a quiet but real "yeah" scores badly on
// avg_logprob, and a confident short answer can score high on no_speech_prob.
const NO_SPEECH_PROB = parseFloat(process.env.HALLUCINATION_NO_SPEECH_PROB ?? '0.6');
const AVG_LOGPROB = parseFloat(process.env.HALLUCINATION_AVG_LOGPROB ?? '-0.7');

// gzip ratio above this means the text is mostly a repeat of itself: the
// "thank you. thank you. thank you." failure. Whisper's own reference
// implementation uses 2.4 for the same decision.
const COMPRESSION_RATIO = parseFloat(process.env.HALLUCINATION_COMPRESSION_RATIO ?? '2.4');

// Fraction of a segment's letters that may fall outside the pinned language's
// script before the segment is treated as invented. Well above zero so a real
// borrowed word, a name or an emoji cannot trip it.
const SCRIPT_MISMATCH = parseFloat(process.env.HALLUCINATION_SCRIPT_MISMATCH ?? '0.3');

// Latin plus the accented range, which covers every language this product is
// sold in. Used only to decide whether text is in the pinned script at all,
// never to judge whether it is correct.
const LATIN = /[A-Za-zÀ-ɏ]/;
const NON_LATIN_SCRIPT = /[Ѐ-ӿͰ-Ͽ֐-׿؀-ۿऀ-ॿ぀-ヿ㐀-鿿가-힯]/;

const LATIN_SCRIPT_LANGUAGES = new Set([
  'en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'da', 'sv', 'no', 'nn', 'fi',
  'is', 'pl', 'cs', 'sk', 'sl', 'hr', 'hu', 'ro', 'tr', 'lt', 'lv', 'et',
  'ga', 'cy', 'ca', 'gl', 'eu', 'af', 'sw', 'id', 'ms', 'tl', 'vi',
]);

// The sign-offs Whisper reaches for in English when handed silence. Kept short
// and anchored to a whole segment: these are only ever dropped when they are
// the entire segment, so a real "thanks for watching that demo, Lee" survives.
const SIGN_OFFS = [
  'thanks for watching',
  'thank you for watching',
  'thanks for listening',
  'thank you for listening',
  'please subscribe',
  'subscribe to my channel',
  'subscribe to our channel',
  'like and subscribe',
  "don't forget to subscribe",
  'do not forget to subscribe',
  'see you in the next video',
  'see you next video',
  'see you in the next one',
  'amara.org',
  'subtitles by',
  'subtitled by',
  'transcribed by',
  'subtitles created by',
  'captions by',
  'the end',
  'bye bye',
];

// Non-speech annotations Whisper emits for music and noise. Real speech never
// consists solely of one of these.
const ANNOTATION = /^[\[(（【]?\s*(music|musique|музыка|applause|laughter|silence|inaudible|blank_audio|no audio|sound|noise|upbeat music|outro music|intro music|background music)\s*[\])）】]?[.!]?$/i;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'. ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.]+$/, '');
}

/** Share of a string's letters that belong to a non-Latin script. */
export function nonLatinFraction(text: string): number {
  let letters = 0;
  let foreign = 0;
  for (const ch of text) {
    if (NON_LATIN_SCRIPT.test(ch)) {
      letters++;
      foreign++;
    } else if (LATIN.test(ch)) {
      letters++;
    }
  }
  return letters === 0 ? 0 : foreign / letters;
}

/**
 * Why this segment is not real speech, or null if it survives.
 *
 * Exported on its own so the offline replay scripts can explain a decision
 * without re-running a transcription.
 */
export function hallucinationReason(
  seg: ScoredSegment,
  opts: FilterOptions = {},
): string | null {
  const text = seg.text.trim();
  if (!text) return 'empty';

  // 1. The model's own verdict. Both signals must agree.
  if (
    seg.noSpeechProb !== undefined && seg.noSpeechProb > NO_SPEECH_PROB &&
    seg.avgLogprob !== undefined && seg.avgLogprob < AVG_LOGPROB
  ) {
    return `silence (no_speech=${seg.noSpeechProb.toFixed(2)}, logprob=${seg.avgLogprob.toFixed(2)})`;
  }

  // 2. Runaway repetition inside one segment.
  if (seg.compressionRatio !== undefined && seg.compressionRatio > COMPRESSION_RATIO) {
    return `looped (compression=${seg.compressionRatio.toFixed(2)})`;
  }

  // 3. Wrong script for the language we pinned. This is the one that catches
  //    the Ukrainian recipe outro, and every future invention in Cyrillic,
  //    Greek, Hebrew, Arabic, Devanagari, Japanese, Chinese or Korean, without
  //    anyone having to write them down first.
  const lang = (opts.language ?? '').slice(0, 2).toLowerCase();
  if (lang && LATIN_SCRIPT_LANGUAGES.has(lang)) {
    const foreign = nonLatinFraction(text);
    if (foreign > SCRIPT_MISMATCH) {
      return `wrong script for ${lang} (${Math.round(foreign * 100)}% non-Latin)`;
    }
  }

  // 4. A whole segment that is nothing but a video sign-off.
  const flat = normalise(text);
  if (flat && SIGN_OFFS.some((p) => flat === p || flat.startsWith(`${p} `) && flat.length < p.length + 25)) {
    return 'video sign-off';
  }

  // 5. A non-speech annotation standing alone.
  if (ANNOTATION.test(text)) return 'non-speech annotation';

  return null;
}

/**
 * Drop invented segments, and collapse a run of the same segment repeated.
 *
 * Returns what was dropped as well as what was kept so the caller can log it:
 * a filter that silently eats real speech is worse than the hallucination it
 * was added to remove, and the only way to notice is to be able to see it.
 */
export function filterHallucinations<T extends ScoredSegment>(
  segments: T[],
  opts: FilterOptions = {},
): FilterResult<T> {
  const kept: T[] = [];
  const dropped: Array<{ segment: T; reason: string }> = [];

  // A phrase repeated back to back across segments is the other loop shape,
  // and no per-segment number catches it. Three in a row is the threshold:
  // two consecutive "yeah"s happen in real conversation, ten do not.
  let runText = '';
  let runCount = 0;

  for (const seg of segments) {
    const reason = hallucinationReason(seg, opts);
    if (reason) {
      dropped.push({ segment: seg, reason });
      continue;
    }

    const flat = normalise(seg.text);
    if (flat && flat === runText) {
      runCount++;
      // Keep the first two, drop the rest of the run.
      if (runCount > 2) {
        dropped.push({ segment: seg, reason: `repeated x${runCount}` });
        continue;
      }
    } else {
      runText = flat;
      runCount = 1;
    }

    kept.push(seg);
  }

  return { kept, dropped };
}

/** Rebuild the flat transcript text from whatever survived. */
export function textFromSegments(segments: Array<{ text: string }>): string {
  return segments.map((s) => s.text.trim()).filter(Boolean).join(' ').trim();
}
