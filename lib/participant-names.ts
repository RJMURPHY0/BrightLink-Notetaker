// Turning a platform's participant list into speaker labels.
//
// The existing pipeline names speakers two ways, both of them inferences:
// acoustic voice-ID clusters turns by voiceprint (lib/voice-id.ts), and an LLM
// reads self-introductions out of the transcript ("Hi, I'm Dave"). Both are
// good. Neither can be right more often than the meeting platform, which knows
// every attendee's display name because it printed it under their tile.
//
// So when a roster exists, it wins. This module decides how.
//
// Dependency-free on purpose — no Prisma, no React, no sherpa-onnx — so the
// overlap arithmetic can be tested on plain objects. That mirrors
// lib/recording-access.ts, and the same reason applies: this decides what name
// a person's words are published under, and it should be possible to prove it
// correct without a database.

/** [start, end] in seconds from the start of the recording. */
export type SpeakingSpan = [number, number];

export interface Participant {
  name: string;
  isHost?: boolean;
  speakingSpans?: SpeakingSpan[];
}

export interface LabelledSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

/**
 * Coerce untrusted span input into sorted, merged, finite pairs.
 *
 * The input comes off a DOM scraper in a page we do not control, so every
 * value here is assumed hostile until proven numeric.
 */
export function normaliseSpans(input: unknown): SpeakingSpan[] {
  if (!Array.isArray(input)) return [];
  const spans: SpeakingSpan[] = [];
  for (const raw of input) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const start = Number(raw[0]);
    const end = Number(raw[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= start || start < 0) continue;
    // A span longer than 12 hours is a unit error, not a monologue.
    if (end - start > 12 * 3600) continue;
    spans.push([start, end]);
  }
  if (!spans.length) return [];

  spans.sort((a, b) => a[0] - b[0]);
  const merged: SpeakingSpan[] = [spans[0]];
  for (const [start, end] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    // Gaps under a quarter-second are the DOM's active-speaker highlight
    // flickering, not two separate turns.
    if (start <= last[1] + 0.25) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Seconds of overlap between a segment and a set of spans. */
export function overlapSeconds(
  segStart: number,
  segEnd: number,
  spans: SpeakingSpan[],
): number {
  let total = 0;
  for (const [start, end] of spans) {
    if (end <= segStart) continue;
    if (start >= segEnd) break; // spans are sorted
    total += Math.min(segEnd, end) - Math.max(segStart, start);
  }
  return total > 0 ? total : 0;
}

// A segment is only renamed when one participant clearly owns it. Below this
// share of the segment's own duration, the highlight and the audio disagree
// enough that the existing acoustic label is the safer answer.
const MIN_OVERLAP_FRACTION = 0.5;
// And the winner must beat the runner-up by this much, or two people were
// talking over each other and neither name is safe to assert.
const MIN_MARGIN = 0.2;

export interface AttributionStats {
  renamed: number;
  unchanged: number;
  /** Participants who were present but never matched a segment. */
  silent: string[];
}

/**
 * Relabel transcript segments from the platform's active-speaker spans.
 *
 * Deliberately conservative: an ambiguous segment keeps whatever the acoustic
 * pipeline called it. A wrong name on a quotable sentence is far more damaging
 * than a "Speaker 2" the user can fix in one click, and this runs on meetings
 * that get forwarded to customers.
 */
export function applySpeakingSpans(
  segments: LabelledSegment[],
  participants: Participant[],
): { segments: LabelledSegment[]; stats: AttributionStats } {
  const withSpans = participants
    .map((p) => ({ name: p.name, spans: normaliseSpans(p.speakingSpans) }))
    .filter((p) => p.spans.length > 0);

  if (!withSpans.length) {
    return {
      segments,
      stats: { renamed: 0, unchanged: segments.length, silent: participants.map((p) => p.name) },
    };
  }

  const matched = new Set<string>();
  let renamed = 0;

  const out = segments.map((seg) => {
    const duration = seg.end - seg.start;
    if (duration <= 0) return seg;

    let best = { name: '', overlap: 0 };
    let second = 0;
    for (const p of withSpans) {
      const overlap = overlapSeconds(seg.start, seg.end, p.spans);
      if (overlap > best.overlap) {
        second = best.overlap;
        best = { name: p.name, overlap };
      } else if (overlap > second) {
        second = overlap;
      }
    }

    const share = best.overlap / duration;
    const margin = (best.overlap - second) / duration;
    if (!best.name || share < MIN_OVERLAP_FRACTION || margin < MIN_MARGIN) return seg;

    matched.add(best.name);
    if (seg.speaker === best.name) return seg;
    renamed++;
    return { ...seg, speaker: best.name };
  });

  return {
    segments: out,
    stats: {
      renamed,
      unchanged: out.length - renamed,
      silent: withSpans.filter((p) => !matched.has(p.name)).map((p) => p.name),
    },
  };
}

/**
 * Map leftover "Speaker N" labels onto roster names when the count lines up.
 *
 * Runs after applySpeakingSpans for the case where a roster exists but no
 * speaking spans do — a Zoom call the extension could see the participant list
 * of but not the active-speaker highlight. With exactly as many unnamed
 * clusters as unclaimed attendees there is only one assignment available, and
 * taking it beats leaving the transcript full of "Speaker 3".
 *
 * Any other count is left alone: a guess that happens to be wrong is worse
 * than an honest generic label.
 */
export function fillGenericsFromRoster(
  segments: LabelledSegment[],
  participants: Participant[],
): { segments: LabelledSegment[]; assigned: Record<string, string> } {
  const generic = /^Speaker \d+$/;
  const unnamed = [...new Set(segments.map((s) => s.speaker).filter((s) => generic.test(s)))];
  if (!unnamed.length) return { segments, assigned: {} };

  const taken = new Set(segments.map((s) => s.speaker).filter((s) => !generic.test(s)));
  const available = participants.map((p) => p.name).filter((n) => !taken.has(n));

  if (available.length !== unnamed.length) return { segments, assigned: {} };

  // Order both sides deterministically: clusters by first appearance, names by
  // the roster's own order, so the same meeting always resolves the same way.
  const firstSeen = new Map<string, number>();
  segments.forEach((s, i) => {
    if (!firstSeen.has(s.speaker)) firstSeen.set(s.speaker, i);
  });
  unnamed.sort((a, b) => (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0));

  const assigned: Record<string, string> = {};
  unnamed.forEach((label, i) => { assigned[label] = available[i]; });

  return {
    segments: segments.map((s) => (assigned[s.speaker] ? { ...s, speaker: assigned[s.speaker] } : s)),
    assigned,
  };
}
