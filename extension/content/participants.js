// Read the participant list, and who is talking, out of the meeting page.
//
// This is the part that makes the extension worth building. Acoustic
// diarisation can say "these turns are the same voice"; it cannot say the
// voice belongs to Jason. The page can — it has been printing his name under
// his tile for the whole call.
//
// Two different qualities of signal, and it matters not to conflate them:
//
//   THE ROSTER is reliable. Every platform renders attendee names as ordinary
//   text, and a name is a name however the layout changes. Even with nothing
//   else, the roster turns "Speaker 2" into a real name whenever the counts
//   line up (see lib/participant-names.ts), and gives the summariser real
//   candidates to match self-introductions against.
//
//   WHO IS SPEAKING is best-effort. Every platform signals it through styling
//   whose class names are obfuscated and rebuilt on their release schedule.
//   So it is read through several independent candidates and, when none of
//   them match, this script reports the roster with no speaking spans and the
//   server falls back to the acoustic pipeline. That degradation is the design,
//   not an oversight: a wrong name on a quotable sentence is worse than a
//   generic label the user can fix in one click.
//
// For attribution that is exact rather than inferred, the bot path exists —
// Recall.ai gets a separate audio stream per participant from the platform
// itself. This is the good-and-free tier, not the perfect one.

const POLL_MS = 500;
const ROSTER_PUSH_MS = 20_000;

/** name -> { isHost, spans: [[startMs, endMs], ...], openedAt: number|null } */
const people = new Map();
let lastPush = 0;
let pollTimer = null;

// ── Platform adapters ────────────────────────────────────────────────────────
//
// Each returns a list of { name, isHost, speaking }. `selectors` are tried in
// order and the first that yields anything wins, so an obsolete selector that
// now matches nothing costs a few microseconds rather than the feature.

const host = location.hostname;

