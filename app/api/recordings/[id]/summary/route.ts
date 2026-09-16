import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAnyUser, canAccessRecording } from '@/lib/auth';
import { normaliseDue } from '@/lib/action-items';

export const dynamic = 'force-dynamic';

const CUID_RE = /^c[a-z0-9]{20,}$/;

/*
 * The CRM (Brightlink) ticks off a meeting's action items from its Home page.
 * It is another origin and carries no cookie here, so it sends the signed-in
 * user's Supabase token as a bearer (verified by getBearerUser, never trusted)
 * and the same canAccessRecording() check applies. The write stays in this app,
 * which owns the Summary table: the CRM never writes it directly.
 *
 * Only the CRM's own origins are allowed cross-origin, plus localhost for its
 * dev server. CRM_ALLOWED_ORIGINS (comma separated) adds more, for a rebrand.
 */
const CRM_ORIGINS = [
  'https://app.brightlink.io',
  ...(process.env.CRM_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
];

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed = CRM_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  if (!allowed) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const cors = corsHeaders(request);
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });

  if (!CUID_RE.test(params.id)) {
    return reply({ error: 'Invalid recording ID.' }, 400);
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const { overview, keyPoints, actionItems, decisions, topics, actionItemsChecked, actionItemsDue, toggleActionItem } = body;

    const data: Record<string, string> = {};
    if (overview !== undefined)            data.overview            = String(overview).slice(0, 5000);
    if (keyPoints !== undefined)           data.keyPoints           = Array.isArray(keyPoints)           ? JSON.stringify(keyPoints.slice(0, 20).map(String))                    : '[]';
    if (actionItems !== undefined)         data.actionItems         = Array.isArray(actionItems)         ? JSON.stringify(actionItems.slice(0, 20).map(String))                  : '[]';
    if (decisions !== undefined)           data.decisions           = Array.isArray(decisions)           ? JSON.stringify(decisions.slice(0, 20).map(String))                    : '[]';
    if (topics !== undefined)              data.topics              = Array.isArray(topics)              ? JSON.stringify(topics.slice(0, 10))                                   : '[]';
    if (actionItemsChecked !== undefined)  data.actionItemsChecked  = Array.isArray(actionItemsChecked)  ? JSON.stringify(actionItemsChecked.filter(Number.isInteger).slice(0, 50)) : '[]';
    if (actionItemsDue !== undefined)      data.actionItemsDue      = Array.isArray(actionItemsDue)      ? JSON.stringify(actionItemsDue.slice(0, 20).map(normaliseDue))           : '[]';

    // One item ticked or unticked, applied to what is stored rather than to a
    // whole list sent from a page that may be stale, so a tick made on one
    // screen never undoes a tick made on another.
    const toggle = toggleActionItem as { index?: unknown; done?: unknown } | undefined;
    const isToggle = toggle !== undefined;
    if (isToggle && (!Number.isInteger(toggle?.index) || (toggle?.index as number) < 0 || typeof toggle?.done !== 'boolean')) {
      return reply({ error: 'toggleActionItem needs a whole-number index and done: true or false.' }, 400);
    }

    if (Object.keys(data).length === 0 && !isToggle) {
      return reply({ error: 'Nothing to update.' }, 400);
    }

    const user = await getAnyUser(request);
    if (!user) {
      return reply({ error: 'Not signed in.' }, 401);
    }
    const rec = await prisma.recording.findUnique({
      where: { id: params.id },
      select: { userId: true, orgId: true, deletedAt: true },
    });
    if (!rec || rec.deletedAt) {
      return reply({ error: 'Recording not found.' }, 404);
    }
    if (!canAccessRecording(rec, user)) {
      return reply({ error: 'Not allowed.' }, 403);
    }

    if (isToggle) {
      const index = toggle!.index as number;
      const done = toggle!.done as boolean;
      const result = await prisma.$transaction(async (tx) => {
        // Lock the row for the read-change-write, so two ticks at once both land.
        const rows = await tx.$queryRaw<{ actionItems: string; actionItemsChecked: string }[]>`
          SELECT "actionItems", "actionItemsChecked" FROM "Summary" WHERE "recordingId" = ${params.id} FOR UPDATE`;
        if (rows.length === 0) return { status: 404 as const };
        const items = safeArray(rows[0].actionItems);
        if (index >= items.length) return { status: 400 as const };
        const checked = new Set(safeArray(rows[0].actionItemsChecked).filter((n): n is number => Number.isInteger(n)));
        if (done) checked.add(index);
        else checked.delete(index);
        const next = Array.from(checked).sort((a, b) => a - b).slice(0, 50);
        await tx.summary.update({ where: { recordingId: params.id }, data: { actionItemsChecked: JSON.stringify(next) } });
        return { status: 200 as const, checked: next };
      });
      if (result.status === 404) return reply({ error: 'This recording has no notes yet.' }, 404);
      if (result.status === 400) return reply({ error: 'That action item no longer exists.' }, 400);
      return reply({ ok: true, checked: result.checked });
    }

    await prisma.summary.update({ where: { recordingId: params.id }, data });

    return reply({ ok: true });
  } catch (error) {
    console.error('[summary PATCH]', error);
    return reply({ error: 'Failed to save.' }, 500);
  }
}

function safeArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
