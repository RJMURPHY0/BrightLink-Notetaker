// The invented-speech filter, exercised against the real failure and against
// the speech it must never touch.
//
// The fixture at the top is the actual text that appeared attributed to Ryan
// on recording "Office Space Planning Discussion", 22 Sep 2026. Whisper was
// handed the mic channel of a Google Meet call — mostly silence, because you
// spend a call listening — and filled it with a cookery channel sign-off.
//
// Usage: npx tsx scripts/test-hallucination.ts

import {
  filterHallucinations,
  hallucinationReason,
  nonLatinFraction,
  textFromSegments,
  type ScoredSegment,
} from '../lib/hallucination';

const THE_RECIPE_OUTRO =
  'Якщо вам подобається ця рецептка, яку я робив, не забудьте поставити мені лайк і підписатися на канал, щоб не пропустити нових рецептів!';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function seg(text: string, extra: Partial<ScoredSegment> = {}): ScoredSegment {
  return { start: 0, end: 2, text, ...extra };
}

// ── Must be dropped ──────────────────────────────────────────────────────────

console.log('\ndropped:');

check(
  'the live Ukrainian recipe outro, on an English transcript',
  hallucinationReason(seg(THE_RECIPE_OUTRO), { language: 'en' }) !== null,
  true,
);

check(
  'a Russian sign-off',
  hallucinationReason(seg('Спасибо за просмотр!'), { language: 'en' }) !== null,
  true,
);

check(
  'a Japanese sign-off',
  hallucinationReason(seg('ご視聴ありがとうございました'), { language: 'en' }) !== null,
  true,
);

check(
  'a window Whisper itself calls silence',
  hallucinationReason(seg('Thank you.', { noSpeechProb: 0.94, avgLogprob: -1.2 })) !== null,
  true,
);

check(
  'a looped segment',
  hallucinationReason(seg('yeah yeah yeah yeah yeah yeah yeah yeah', { compressionRatio: 3.1 })) !== null,
  true,
);

check(
  'an English subscribe outro',
  hallucinationReason(seg('Thanks for watching!'), { language: 'en' }) !== null,
  true,
);

check(
  'a music annotation',
  hallucinationReason(seg('[MUSIC]'), { language: 'en' }) !== null,
  true,
);

// ── Must survive ─────────────────────────────────────────────────────────────

console.log('\nkept:');

check(
  'ordinary meeting speech',
  hallucinationReason(
    seg('So our business has grown over the years, we export to 67 countries.', {
      noSpeechProb: 0.02, avgLogprob: -0.18, compressionRatio: 1.4,
    }),
    { language: 'en' },
  ),
  null,
);

check(
  'a quiet but confident short answer',
  hallucinationReason(seg('Yeah, agreed.', { noSpeechProb: 0.71, avgLogprob: -0.22 }), { language: 'en' }),
  null,
);

check(
  'a confident-sounding window that is actually low confidence but not silent',
  hallucinationReason(seg('Right, so the budget.', { noSpeechProb: 0.11, avgLogprob: -0.9 }), { language: 'en' }),
  null,
);

check(
  '"thanks for watching that demo" in a real sentence',
  hallucinationReason(seg('Thanks for watching that demo, Lee, it really helped us decide.'), { language: 'en' }),
  null,
);

check(
  'an English sentence containing a non-Latin name',
  hallucinationReason(seg('We are meeting 王伟 from the Shenzhen office next Tuesday.'), { language: 'en' }),
  null,
);

check(
  'Cyrillic kept when the transcript is pinned to Ukrainian',
  hallucinationReason(seg(THE_RECIPE_OUTRO), { language: 'uk' }),
  null,
);

// ── Whole-run behaviour ──────────────────────────────────────────────────────

console.log('\nruns:');

const run = filterHallucinations(
  [
    seg('Good morning everyone.'),
    seg('Okay.'),
    seg('Okay.'),
    seg('Okay.'),
    seg('Okay.'),
    seg(THE_RECIPE_OUTRO),
    seg('Right, shall we start on the budget?'),
  ],
  { language: 'en' },
);

check('keeps two of a four-long repeat run, drops the rest', run.kept.length, 4);
check('drops the run tail and the invention', run.dropped.length, 3);
check(
  'rebuilt text contains no invented speech',
  run.kept.some((s) => s.text.includes('рецептка')),
  false,
);
check(
  'rebuilt text keeps the real speech either side',
  textFromSegments(run.kept).startsWith('Good morning everyone.')
    && textFromSegments(run.kept).endsWith('Right, shall we start on the budget?'),
  true,
);

check('nonLatinFraction on pure Cyrillic', nonLatinFraction('Спасибо') > 0.9, true);
check('nonLatinFraction on pure English', nonLatinFraction('Thanks very much'), 0);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
