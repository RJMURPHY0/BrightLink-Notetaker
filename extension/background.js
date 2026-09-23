// Service worker: owns the recording's lifecycle and every call to the API.
//
// Why a service worker plus an offscreen document, rather than doing it all in
// one place: MV3 killed background pages, and a service worker has no DOM, so
// it cannot hold a MediaStream or run a MediaRecorder. It can, however, mint a
// tab-capture stream id, which is the one thing that must happen in response to
// the user's click. So the click lands here, the id is minted here, and the
// actual audio work happens in an offscreen document that this worker creates
// and owns.
//
// The worker is also the only thing that talks to the API, so the access token
// never enters a page context.

import { getToken, clearToken, setToken } from './auth.js';
import { apiBase } from './config.js';

const OFFSCREEN_PATH = 'offscreen.html';

// Mirrors the web recorder's own rotation: audio is cut into chunks and
// uploaded as the meeting runs, so a dropped connection or a closed laptop
// costs one chunk rather than the whole meeting.
const CHUNK_MS = 120_000;

/** The single in-flight recording, or null. Rebuilt from storage on wake. */
let session = null;

// ── Session state, persisted ─────────────────────────────────────────────────
//
// A service worker is terminated aggressively when idle. Everything needed to
// resume must survive in storage, because `session` will be undefined the next
// time Chrome wakes this worker up mid-meeting.

async function saveSession() {
  await chrome.storage.local.set({ session });
}

async function loadSession() {
  if (session !== null) return session;
  const { session: stored } = await chrome.storage.local.get('session');
  session = stored ?? null;
  return session;
}

async function endSession() {
  session = null;
  await chrome.storage.local.remove('session');
  await chrome.action.setBadgeText({ text: '' });
}

// ── API ──────────────────────────────────────────────────────────────────────

async function api(path, init = {}) {
  const token = await getToken();
  if (!token) throw new Error('NOT_CONNECTED');

  const res = await fetch(`${await apiBase()}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    // The token expired and could not be refreshed. Force a reconnect rather
    // than retrying forever against a dead session.
    await clearToken();
    throw new Error('NOT_CONNECTED');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

// ── Offscreen document ───────────────────────────────────────────────────────

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Mixing the meeting audio with the microphone and encoding it for upload.',
  });
}

/** Message the offscreen document, retrying while its script is still loading. */
async function sendToOffscreen(message, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function closeOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (existing.length) await chrome.offscreen.closeDocument().catch(() => {});
}

// ── Starting ─────────────────────────────────────────────────────────────────

async function startRecording(tab) {
  if (await loadSession()) throw new Error('A recording is already running.');

  // Must be minted in the same task as the user's click, and only for a tab
  // the extension is allowed to capture.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

  const provider = providerFromUrl(tab.url);

  const res = await api('/api/recordings/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'teams',
      meetingType: 'auto',
      meetingProvider: provider,
      channelLayout: 'mic-sys',
      captureMethod: 'extension',
    }),
  });
  const { id } = await res.json();

  session = {
    recordingId: id,
    tabId: tab.id,
    provider,
    startedAt: Date.now(),
    title: tab.title ?? '',
  };
  await saveSession();

  await ensureOffscreen();
  // createDocument resolves when the document exists, not when its script has
  // run, so the first message can arrive before anything is listening and be
  // dropped silently — a recording that never records.
  await sendToOffscreen({
    target: 'offscreen',
    type: 'start',
    streamId,
    recordingId: id,
    apiBase: await apiBase(),
    chunkMs: CHUNK_MS,
  });

  await chrome.action.setBadgeText({ text: 'REC' });
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });

  // Ask the page for its participant list straight away, then let the content
  // script push updates as people come and go.
  pokeContentScript(tab.id);

  return session;
}

async function stopRecording() {
  const current = await loadSession();
  if (!current) return null;

  // Ask the page for one last roster, including everyone's speaking spans,
  // before the tab possibly closes with the meeting.
  await pokeContentScript(current.tabId, true).catch(() => {});

  await sendToOffscreen({ target: 'offscreen', type: 'stop' }).catch(() => {});
  return current;
}

/** Called by the offscreen document once the final chunk has uploaded. */
async function finishRecording() {
  const current = await loadSession();
  if (!current) return;

  try {
    await api(`/api/recordings/${current.recordingId}/finalize`, { method: 'POST' });
  } catch (e) {
    console.warn('[ftc] finalize request failed, cron will pick it up:', e.message);
  }

  await closeOffscreen();
  const id = current.recordingId;
  await endSession();
  return id;
}

// ── Participants ─────────────────────────────────────────────────────────────

async function pokeContentScript(tabId, final = false) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ftc-collect', final });
  } catch {
    // The content script is not present (the meeting is in a native app, or
    // the tab navigated away). Recording continues; names fall back to the
    // acoustic pipeline, which is exactly the old behaviour.
  }
}

async function postParticipants(recordingId, participants) {
  if (!participants?.length) return;
  await api(`/api/recordings/${recordingId}/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'extension', participants }),
  });
}

