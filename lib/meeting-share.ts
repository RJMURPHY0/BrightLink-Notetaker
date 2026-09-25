// Meetings shared by tagging (2026-09-25).
//
// After a recording, its owner can say which colleagues were there. A tagged
// colleague may then OPEN the meeting read-only: the page, its notes, its
// transcript, its audio (subject to their own canPlayAudio) and its exports.
// They can never edit, re-run or delete it; every write route keeps
// canAccessRecording() alone.
//
// The tags live in the CRM's `meeting_people` table (shared database, written
// only through the SECURITY DEFINER RPCs in the CRM's migration
// 20260925092301_meeting_people.sql). Prisma bypasses RLS, so these reads are
// trusted server code. A missing table (an older database) answers "not
// shared", never an error, so this cannot take a page down.

import { prisma } from '@/lib/db';

/** True when `userId` was tagged as a colleague in this recording. */
export async function isSharedWith(recordingId: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    const rows = await prisma.$queryRaw<{ one: number }[]>`
      SELECT 1 AS one FROM public.meeting_people
      WHERE recording_id = ${recordingId} AND member_user_id = ${userId}::uuid
      LIMIT 1`;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Every recording `userId` was tagged in, newest first (capped). */
export async function sharedRecordingIds(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  try {
    const rows = await prisma.$queryRaw<{ recording_id: string }[]>`
      SELECT recording_id FROM public.meeting_people
      WHERE member_user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 200`;
    return rows.map((r) => r.recording_id);
  } catch {
    return [];
  }
}

/** Of these recordings, the ones nobody has linked people to or skipped. */
export async function recordingsNeedingPeople(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM unnest(${ids}::text[]) AS u(id)
      WHERE NOT EXISTS (SELECT 1 FROM public.meeting_people mp WHERE mp.recording_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM public.meeting_link_state s WHERE s.recording_id = u.id)`;
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}
