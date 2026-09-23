import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What BrightLink's Team Admin allows this person in the Notetaker.
 *
 * The switches live in the CRM (org_members / organisations
 * feature_restrictions). Rather than a fourth copy of the CRM's rule, this asks
 * the shared database's own has_capability(), as the user, so the Notetaker and
 * the CRM's RLS can never disagree. Keys:
 *   meetings               the Notetaker at all
 *   meetings.all_records   "See the team's meetings" (bounds canSeeAll)
 *
 * `meetings.delete` is not enforced here yet: merging recordings deletes the
 * originals through the same route, so refusing deletes would leave a merge
 * half done. It needs the merge flow to check it first.
 *
 * Fails OPEN, like the CRM's own feature guard: an auth or database outage must
 * not lock every customer out of their meetings.
 */
export interface MeetingCapabilities {
  meetings: boolean;
  teamMeetings: boolean;
}

export const ALL_MEETING_CAPABILITIES: MeetingCapabilities = { meetings: true, teamMeetings: true };

export async function fetchMeetingCapabilities(supabase: SupabaseClient): Promise<MeetingCapabilities> {
  const ask = async (key: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc('has_capability', { p_key: key });
      if (error) {
        console.error('[capabilities] has_capability failed', key, error.message);
        return true;
      }
      return data !== false;
    } catch (err) {
      console.error('[capabilities] has_capability threw', key, err instanceof Error ? err.message : err);
      return true;
    }
  };
  const [meetings, teamMeetings] = await Promise.all([ask('meetings'), ask('meetings.all_records')]);
  return { meetings, teamMeetings };
}
