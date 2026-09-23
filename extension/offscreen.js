// Capture, mix, encode, upload.
//
// The channel layout is identical to the web recorder's, deliberately: your
// microphone on the left, the call on the right, as two discrete channels
// rather than a blend. The server's diarisation pipeline already knows how to
// read that shape (channelLayout 'mic-sys'), and it is the single most useful
// thing a recorder can do for speaker attribution — your channel is provably
// one person, and the remote channel can be clustered without your voice in it.
//
// Two things here have no equivalent in the web recorder, and both are
// consequences of tabCapture rather than getDisplayMedia:
//
//   1. tabCapture MUTES the tab. The captured audio stops reaching the user's
//      speakers unless it is explicitly routed back, so a call recorded this
//      way would go silent for the person recording it. The fix is one extra
//      connection to the AudioContext destination, and forgetting it is the
//      classic way this feature ships broken.
//   2. There is no picker, so there is no moment where the user tells us what
//      they picked. The tab is known from the click.

let recorder = null;
let stream = null;
let sources = [];
let ctx = null;
let config = null;
let chunkIndex = 0;
let offsetSeconds = 0;
let startedAt = 0;
let rotateTimer = null;
let headerBlob = null;
let stopping = false;

// Chunks whose upload failed after retries. Re-sent after the next success and
// again at stop, so a brief network blip costs nothing.
const pending = [];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  (async () => {
    try {
      if (msg.type === 'start') await start(msg);
      if (msg.type === 'stop') await stop();
      sendResponse({ ok: true });
    } catch (e) {
      chrome.runtime.sendMessage({ type: 'offscreen-error', error: e.message });
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

function bestMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm';
}

async function start({ streamId, recordingId, apiBase, chunkMs }) {
  config = { recordingId, apiBase, chunkMs };
  chunkIndex = 0;
  offsetSeconds = 0;
  headerBlob = null;
  stopping = false;
  pending.length = 0;

  // The tab's audio. `chromeMediaSourceId` is the id minted by the service
  // worker in response to the user's click; it cannot be obtained here.
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // The microphone. Echo cancellation is on for the same reason as the web
  // recorder: it uses what is playing as its reference, which is the first
  // line of defence against the remote party's voice coming out of the
  // speakers, back into the mic, and being labelled as you.
  let micStream;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    tabStream.getTracks().forEach((t) => t.stop());
    throw new Error(
      'Microphone access was refused. Open the extension and click "Allow microphone", then try again.',
    );
  }

  sources = [tabStream, micStream];

  ctx = new AudioContext();
  const tabSource = ctx.createMediaStreamSource(tabStream);
  const micSource = ctx.createMediaStreamSource(micStream);

  // THE line that stops the call going silent in the user's ears. tabCapture
  // diverts the tab's audio into this stream; routing it to the destination
  // puts it back on the speakers.
  tabSource.connect(ctx.destination);

  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  dest.channelCountMode = 'explicit';
  dest.channelInterpretation = 'discrete';
  const merger = ctx.createChannelMerger(2);
  micSource.connect(merger, 0, 0); // left  = you
  tabSource.connect(merger, 0, 1); // right = the call
  merger.connect(dest);

  stream = dest.stream;
  startedAt = Date.now();
  startRecorder();
}

function startRecorder() {
  const mime = bestMime();
  recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 });

  const parts = [];
  recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };

  recorder.onstop = async () => {
    const isFinal = stopping;
    // Each rotation produces a standalone WebM only if it carries the header
    // from the first chunk; MediaRecorder writes it once per recorder.
    const body = new Blob(parts, { type: bestMime() });
    const blob = chunkIndex === 0
      ? body
      : new Blob([headerBlob, body], { type: bestMime() });

    if (chunkIndex === 0) {
      // Keep the initialisation segment so later chunks can be made playable.
      headerBlob = body.slice(0, Math.min(body.size, 2048));
    }

    const thisOffset = offsetSeconds;
    chunkIndex++;
    offsetSeconds = (Date.now() - startedAt) / 1000;

    await upload(blob, thisOffset).catch(() => {});

    if (isFinal) {
      await flushPending();
      teardown();
      chrome.runtime.sendMessage({ type: 'offscreen-finished' });
    } else {
      startRecorder();
    }
  };

  recorder.start();
  rotateTimer = setTimeout(() => {
    if (recorder?.state === 'recording') recorder.stop();
  }, config.chunkMs);
}

// The access token is asked for per upload rather than held from start time:
// it lasts an hour, meetings do not, and the service worker is the only thing
// that can refresh it. Holding the start-time token would fail every upload
// after the first hour of a long call.
async function uploadToken() {
  const res = await chrome.runtime.sendMessage({ type: 'get-upload-token' });
  return res?.token ?? null;
}

async function upload(blob, offset, attempt = 0) {
  const form = new FormData();
  form.append('audio', blob, `chunk-${offset}.webm`);
  form.append('offset', String(offset));

  try {
    const token = await uploadToken();
    if (!token) throw new Error('not connected');
    const res = await fetch(
      `${config.apiBase}/api/recordings/${config.recordingId}/append-chunk`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
    if (!res.ok) throw new Error(`upload ${res.status}`);
    // A success means the network is back — retry anything held over.
    if (pending.length) await flushPending();
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      return upload(blob, offset, attempt + 1);
    }
    console.warn('[ftc] chunk held for retry:', e.message);
    pending.push({ blob, offset });
  }
}

async function flushPending() {
  const held = pending.splice(0, pending.length);
  for (const { blob, offset } of held) {
    await upload(blob, offset).catch(() => {});
  }
}

async function stop() {
  stopping = true;
  clearTimeout(rotateTimer);
  if (recorder?.state === 'recording') recorder.stop();
  else {
    teardown();
    chrome.runtime.sendMessage({ type: 'offscreen-finished' });
  }
}

function teardown() {
  clearTimeout(rotateTimer);
  sources.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  sources = [];
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  ctx?.close().catch(() => {});
  ctx = null;
  recorder = null;
}
