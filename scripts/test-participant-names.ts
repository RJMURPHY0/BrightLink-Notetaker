// Platform participant names applied to transcript segments.
//
// This is the code that decides whose name appears above a quoted sentence in
// a document a customer may read, so its conservatism is the property under
// test: it must rename when the evidence is clear and refuse when it is not.
//
// Usage: npx tsx scripts/test-participant-names.ts

import {
  applySpeakingSpans,
  fillGenericsFromRoster,
  normaliseSpans,
  overlapSeconds,
  type LabelledSegment,
} from '../lib/participant-names';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function seg(speaker: string, start: number, end: number, text = 'words'): LabelledSegment {
  return { speaker, start, end, text };
}

// ── normaliseSpans ───────────────────────────────────────────────────────────

console.log('\nnormaliseSpans:');

check('merges overlapping spans', normaliseSpans([[0, 5], [3, 8]]), [[0, 8]]);
check('closes sub-250ms flicker gaps', normaliseSpans([[0, 5], [5.1, 9]]), [[0, 9]]);
check('keeps a real gap', normaliseSpans([[0, 5], [7, 9]]), [[0, 5], [7, 9]]);
check('drops reversed spans', normaliseSpans([[9, 4]]), []);
check('drops non-numeric junk', normaliseSpans([['a', 'b'], [1, 2]]), [[1, 2]]);
check('drops a 13-hour span as a unit error', normaliseSpans([[0, 13 * 3600]]), []);
check('survives a non-array', normaliseSpans('nope'), []);
check('survives null', normaliseSpans(null), []);

console.log('\noverlapSeconds:');
check('partial overlap', overlapSeconds(4, 10, [[0, 6]]), 2);
check('no overlap', overlapSeconds(20, 30, [[0, 6]]), 0);
check('sums across spans', overlapSeconds(0, 10, [[0, 2], [4, 6]]), 4);

// ── applySpeakingSpans ───────────────────────────────────────────────────────

console.log('\napplySpeakingSpans:');

{
  const { segments, stats } = applySpeakingSpans(
    [seg('Speaker 1', 0, 10), seg('Speaker 2', 10, 20)],
    [
      { name: 'Jason Clarke', speakingSpans: [[0, 10]] },
      { name: 'Lee Ndlovu', speakingSpans: [[10, 20]] },
    ],
  );
  check('clean turns get real names', segments.map((s) => s.speaker), ['Jason Clarke', 'Lee Ndlovu']);
  check('counts the renames', stats.renamed, 2);
}

{
  // Two people talking across the same window: neither owns it clearly.
  const { segments } = applySpeakingSpans(
    [seg('Speaker 1', 0, 10)],
    [
      { name: 'Jason Clarke', speakingSpans: [[0, 5.5]] },
      { name: 'Lee Ndlovu', speakingSpans: [[4.5, 10]] },
    ],
  );
  check('crosstalk keeps the acoustic label', segments[0].speaker, 'Speaker 1');
}

{
  // Someone spoke over only a third of the segment.
  const { segments } = applySpeakingSpans(
    [seg('Speaker 1', 0, 30)],
    [{ name: 'Jason Clarke', speakingSpans: [[0, 9]] }],
  );
  check('weak overlap keeps the acoustic label', segments[0].speaker, 'Speaker 1');
}

{
  const { segments, stats } = applySpeakingSpans(
    [seg('Speaker 1', 0, 10)],
    [{ name: 'Jason Clarke', speakingSpans: [] }],
  );
  check('a roster with no spans changes nothing', segments[0].speaker, 'Speaker 1');
  check('and reports the person as silent', stats.silent, ['Jason Clarke']);
}

{
  // A name already established by voiceprint, confirmed by the platform.
  const { segments, stats } = applySpeakingSpans(
    [seg('Ryan Murphy', 0, 10)],
    [{ name: 'Ryan Murphy', speakingSpans: [[0, 10]] }],
  );
  check('an already-correct name is not counted as a rename', stats.renamed, 0);
  check('and is left as it was', segments[0].speaker, 'Ryan Murphy');
}

// ── fillGenericsFromRoster ───────────────────────────────────────────────────

console.log('\nfillGenericsFromRoster:');

{
  const { segments, assigned } = fillGenericsFromRoster(
    [seg('Ryan Murphy', 0, 5), seg('Speaker 2', 5, 10), seg('Speaker 3', 10, 15)],
    [
      { name: 'Ryan Murphy' }, { name: 'Jason Clarke' }, { name: 'Lee Ndlovu' },
    ],
  );
  check(
    'exactly-matching counts resolve in first-appearance order',
    assigned,
    { 'Speaker 2': 'Jason Clarke', 'Speaker 3': 'Lee Ndlovu' },
  );
  check('and the segments carry the names', segments.map((s) => s.speaker),
    ['Ryan Murphy', 'Jason Clarke', 'Lee Ndlovu']);
}

{
  // Four attendees, two unnamed clusters — one of them never spoke, and
  // guessing which would be a coin flip.
  const { assigned } = fillGenericsFromRoster(
    [seg('Speaker 1', 0, 5), seg('Speaker 2', 5, 10)],
    [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
  );
  check('mismatched counts refuse to guess', assigned, {});
}

{
  const { assigned } = fillGenericsFromRoster(
    [seg('Ryan Murphy', 0, 5), seg('Jason Clarke', 5, 10)],
    [{ name: 'Ryan Murphy' }, { name: 'Jason Clarke' }],
  );
  check('nothing generic left means nothing to do', assigned, {});
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
