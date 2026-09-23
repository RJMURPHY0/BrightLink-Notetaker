// Who was in the meeting, according to the meeting platform.
//
// The Chrome extension POSTs here as people join and leave a call, and again
// with speaking spans when it stops. Recall.ai's webhook writes the same rows
// from its per-participant streams. Finalize then prefers these names over
// anything the acoustic resolver inferred — see lib/participant-names.ts for
// why that ordering is the right way round.
//
// Called cross-origin by the extension, so it carries the same bearer-or-cookie
// and CORS treatment as the CRM's summary route.
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAnyUser, canAccessRecording } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { corsHeaders, isAllowedOrigin } from '@/lib/cors';
import { normaliseSpans, type SpeakingSpan } from '@/lib/participant-names';

export const dynamic = 'force-dynamic';

const CUID_RE = /^c[a-z0-9]{20,}$/;
const VALID_ORIGINS = new Set(['extension', 'bot']);
const MAX_PARTICIPANTS = 200;
const MAX_NAME = 120;

interface IncomingParticipant {
  name?: string;
  platformId?: string;
  isHost?: boolean;
  speakingSpans?: unknown;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  if (origin && !isAllowedOrigin(origin)) {
    return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403 });
  }
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400, headers: cors });
  }

  const user = await getAnyUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401, headers: cors });
  }

  // The extension re-posts the roster on every join/leave, so the limit is
  // generous per recording rather than per call.
  const limited = rateLimit(`participants:${user.id}`, 600, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many participant updates.' },
      { status: 429, headers: { ...cors, 'Retry-After': String(limited.retryAfterS) } },
    );
  }

  let body: { origin?: string; participants?: IncomingParticipant[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400, headers: cors });
  }

  const rosterOrigin = body.origin ?? 'extension';
  if (!VALID_ORIGINS.has(rosterOrigin)) {
    return NextResponse.json({ error: 'Invalid origin.' }, { status: 400, headers: cors });
  }

  const incoming = Array.isArray(body.participants) ? body.participants : [];
  if (incoming.length > MAX_PARTICIPANTS) {
    return NextResponse.json({ error: 'Too many participants.' }, { status: 413, headers: cors });
  }

  // The recording must exist AND belong to the caller. Fetched with orgId
  // because canAccessRecording's signature forces the tenant check.
  const recording = await prisma.recording.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, orgId: true },
  });
  if (!recording) {
    return NextResponse.json({ error: 'Recording not found.' }, { status: 404, headers: cors });
  }
  if (!canAccessRecording(recording, user)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403, headers: cors });
  }

  // Deduplicate by name within the request: a participant list scraped from a
  // live DOM can momentarily contain the same person twice while a tile is
  // being re-rendered, and the unique index would reject the whole batch.
  const seen = new Map<string, { name: string; platformId: string | null; isHost: boolean; spans: SpeakingSpan[] }>();
  for (const p of incoming) {
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, MAX_NAME) : '';
    if (!name) continue;
    const spans = normaliseSpans(p.speakingSpans);
    const existing = seen.get(name);
    if (existing) {
      // Same person twice in one payload: keep the union of what each said.
      existing.spans = normaliseSpans([...existing.spans, ...spans]);
      existing.isHost = existing.isHost || p.isHost === true;
      continue;
    }
    seen.set(name, {
      name,
      platformId: typeof p.platformId === 'string' ? p.platformId.slice(0, 120) : null,
      isHost: p.isHost === true,
      spans,
    });
  }

  // Upsert rather than replace: the roster arrives repeatedly during a call and
  // a wholesale delete would lose the speaking spans accumulated so far for
  // anyone who happened to be off-screen when the list was read.
  for (const p of seen.values()) {
    await prisma.meetingParticipant.upsert({
      where: {
        recordingId_name_origin: { recordingId: params.id, name: p.name, origin: rosterOrigin },
      },
      create: {
        recordingId: params.id,
        name: p.name,
        platformId: p.platformId,
        isHost: p.isHost,
        origin: rosterOrigin,
        speakingSpans: p.spans,
      },
      update: {
        // Spans only ever grow. A later post carrying none (a plain roster
        // refresh) must not wipe what an earlier one recorded.
        ...(p.spans.length ? { speakingSpans: p.spans } : {}),
        ...(p.platformId ? { platformId: p.platformId } : {}),
        ...(p.isHost ? { isHost: true } : {}),
      },
    });
  }

  return NextResponse.json({ ok: true, count: seen.size }, { headers: cors });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const cors = corsHeaders(req.headers.get('origin'));
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400, headers: cors });
  }

  const user = await getAnyUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401, headers: cors });

  const recording = await prisma.recording.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, orgId: true },
  });
  if (!recording) return NextResponse.json({ error: 'Recording not found.' }, { status: 404, headers: cors });
  if (!canAccessRecording(recording, user)) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403, headers: cors });
  }

  const participants = await prisma.meetingParticipant.findMany({
    where: { recordingId: params.id },
    select: { name: true, platformId: true, isHost: true, origin: true, speakingSpans: true },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ participants }, { headers: cors });
}
