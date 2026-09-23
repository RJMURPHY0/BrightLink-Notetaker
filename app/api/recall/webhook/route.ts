// Recall.ai's callbacks.
//
// This route is reached by Recall's servers, not by a signed-in user, so it is
// exempt from the cookie middleware and its own signature check is the only
// gate. It therefore FAILS CLOSED: an unset RECALL_WEBHOOK_SECRET rejects,
// matching the pattern set by /api/auto-fix and /api/jobs/finalize after both
// were found fail-open.
//
// When the bot finishes, the transcript it hands back is already attributed
// per participant — Recall transcribes a separate audio stream for each person
// rather than one mixed one. So this route writes the Transcript directly and
// skips diarisation entirely: there is nothing to infer.
import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fetchTranscript, toTurns, participantsFromTranscript } from '@/lib/recall';
import { analyzeAndCompleteRecording } from '@/lib/finalize-recording';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET;

/**
 * Svix-style signature, which is what Recall sends.
 *
 * Compared with timingSafeEqual rather than ===: a webhook signature check
 * that leaks timing is a webhook signature check an attacker can solve.
 */
function verify(req: NextRequest, raw: string): boolean {
  if (!WEBHOOK_SECRET) return false;

  const id = req.headers.get('svix-id') ?? req.headers.get('webhook-id');
  const timestamp = req.headers.get('svix-timestamp') ?? req.headers.get('webhook-timestamp');
  const signature = req.headers.get('svix-signature') ?? req.headers.get('webhook-signature');
  if (!id || !timestamp || !signature) return false;

  // Reject anything older than five minutes so a captured request cannot be
  // replayed indefinitely.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const secret = WEBHOOK_SECRET.startsWith('whsec_') ? WEBHOOK_SECRET.slice(6) : WEBHOOK_SECRET;
  const expected = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64');

  // The header carries a space-separated list of `v1,<sig>` pairs.
  return signature.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!WEBHOOK_SECRET) {
    console.error('[recall] webhook rejected: RECALL_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 503 });
  }
  if (!verify(req, raw)) {
    return NextResponse.json({ error: 'Bad signature.' }, { status: 401 });
  }

  let event: {
    event?: string;
    data?: {
      bot?: { id?: string; metadata?: { recordingId?: string } };
      status?: { code?: string };
      data?: { code?: string };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const botId = event.data?.bot?.id;
  if (!botId) return NextResponse.json({ ok: true, ignored: 'no bot id' });

  const recording = await prisma.recording.findFirst({
    where: { recallBotId: botId },
    select: { id: true, status: true, userId: true },
  });
  if (!recording) {
    // A bot from another environment sharing the same Recall account. Not an
    // error, and not ours to act on.
    return NextResponse.json({ ok: true, ignored: 'unknown bot' });
  }

  const code = event.data?.status?.code ?? event.data?.data?.code ?? '';

  // Terminal failures: say so on the recording instead of leaving it
  // 'uploading' until the 24-hour sweeper notices.
  if (['fatal', 'call_ended_by_platform_waiting_room_timeout', 'bot_rejected'].includes(code)) {
    await prisma.recording.update({
      where: { id: recording.id },
      data: { status: 'failed' },
    });
    return NextResponse.json({ ok: true, status: 'failed' });
  }

  if (code === 'in_call_recording') {
    await prisma.recording.update({
      where: { id: recording.id },
      data: { status: 'recording' },
    }).catch(() => {});
    return NextResponse.json({ ok: true, status: 'recording' });
  }

  const finished = event.event === 'transcript.done'
    || code === 'done'
    || code === 'call_ended';

  if (!finished) return NextResponse.json({ ok: true, status: code || 'ignored' });

  // Idempotent: Recall retries a webhook it did not get a 2xx for, and
  // transcript.done can arrive alongside a done status change.
  if (recording.status === 'completed' || recording.status === 'processing') {
    return NextResponse.json({ ok: true, ignored: 'already handled' });
  }
  await prisma.recording.update({
    where: { id: recording.id },
    data: { status: 'processing' },
  });

  try {
    const words = await fetchTranscript(botId);
    if (!words.length) {
      await prisma.recording.update({ where: { id: recording.id }, data: { status: 'failed' } });
      return NextResponse.json({ ok: true, status: 'empty' });
    }

    const turns = toTurns(words);

    // Straight to the Transcript table. No diarisation pass, no voice-ID pass:
    // the platform already told us who said what, and re-deriving it acoustically
    // could only ever make it worse.
    // `segments` is a JSON string on this model, not a Json column.
    const fullText = turns.map((t) => `${t.speaker}: ${t.text}`).join('\n\n');
    const segments = JSON.stringify(turns);
    await prisma.transcript.upsert({
      where: { recordingId: recording.id },
      create: { recordingId: recording.id, fullText, segments, language: 'english' },
      update: { fullText, segments },
    });

    for (const p of participantsFromTranscript(words)) {
      await prisma.meetingParticipant.upsert({
        where: {
          recordingId_name_origin: { recordingId: recording.id, name: p.name, origin: 'bot' },
        },
        create: {
          recordingId: recording.id,
          name: p.name,
          origin: 'bot',
          speakingSpans: p.speakingSpans,
        },
        update: { speakingSpans: p.speakingSpans },
      });
    }

    const duration = Math.ceil(turns[turns.length - 1]?.end ?? 0);
    await prisma.recording.update({
      where: { id: recording.id },
      data: { duration },
    });

    // Summary, topics, action items — the same analysis every other recording
    // gets, from a transcript that happens to already be perfectly attributed.
    await analyzeAndCompleteRecording(recording.id);

    return NextResponse.json({ ok: true, status: 'completed', turns: turns.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    console.error('[recall] transcript ingest failed:', message);
    await prisma.recording.update({
      where: { id: recording.id },
      data: { status: 'failed' },
    }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
