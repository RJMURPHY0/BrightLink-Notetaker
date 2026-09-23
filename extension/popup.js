// The whole user interface: one button.
//
// Deliberately so. The web recorder asks for a meeting type, a source, and
// then hands the browser's share picker over with three tabs of options — and
// the most common answer to all of it is "the meeting I am looking at". Here
// the tab IS the answer, so there is nothing to ask.

import { DEFAULT_API_BASE } from './config.js';

const view = document.getElementById('view');

const MEETING_HOSTS = [
  'meet.google.com', 'teams.microsoft.com', 'teams.live.com',
  'zoom.us', 'webex.com', 'app.slack.com',
];

const PROVIDER_LABELS = {
  meet: 'Google Meet', teams: 'Microsoft Teams', zoom: 'Zoom',
  webex: 'Webex', slack: 'Slack', generic: 'this tab',
};

function providerFor(url = '') {
  if (url.includes('meet.google.com')) return 'meet';
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return 'teams';
  if (url.includes('zoom.us')) return 'zoom';
  if (url.includes('webex.com')) return 'webex';
  if (url.includes('slack.com')) return 'slack';
  return 'generic';
}

function mmss(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

async function apiBase() {
  const { auth } = await chrome.storage.local.get('auth');
  return auth?.apiBase || DEFAULT_API_BASE;
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await send('get-state');
  const { lastError } = await chrome.storage.local.get('lastError');

  // ── Not paired ─────────────────────────────────────────────────────────────
  if (!state.connected) {
    const base = await apiBase();
    view.innerHTML = `
      <div class="card">
        <div class="meeting">Connect your account</div>
        <div class="muted">Sign in to BrightLink Notetaker once, and this extension records straight to your account.</div>
      </div>
      <button class="primary" id="connect">Connect</button>`;
    document.getElementById('connect').onclick = () => {
      chrome.tabs.create({ url: `${base}/extension` });
      window.close();
    };
    return;
  }

  // ── Recording ──────────────────────────────────────────────────────────────
  if (state.recording) {
    const label = PROVIDER_LABELS[state.recording.provider] ?? 'this tab';
    view.innerHTML = `
      <div class="card">
        <div class="timer"><span class="pulse"></span>${mmss(state.recording.elapsed)}</div>
        <div class="muted">Recording ${label}. Your mic and the call are being saved as separate tracks.</div>
      </div>
      <div class="stack">
        <button class="stop" id="stop">Stop and transcribe</button>
        <button class="ghost" id="open">Open recording</button>
      </div>`;
    document.getElementById('stop').onclick = async () => {
      const btn = document.getElementById('stop');
      btn.disabled = true;
      btn.textContent = 'Finishing…';
      await send('stop');
      setTimeout(render, 700);
    };
    document.getElementById('open').onclick = async () => {
      chrome.tabs.create({ url: `${await apiBase()}/recordings/${state.recording.recordingId}` });
    };
    return;
  }

  // ── Microphone not yet granted ─────────────────────────────────────────────
  // Checked before the record button is offered rather than after it fails:
  // the offscreen document cannot show Chrome's prompt, so a refused mic is a
  // dead end reached three clicks too late.
  let micState = 'granted';
  try {
    micState = (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch { /* not queryable — assume granted and let the recorder report */ }

  if (micState !== 'granted') {
    view.innerHTML = `
      <div class="card">
        <div class="meeting">One more permission</div>
        <div class="muted">Chrome needs to ask for your microphone once, in a tab. Your voice and the call are recorded as separate tracks.</div>
      </div>
      <button class="primary" id="mic">Allow microphone</button>`;
    document.getElementById('mic').onclick = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
      window.close();
    };
    return;
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  const url = tab?.url ?? '';
  const onMeeting = MEETING_HOSTS.some((h) => url.includes(h));
  const provider = providerFor(url);
  const label = PROVIDER_LABELS[provider];

  view.innerHTML = `
    <div class="card">
      <div class="meeting">${onMeeting ? `Ready to record ${label}` : 'No meeting in this tab'}</div>
      <div class="muted">${onMeeting
        ? 'One click. No screen-share picker, and everyone gets their real name from the participant list.'
        : 'Open your Teams, Meet or Zoom tab and click the extension there. You can also record any tab that is playing call audio.'}</div>
    </div>
    <div class="stack">
      <button class="primary" id="start">${onMeeting ? `Record ${label}` : 'Record this tab'}</button>
      <button class="ghost" id="open">Open Notetaker</button>
    </div>
    ${lastError ? `<div class="err">${lastError}</div>` : ''}`;

  document.getElementById('start').onclick = async () => {
    const btn = document.getElementById('start');
    btn.disabled = true;
    btn.textContent = 'Starting…';
    await chrome.storage.local.remove('lastError');
    const res = await send('start');
    if (!res?.ok) {
      const message = res?.error === 'NOT_CONNECTED'
        ? 'Your session expired. Click Connect to sign in again.'
        : res?.error ?? 'Could not start.';
      await chrome.storage.local.set({ lastError: message });
    }
    render();
  };
  document.getElementById('open').onclick = async () => {
    chrome.tabs.create({ url: await apiBase() });
  };
}

render();
// Keep the timer moving while the popup is open.
setInterval(async () => {
  const state = await send('get-state');
  if (state?.recording) {
    const el = document.querySelector('.timer');
    if (el) el.innerHTML = `<span class="pulse"></span>${mmss(state.recording.elapsed)}`;
  }
}, 1000);
