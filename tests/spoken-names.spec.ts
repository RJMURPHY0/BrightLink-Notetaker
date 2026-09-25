// Pure unit tests for the people picker's voice path (lib/spoken-names.ts).
// Runs under the Playwright runner like tests/scale-and-recovery.spec.ts: no
// browser, no server.
import { test, expect } from '@playwright/test';
import { parseSpokenNames, splitName } from '../lib/spoken-names';
import { eventForRecording, type CalendarEvent } from '../lib/crm-calendar';

const names = (s: string) => parseSpokenNames(s).map((n) => (n.company ? `${n.name} @ ${n.company}` : n.name));

test.describe('parseSpokenNames', () => {
  test('the phrase Ryan uses', () => {
    expect(names('Milly, John, Lee were in this meeting')).toEqual(['Milly', 'John', 'Lee']);
    expect(names('Milly, John and Lee were in this meeting')).toEqual(['Milly', 'John', 'Lee']);
  });

  test('the person recording is never a name', () => {
    expect(names('it was me and Lee')).toEqual(['Lee']);
    expect(names('myself, Sean and Corey')).toEqual(['Sean', 'Corey']);
  });

  test('full names and case from speech engines', () => {
    expect(names('lee brookes and milly moss')).toEqual(['Lee Brookes', 'Milly Moss']);
    expect(names("Sean O'Neill, Mary-Jane Hart")).toEqual(["Sean O'Neill", 'Mary-Jane Hart']);
  });

  test('a company said with the name becomes a hint', () => {
    expect(names('Dave from Kridan Handling and Lee')).toEqual(['Dave @ Kridan Handling', 'Lee']);
    expect(names('the call was with Lee at Wincanton')).toEqual(['Lee @ Wincanton']);
  });

  test('filler alone yields nothing', () => {
    expect(names('were in this meeting')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('  ,  and  ')).toEqual([]);
  });

  test('repeats collapse', () => {
    expect(names('Lee, Lee and John')).toEqual(['Lee', 'John']);
  });

  test('run-on speech is cut to a name', () => {
    expect(names('Jason Griffin who runs the whole operations side')).toEqual(['Jason Griffin']);
  });
});

test('splitName', () => {
  expect(splitName('Lee Smith')).toEqual({ first: 'Lee', last: 'Smith' });
  expect(splitName('Milly')).toEqual({ first: 'Milly', last: '' });
  expect(splitName('Mary Jane Hart')).toEqual({ first: 'Mary', last: 'Jane Hart' });
});


test.describe('eventForRecording', () => {
  const ev = (id: string, start: string, end: string, allDay = false): CalendarEvent => ({
    id, provider: 'microsoft', title: id, start, end, allDay, attendees: [], organizer: null, joinUrl: null, webLink: null, location: null,
  });
  const events = [
    ev('standup', '2026-09-24T09:00:00Z', '2026-09-24T09:15:00Z'),
    ev('sales', '2026-09-24T14:30:00Z', '2026-09-24T15:30:00Z'),
    ev('holiday', '2026-09-24T00:00:00Z', '2026-09-25T00:00:00Z', true),
  ];
  test('picks the meeting running when the recording started, with grace for starting late or early', () => {
    expect(eventForRecording(events, new Date('2026-09-24T14:40:14Z'))?.id).toBe('sales');
    expect(eventForRecording(events, new Date('2026-09-24T14:20:00Z'))?.id).toBe('sales');
    expect(eventForRecording(events, new Date('2026-09-24T09:05:00Z'))?.id).toBe('standup');
  });
  test('never an all-day event, and nothing when no meeting was on', () => {
    expect(eventForRecording(events, new Date('2026-09-24T12:00:00Z'))).toBeNull();
  });
});
