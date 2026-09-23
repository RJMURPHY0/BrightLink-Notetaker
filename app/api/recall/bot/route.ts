// Send a bot into a meeting, or pull it back out.
//
// Creates the Recording row first so the bot has somewhere to report to, then
// asks Recall to join. If the join fails the row is marked failed rather than
// left in 'uploading' for the stuck-recording sweeper to find 24 hours later.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAnyUser, canAccessRecording } from '@/lib/auth';
import { logAudit, requestIp } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';
import { corsHeaders, isAllowedOrigin } from '@/lib/cors';
import {
  isRecallReady, createBot, leaveCall, isSupportedMeetingUrl, providerFromMeetingUrl,
} from '@/lib/recall';
import { PRODUCT_NAME } from '@/lib/branding';

export const dynamic = 'force-dynamic';

const VALID_MEETING_TYPES = new Set(['auto', 'general', 'standup', 'sales', 'interview', 'review']);

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin'), 'GET, POST, DELETE, OPTIONS') });
}

/**
 * Whether bots are available at all, so the recorder can hide the option
 * rather than offering a button that always returns 503. Says nothing about
 * the key itself.
 */
export async function GET(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'), 'GET, POST, DELETE, OPTIONS');
  const user = await getAnyUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401, headers: cors });
  return NextResponse.json({ enabled: isRecallReady }, { headers: cors });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin, 'POST, DELETE, OPTIONS');
  if (origin && !isAllowedOrigin(origin)) {
    return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403 });
  }

  if (!isRecallReady) {
    return NextResponse.json(
      { error: 'Meeting bots are not configured. Add RECALL_API_KEY to enable them.' },
      { status: 503, headers: cors },
    );
  }

  const user = await getAnyUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401, headers: cors });

  // A bot costs money per meeting-hour, so this limit is tighter than the
  // recording-create one and deliberately so.
  const limited = rateLimit(`recall-bot:${user.id}`, 20, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many bots started — try again shortly.' },
      { status: 429, headers: { ...cors, 'Retry-After': String(limited.retryAfterS) } },
    );
  }

  let body: { meetingUrl?: string; meetingType?: string; botName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400, headers: cors });
  }

  const meetingUrl = (body.meetingUrl ?? '').trim();
  if (!isSupportedMeetingUrl(meetingUrl)) {
    return NextResponse.json(
      { error: 'That is not a Teams, Meet, Zoom or Webex link.' },
      { status: 400, headers: cors },
    );
  }

  const meetingType = body.meetingType && VALID_MEETING_TYPES.has(body.meetingType)
    ? body.meetingType : 'auto';

  const recording = await prisma.recording.create({
    data: {
      title: `Recording – ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      status: 'uploading',
      source: 'teams',
      meetingType,
      meetingProvider: providerFromMeetingUrl(meetingUrl),
      captureMethod: 'bot',
      meetingUrl,
      userId: user.id,
      orgId: user.orgId,
    },
  });

  // Recall must be able to reach this. On localhost it cannot, so a tunnel URL
  // goes in PUBLIC_APP_URL while developing.
  const base = process.env.PUBLIC_APP_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? new URL(req.url).origin;

  try {
    const bot = await createBot({
      meetingUrl,
      botName: body.botName?.slice(0, 60) || PRODUCT_NAME,
      webhookUrl: `${base}/api/recall/webhook`,
      recordingId: recording.id,
    });

    await prisma.recording.update({
      where: { id: recording.id },
      data: { recallBotId: bot.id },
    });

    await logAudit({
      userId: user.id,
      userEmail: user.email,
      action: 'recall.bot.create',
      targetType: 'recording',
      targetId: recording.id,
      ip: requestIp(req),
      metadata: { meetingUrl, botId: bot.id },
    });

    return NextResponse.json(
      { recordingId: recording.id, botId: bot.id, status: bot.status },
      { headers: cors },
    );
  } catch (e) {
    // Don't leave an orphan 'uploading' row for the 24-hour sweeper.
    await prisma.recording.update({
      where: { id: recording.id },
      data: { status: 'failed' },
    }).catch(() => {});

    const message = e instanceof Error ? e.message : 'Could not start the bot.';
    console.error('[recall] bot create failed:', message);
    return NextResponse.json({ error: message }, { status: 502, headers: cors });
  }
}

/** Pull the bot out of the call early. */
export async function DELETE(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'), 'POST, DELETE, OPTIONS');
  const user = await getAnyUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401, headers: cors });

  const recordingId = new URL(req.url).searchParams.get('recordingId') ?? '';
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { id: true, userId: true, orgId: true, recallBotId: true },
  });
  if (!recording) return NextResponse.json({ error: 'Recording not found.' }, { status: 404, headers: cors });
  if (!canAccessRecording(recording, user)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403, headers: cors });
  }
  if (!recording.recallBotId) {
    return NextResponse.json({ error: 'No bot for this recording.' }, { status: 400, headers: cors });
  }

  await leaveCall(recording.recallBotId);
  return NextResponse.json({ ok: true }, { headers: cors });
}
