// "Milly, John and Lee were in this meeting" -> [Milly, John, Lee].
//
// The people picker's voice path. Deterministic on purpose: no model call, so
// it is instant and free, and what it does is testable. It only has to find
// the NAMES; deciding who each name is happens in the database
// (meeting_people_match), which knows the colleagues and the contacts.
//
// Rules:
//   - A list is split on commas, "and", "&", "plus", "with", "also", "as well as".
//   - Filler words ("were in this meeting", "it was me", "the call had") are
//     dropped. "me", "I", "myself" are the person recording, never a name.
//   - "Dave from Kridan" / "Dave at Kridan Handling" keeps the company as a
//     hint, so the match can tell two Daves apart.
//   - A name is at most three words; longer leftovers are cut to the first two
//     (speech engines sometimes run a sentence on).

export interface SpokenName {
  /** As it will be shown: "Lee Smith". */
  name: string;
  /** "from/at <company>", when said. */
  company?: string;
}

const SPLIT = /\s*(?:,|;|\n|&|\+|\band\b|\bplus\b|\balso\b|\bas well as\b|\balongside\b|\bwith\b)\s*/i;

const FILLER = new Set([
  'i', 'me', 'myself', 'we', 'us', 'our', 'my', 'you',
  'was', 'were', 'is', 'are', 'be', 'been', 'had', 'has', 'have', 'did', 'got',
  'in', 'on', 'this', 'that', 'the', 'a', 'an', 'of', 'for', 'to', 'there', 'here',
  'meeting', 'meetings', 'call', 'calls', 'chat', 'catch', 'catchup', 'catch-up', 'session', 'demo',
  'teams', 'zoom', 'meet', 'today', 'earlier', 'just', 'only', 'both', 'all', 'everyone',
  'people', 'person', 'who', 'it', "it's", 'its', 'so', 'ok', 'okay', 'yeah', 'yes', 'um', 'uh',
  'er', 'erm', 'oh', 'right', 'well', 'then', 'too', 'joined', 'attended', 'present',
  'met', 'spoke', 'talked', 'guys', 'team', 'from', 'at', 'by', 'invited', 'came', 'along',
  "there's", 'theres', "that's", 'thats', 'there', 'also', 'plus',
]);

const COMPANY_MARK = /\b(?:from|at|of)\b/i;

function tidy(word: string): string {
  return word.replace(/^[^\p{L}'-]+|[^\p{L}'-]+$/gu, '');
}

function titleCase(word: string): string {
  if (!word) return word;
  // Keep a deliberate mixed case (McDonald, DeVito) as spoken.
  if (/[a-z]/.test(word) && /[A-Z]/.test(word.slice(1))) return word;
  return word
    .split(/([-'])/)
    .map((part) => (part === '-' || part === "'" ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

function nameWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map(tidy)
    .filter((w) => w.length > 0 && !FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w));
}

export function parseSpokenNames(text: string): SpokenName[] {
  const out: SpokenName[] = [];
  const seen = new Set<string>();
  for (const chunk of (text ?? '').split(SPLIT)) {
    if (!chunk || !chunk.trim()) continue;

    // "Dave from Kridan Handling": the words after the marker are the company.
    let personPart = chunk;
    let company: string | undefined;
    const mark = COMPANY_MARK.exec(chunk);
    if (mark && mark.index > 0) {
      personPart = chunk.slice(0, mark.index);
      const companyWords = chunk
        .slice(mark.index + mark[0].length)
        .split(/\s+/)
        .map(tidy)
        .filter((w) => w.length > 0 && !['the', 'a', 'an', 'meeting', 'call', 'were', 'was', 'there', 'in', 'this'].includes(w.toLowerCase()));
      // Stop at filler that ends the phrase ("from Kridan were in the call").
      const stop = companyWords.findIndex((w) => FILLER.has(w.toLowerCase()));
      const kept = stop === -1 ? companyWords : companyWords.slice(0, stop);
      if (kept.length > 0) company = kept.map(titleCase).join(' ');
    }

    let words = nameWords(personPart);
    if (words.length === 0) continue;
    if (words.length > 3) words = words.slice(0, 2);
    const name = words.map(titleCase).join(' ');
    const key = `${name.toLowerCase()}|${(company ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(company ? { name, company } : { name });
  }
  return out;
}

/** "Lee Smith" -> { first: "Lee", last: "Smith" }. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}
