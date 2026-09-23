import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAnyUser } from '@/lib/auth';
import { logAudit, requestIp } from '@/lib/audit';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 'auto' is stored as a marker, not as a type: finalize replaces it with the
// kind of meeting read off the transcript. Anything else here is the recorder's
// explicit choice and is never reclassified.
const VALID_MEETING_TYPES = new Set(['auto', 'general', 'standup', 'sales', 'interview', 'review']);
const VALID_CHANNEL_LAYOUTS = new Set(['mic-sys', 'mono']);
// Which conferencing service, so a Google Meet call is not filed as Teams.
// `source` stays a two-value field ('web' | 'teams') for the existing list
// filter and search; this sits alongside it and carries the detail.
const VALID_PROVIDERS = new Set(['teams', 'meet', 'zoom', 'webex', 'slack', 'generic']);
// How the audio was captured. Decides whether participant names are
// authoritative (extension/bot) or inferred (web), and therefore whether the
// acoustic resolver may overrule them.
const VALID_CAPTURE_METHODS = new Set(['web', 'extension', 'bot']);

export async function POST(req: NextRequest) {
  let source = 'web';
  let meetingType = 'auto';
  let channelLayout: string | null = null;
  let meetingProvider: string | null = null;
  let captureMethod = 'web';
  try {
    const body = await req.json() as {
      source?: string; meetingType?: string; channelLayout?: string;
      meetingProvider?: string; captureMethod?: string;
    };
    if (body.captureMethod && VALID_CAPTURE_METHODS.has(body.captureMethod)) {
      captureMethod = body.captureMethod;
    }
    if (body.source === 'teams') source = 'teams';
    if (body.meetingProvider && VALID_PROVIDERS.has(body.meetingProvider)) meetingProvider = body.meetingProvider;
    if (body.meetingType && VALID_MEETING_TYPES.has(body.meetingType)) meetingType = body.meetingType;
    // Recorded for diagnostics only. Finalize reads the real layout off the
    // audio, so nothing downstream trusts this field.
    if (body.channelLayout && VALID_CHANNEL_LAYOUTS.has(body.channelLayout)) channelLayout = body.channelLayout;
  } catch { /* no body — fine */ }

  // Middleware already redirects anonymous traffic, but this is the data
  // boundary: every new recording must have a verified owner.
  //
  // getAnyUser, not getAuthUser: the Chrome extension is another origin and
  // carries no cookie, so it sends the same Supabase session as a bearer.
  const user = await getAnyUser(req);
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const limited = rateLimit(`recording-create:${user.id}`, 60, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many recordings created — try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterS) } },
    );
  }

  const recording = await prisma.recording.create({
    data: {
      title: `Recording – ${new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`,
      status: 'uploading',
      source,
      meetingType,
      channelLayout,
      meetingProvider,
      captureMethod,
      userId: user.id,
      // Stamped now rather than resolved on read: this freezes the tenant the
      // meeting belongs to at the moment it was recorded, so someone changing
      // employer cannot carry their previous employer's meetings across.
      orgId: user.orgId,
    },
  });

  await logAudit({
    userId: user.id,
    userEmail: user.email,
    action: 'recording.create',
    targetType: 'recording',
    targetId: recording.id,
    ip: requestIp(req),
    metadata: { source, meetingType, meetingProvider, captureMethod },
  });

  return NextResponse.json({ id: recording.id });
}