function text(el) {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Names that are UI chrome rather than people. */
const NOT_A_NAME = /^(you|presenting|pinned|host|co-host|muted|unmuted|guest|participants?|\d+|more options|·|,)$/i;

function cleanName(raw) {
  let n = (raw ?? '').replace(/\s+/g, ' ').trim();
  // Trailing status chips the platforms append inside the same node.
  n = n.replace(/\s*\((you|host|co-host|guest|presenting|meeting host)\)\s*$/i, '');
  n = n.replace(/\s*\b(is )?(muted|unmuted|presenting|pinned|speaking)\b\s*$/i, '');
  n = n.trim().replace(/[,·|]+$/, '').trim();
  if (!n || n.length > 100) return '';
  if (NOT_A_NAME.test(n)) return '';
  // A name with no letters at all is an icon's alt text.
  if (!/\p{L}/u.test(n)) return '';
  return n;
}

const ADAPTERS = {
  meet() {
    // Meet keeps one element per participant carrying a stable data attribute.
    // The attribute has outlived several visual redesigns; the class names
    // inside it have not.
    const tiles = document.querySelectorAll('[data-participant-id]');
    const out = [];
    for (const tile of tiles) {
      const nameEl = tile.querySelector('[data-self-name]')
        ?? tile.querySelector('[data-tooltip]')
        ?? tile;
      const name = cleanName(
        nameEl.getAttribute?.('data-self-name')
        ?? nameEl.getAttribute?.('data-tooltip')
        ?? text(nameEl),
      );
      if (!name) continue;
      out.push({ name, isHost: false, speaking: meetIsSpeaking(tile) });
    }
    if (out.length) return out;

    // Fallback: the participants side panel, which is plain list markup.
    return [...document.querySelectorAll('[role="listitem"]')]
      .map((li) => ({ name: cleanName(text(li.querySelector('span') ?? li)), isHost: false, speaking: false }))
      .filter((p) => p.name);
  },

  teams() {
    // Teams marks the roster rows with a stable automation id.
    const rows = document.querySelectorAll(
      '[data-tid="participant-item"], [data-tid="roster-participant"], [data-tid^="participantsInCall"] [role="listitem"]',
    );
    const out = [];
    for (const row of rows) {
      const name = cleanName(
        row.getAttribute('aria-label') ?? text(row.querySelector('[data-tid="roster-name"]') ?? row),
      );
      if (!name) continue;
      out.push({ name, isHost: /organiser|organizer|host/i.test(row.getAttribute('aria-label') ?? ''), speaking: teamsIsSpeaking(row) });
    }
    if (out.length) return out;

    // Fallback: the video tiles, which carry the displayed name.
    return [...document.querySelectorAll('[data-tid="video-tile"], [data-stream-type]')]
      .map((t) => ({ name: cleanName(t.getAttribute('aria-label') ?? text(t)), isHost: false, speaking: false }))
      .filter((p) => p.name);
  },

  zoom() {
    const rows = document.querySelectorAll(
      '.participants-item__display-name, .participants-li .participants-item__display-name',
    );
    const out = [...rows]
      .map((el) => ({ name: cleanName(text(el)), isHost: false, speaking: false }))
      .filter((p) => p.name);
    if (out.length) return out;

    return [...document.querySelectorAll('[class*="video-avatar__participant-name"], .speaker-active-container__video-frame')]
      .map((el) => ({ name: cleanName(text(el)), isHost: false, speaking: false }))
      .filter((p) => p.name);
  },

  generic() {
    return [];
  },
};

// ── Speaking detection ───────────────────────────────────────────────────────
//
// Each platform animates something while a person talks. None of it is a
// documented API, so every check is guarded and a miss simply reads as "not
// speaking", which loses attribution rather than inventing it.

function meetIsSpeaking(tile) {
  try {
    // Meet renders animated level bars inside the speaking participant's tile
    // and removes them otherwise. The wrapper carries a jsname that has been
    // stable far longer than the class names around it.
    if (tile.querySelector('[jsname="A5oCVe"], [class*="wEsLMd"]')) return true;
    // Some layouts instead expose it on the tile's own aria-label.
    const label = tile.getAttribute('aria-label') ?? '';
    return /\bspeaking\b/i.test(label);
  } catch { return false; }
}

function teamsIsSpeaking(row) {
  try {
    if (row.querySelector('[data-tid="voice-level-stream-outline"], [class*="speaking"]')) return true;
    const label = row.getAttribute('aria-label') ?? '';
    return /\bspeaking\b/i.test(label);
  } catch { return false; }
}

function adapter() {
  if (host.includes('meet.google.com')) return ADAPTERS.meet;
  if (host.includes('teams.')) return ADAPTERS.teams;
  if (host.includes('zoom.us')) return ADAPTERS.zoom;
  return ADAPTERS.generic;
}

// ── Polling ──────────────────────────────────────────────────────────────────

function sample() {
  let seen;
  try {
    seen = adapter()();
  } catch (e) {
    // A page structure we no longer understand must not break the recording.
    console.warn('[ftc] roster read failed:', e.message);
    return;
  }

  const now = Date.now();
  const speakingNow = new Set();

  for (const { name, isHost, speaking } of seen) {
    const entry = people.get(name) ?? { isHost: false, spans: [], openedAt: null };
    entry.isHost = entry.isHost || isHost;
    people.set(name, entry);
    if (speaking) speakingNow.add(name);
  }

  // Close and open spans on the transition, so a span is a real turn rather
  // than one row per poll.
  for (const [name, entry] of people) {
    const talking = speakingNow.has(name);
    if (talking && entry.openedAt === null) {
      entry.openedAt = now;
    } else if (!talking && entry.openedAt !== null) {
      // Turns shorter than the poll interval are highlight flicker.
      if (now - entry.openedAt >= POLL_MS) entry.spans.push([entry.openedAt, now]);
      entry.openedAt = null;
    }
  }

  if (now - lastPush >= ROSTER_PUSH_MS) push(false);
}

function snapshot(final) {
  const now = Date.now();
  return [...people.entries()].map(([name, entry]) => {
    const spans = [...entry.spans];
    // A span still open when the meeting ends is a real turn.
    if (final && entry.openedAt !== null) spans.push([entry.openedAt, now]);
    return { name, isHost: entry.isHost, speakingSpans: spans };
  });
}

function push(final) {
  const participants = snapshot(final);
  if (!participants.length) return;
  lastPush = Date.now();
  chrome.runtime.sendMessage({ type: 'ftc-participants', participants, final }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ftc-collect') {
    sample();
    push(!!msg.final);
    sendResponse({ ok: true, count: people.size });
  }
  return true;
});

// Polling rather than a MutationObserver: these pages mutate thousands of
// times a second while video is running, and an observer would fire far more
// often than the twice a second this actually needs.
pollTimer = setInterval(sample, POLL_MS);
window.addEventListener('pagehide', () => {
  clearInterval(pollTimer);
  push(true);
});
