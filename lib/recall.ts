// Recall.ai: a bot that joins the call as a participant.
//
// Why this exists alongside the extension. The extension reads names out of a
// page, which is reliable for the roster and best-effort for who is speaking,
// because no platform documents the latter. Recall asks the platform directly
// and, on Zoom, Meet and Teams, gets back a SEPARATE AUDIO STREAM PER
// PARTICIPANT with that participant's display name attached. Attribution is
// then exact by construction — there is no clustering step to get wrong, no
// voiceprint to match, no echo to gate. It is the only path in this product
// where "the diarisation is always correct" is a true statement rather than an
// aspiration.
//
// What it costs: the bot is visible in the participant list, and Recall bills
// per meeting-hour. So it is the premium path, not the default, and everything
// here degrades to "not configured" without a key rather than failing.

const RECALL_API_KEY = process.env.RECALL_API_KEY;
// Recall is region-pinned and the host differs per region. EU by default, to
// match the dub1/EU-Supabase posture of the rest of this app.
const RECALL_REGION = process.env.RECALL_REGION ?? 'eu-west-1';
const RECALL_BASE = process.env.RECALL_API_BASE ?? `https://${RECALL_REGION}.recall.ai/api/v1`;

export const isRecallReady = !!RECALL_API_KEY && RECALL_API_KEY !== 'your_recall_api_key_here';

export interface RecallBot {
  id: string;
  status: string;
  meetingUrl: string;
}

export interface RecallParticipantWord {
  name: string;
  start: number;
  end: number;
  text: string;
}

async function recall(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!isRecallReady) throw new Error('RECALL_API_KEY not configured');

  const res = await fetch(`${RECALL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${RECALL_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Recall ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Which service a meeting link belongs to, for the provider badge. */
export function providerFromMeetingUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('meet.google.com')) return 'meet';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return 'teams';
  if (u.includes('zoom.us')) return 'zoom';
  if (u.includes('webex.com')) return 'webex';
  return 'generic';
}

/** Reject anything that is not a meeting link before spending a bot on it. */
export function isSupportedMeetingUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return /(^|\.)(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|zoom\.us|webex\.com)$/.test(u.hostname)
      || u.hostname.endsWith('.zoom.us')
      || u.hostname.endsWith('.webex.com');
  } catch {
    return false;
  }
}

/**
 * Send a bot into a call.
 *
 * `use_separate_streams_when_available` is the entire point of this
 * integration. Without it Recall transcribes one mixed stream and the result is
 * no better than what this app already does for itself.
 */
export async function createBot(opts: {
  meetingUrl: string;
  botName?: string;
  webhookUrl: string;
  recordingId: string;
}): Promise<RecallBot> {
  const data = await recall('/bot', {
    method: 'POST',
    body: JSON.stringify({
      meeting_url: opts.meetingUrl,
      bot_name: opts.botName ?? 'FTC Transcribe',
      recording_config: {
        transcript: {
          provider: { meeting_captions: {} },
        },
        // Per-participant streams, which is what makes attribution exact.
        participant_events: {},
      },
      // Carried back on every webhook so the handler can find the recording
      // without a second lookup.
      metadata: { recordingId: opts.recordingId },
      webhooks: [
        {
          url: opts.webhookUrl,
          events: ['bot.status_change', 'transcript.data', 'transcript.done'],
        },
      ],
    }),
  }) as { id: string; status_changes?: Array<{ code: string }>; meeting_url?: { meeting_id?: string } };

  return {
    id: data.id,
    status: data.status_changes?.[data.status_changes.length - 1]?.code ?? 'joining',
    meetingUrl: opts.meetingUrl,
  };
}

export async function getBot(botId: string): Promise<{ id: string; status: string }> {
  const data = await recall(`/bot/${botId}`) as {
    id: string; status_changes?: Array<{ code: string }>;
  };
  return {
    id: data.id,
    status: data.status_changes?.[data.status_changes.length - 1]?.code ?? 'unknown',
  };
}

/** Ask the bot to leave. Used when the user stops the recording from our UI. */
export async function leaveCall(botId: string): Promise<void> {
  await recall(`/bot/${botId}/leave_call`, { method: 'POST' }).catch(() => {});
}

/**
 * Fetch the finished transcript, already attributed.
 *
 * Recall returns a list of utterances, each carrying the participant's display
 * name and word-level timings. Flattened here into the same shape the rest of
 * the pipeline uses, so nothing downstream has to know where it came from.
 */
export async function fetchTranscript(botId: string): Promise<RecallParticipantWord[]> {
  const data = await recall(`/bot/${botId}/transcript`) as Array<{
    participant?: { name?: string };
    words?: Array<{ text?: string; start_timestamp?: { relative?: number }; end_timestamp?: { relative?: number } }>;
  }>;

  if (!Array.isArray(data)) return [];

  const out: RecallParticipantWord[] = [];
  for (const utterance of data) {
    const name = utterance.participant?.name?.trim();
    const words = utterance.words ?? [];
    if (!name || !words.length) continue;

    const text = words.map((w) => w.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const start = words[0].start_timestamp?.relative;
    const end = words[words.length - 1].end_timestamp?.relative;
    if (typeof start !== 'number' || typeof end !== 'number') continue;

    out.push({ name, start, end, text });
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Collapse consecutive utterances by the same person into readable turns.
 *
 * Recall emits an utterance per pause, which on a long answer produces dozens
 * of one-line rows for the same speaker. The transcript view expects turns.
 */
export function toTurns(
  words: RecallParticipantWord[],
  maxGapS = 2,
): Array<{ speaker: string; start: number; end: number; text: string }> {
  const turns: Array<{ speaker: string; start: number; end: number; text: string }> = [];
  for (const w of words) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === w.name && w.start - last.end <= maxGapS) {
      last.end = w.end;
      last.text = `${last.text} ${w.text}`.replace(/\s+/g, ' ').trim();
    } else {
      turns.push({ speaker: w.name, start: w.start, end: w.end, text: w.text });
    }
  }
  return turns;
}

/** Distinct speakers with the spans they held, for MeetingParticipant rows. */
export function participantsFromTranscript(
  words: RecallParticipantWord[],
): Array<{ name: string; speakingSpans: Array<[number, number]> }> {
  const byName = new Map<string, Array<[number, number]>>();
  for (const w of words) {
    const spans = byName.get(w.name) ?? [];
    spans.push([w.start, w.end]);
    byName.set(w.name, spans);
  }
  return [...byName.entries()].map(([name, speakingSpans]) => ({ name, speakingSpans }));
}
