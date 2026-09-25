// A meeting in which nothing (or almost nothing) was said must complete with an
// explanation, not fail into a Retry that can never succeed. Dependency-free:
// runs without a browser, database or model.
import { test, expect } from '@playwright/test';
import { speechContent, wordCount, SHORT_TRANSCRIPT_WORDS } from '../lib/speech-content';

test.describe('speechContent', () => {
  test('the 25 Sep test meeting: a lone "you" is silence, not speech', () => {
    expect(speechContent('you')).toBe('none');
    expect(speechContent(' You. ')).toBe('none');
  });

  test('empty and missing transcripts are silence', () => {
    expect(speechContent('')).toBe('none');
    expect(speechContent('   ')).toBe('none');
    expect(speechContent(null)).toBe('none');
    expect(speechContent(undefined)).toBe('none');
  });

  test('repeats of one silence artefact are still silence', () => {
    expect(speechContent('Thank you. Thank you.')).toBe('none');
    expect(speechContent('you you you')).toBe('none');
  });

  test('a mic check is real speech, just short', () => {
    expect(speechContent('Testing, testing, testing.')).toBe('short');
    expect(speechContent('you know what, send it Friday')).toBe('short');
  });

  test('a normal meeting is neither', () => {
    const meeting = Array.from({ length: SHORT_TRANSCRIPT_WORDS }, (_, i) => `word${i}`).join(' ');
    expect(speechContent(meeting)).toBeNull();
  });

  test('wordCount ignores punctuation', () => {
    expect(wordCount('Hello, world! — it’s me.')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});