function providerFromUrl(url = '') {
  if (url.includes('meet.google.com')) return 'meet';
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
  if (url.includes('zoom.us')) return 'zoom';
  if (url.includes('webex.com')) return 'webex';
  if (url.includes('slack.com')) return 'slack';
  return 'generic';
}

// ── Messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages addressed to the offscreen document share type names with the
  // popup's ('start', 'stop'). Chrome does not deliver a sendMessage back to
  // the context that sent it, so this cannot currently fire — but relying on
  // that to keep 'start' from meaning two different things is one refactor
  // away from starting a second recording inside the first.
  if (msg?.target === 'offscreen') return false;

  // Every branch is async, so each one must return true and reply later.
  (async () => {
    try {
      switch (msg.type) {
        case 'get-state': {
          const current = await loadSession();
          const token = await getToken();
          sendResponse({
            connected: !!token,
            recording: current
              ? { ...current, elapsed: Math.floor((Date.now() - current.startedAt) / 1000) }
              : null,
          });
          break;
        }

        case 'start': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error('No active tab.');
          const started = await startRecording(tab);
          sendResponse({ ok: true, session: started });
          break;
        }

        case 'stop': {
          await stopRecording();
          sendResponse({ ok: true });
          break;
        }

        // From the offscreen document, before every upload. An access token
        // lasts an hour and meetings do not, so handing the offscreen document
        // one at start time and letting it keep using it would fail every
        // upload after the first hour of a long call.
        case 'get-upload-token': {
          sendResponse({ ok: true, token: await getToken() });
          break;
        }

        // From the offscreen document.
        case 'offscreen-finished': {
          const id = await finishRecording();
          sendResponse({ ok: true, recordingId: id });
          break;
        }

        case 'offscreen-error': {
          console.error('[ftc] capture failed:', msg.error);
          await closeOffscreen();
          await chrome.storage.local.set({ lastError: msg.error });
          await endSession();
          sendResponse({ ok: true });
          break;
        }

        // From a meeting page's content script.
        case 'ftc-participants': {
          const current = await loadSession();
          if (current && sender.tab?.id === current.tabId) {
            const startedAt = current.startedAt;
            // The page reports wall-clock milliseconds; the transcript's
            // timeline starts at zero when the recording did.
            const participants = msg.participants.map((p) => ({
              name: p.name,
              isHost: p.isHost,
              speakingSpans: (p.speakingSpans ?? [])
                .map(([s, e]) => [(s - startedAt) / 1000, (e - startedAt) / 1000])
                .filter(([s, e]) => e > 0 && e > s)
                .map(([s, e]) => [Math.max(0, s), e]),
            }));
            await postParticipants(current.recordingId, participants);
          }
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: `Unknown message ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

// ── Pairing with the web app ─────────────────────────────────────────────────
//
// The Transcribe web app already holds a signed-in Supabase session. Rather
// than building a second login, the app's connect page hands this extension
// that session's tokens once, with the user watching. Everything after that is
// an ordinary bearer request.

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type !== 'ftc-connect') {
      sendResponse({ ok: false, error: 'Unknown message.' });
      return;
    }
    // Only the app's own origins can pair, enforced again here rather than
    // trusting the manifest's externally_connectable alone.
    const origin = new URL(sender.url ?? '').origin;
    const allowed = origin === 'https://ftctranscribe-phi.vercel.app'
      || /^http:\/\/localhost:\d+$/.test(origin);
    if (!allowed) {
      sendResponse({ ok: false, error: 'Origin not allowed.' });
      return;
    }

    await setToken({
      accessToken: msg.accessToken,
      refreshToken: msg.refreshToken,
      expiresAt: msg.expiresAt,
      supabaseUrl: msg.supabaseUrl,
      supabaseAnonKey: msg.supabaseAnonKey,
      apiBase: origin,
      email: msg.email ?? '',
    });
    sendResponse({ ok: true });
  })();
  return true;
});

// A tab closing mid-meeting is the normal way a call ends. Flush rather than
// lose it.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const current = await loadSession();
  if (current && current.tabId === tabId) await stopRecording();
});
