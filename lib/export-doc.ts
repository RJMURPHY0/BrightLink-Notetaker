// Shape of a meeting as the .docx and .pdf exporters consume it, plus the one
// place a Recording row is mapped onto it. Both export routes call
// `meetingDocFrom` so a Word and a PDF download of the same meeting can never
// disagree about what is in them.

import type { TopicSection } from '@/lib/ai';
import { parseDueArray } from '@/lib/action-items';

export interface MeetingDoc {
  title: string;
  createdAt: Date;
  overview: string;
  topics: TopicSection[];
  actionItems: string[];
  actionDue: (string | null)[];
  /** Indices of action items already ticked off — rendered struck through. */
  actionChecked: Set<number>;
  keyPoints: string[];
  decisions: string[];
}

function safeJson<T>(v: string | null | undefined, fallback: T): T {
  if (!v) return fallback;
  try {
    const parsed = JSON.parse(v) as unknown;
    return (parsed ?? fallback) as T;
  } catch { return fallback; }
}

interface SummaryRow {
  overview: string | null;
  keyPoints: string | null;
  actionItems: string | null;
  decisions: string | null;
  topics: string | null;
}

export function meetingDocFrom(recording: {
  title: string;
  createdAt: Date;
  summary?: (SummaryRow & Record<string, unknown>) | null;
}): MeetingDoc {
  const s = recording.summary;
  const actionItems: string[] = safeJson(s?.actionItems, []);
  const checked = safeJson<number[]>(s?.actionItemsChecked as string | undefined, []);
  return {
    title: recording.title,
    createdAt: recording.createdAt,
    overview: s?.overview ?? '',
    topics: safeJson<TopicSection[]>(s?.topics, []),
    actionItems,
    actionDue: parseDueArray(s?.actionItemsDue as string | undefined, actionItems.length),
    actionChecked: new Set(Array.isArray(checked) ? checked : []),
    keyPoints: safeJson<string[]>(s?.keyPoints, []),
    decisions: safeJson<string[]>(s?.decisions, []),
  };
}

/** "None" is the model's way of saying there were none — don't print a section. */
export const hasDecisions = (d: string[]) => d.length > 0 && d[0] !== 'None';

/** Filename stem shared by both exports. */
export function exportFilename(title: string): string {
  return title.replace(/[^a-z0-9 ]/gi, '_').trim() || 'meeting-notes';
}

/**
 * Documents are light surfaces, so they take the on-light lockup (grey
 * "Bright"). The reversed mark the app uses on its dark UI is invisible on
 * paper, so there is no fallback to it: no logo beats a broken one. The file
 * must be force-traced in next.config.js or production ships without it.
 */
export const DOC_LOGO_FILE = 'logo-light.png';

export async function readDocLogo(): Promise<Buffer | null> {
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');
  try {
    return await readFile(join(process.cwd(), 'public', DOC_LOGO_FILE));
  } catch (err) {
    console.error(`[export] ${DOC_LOGO_FILE} missing from the bundle`, err);
    return null;
  }
}

/** Width of the logo in both documents: 2.5in. */
export const DOC_LOGO_WIDTH_IN = 2.5;

/**
 * Logo box at `widthUnits` wide, height from the PNG's own aspect ratio, so
 * swapping the artwork never stretches it. Reads the IHDR chunk directly.
 */
export function docLogoSize(png: Buffer, widthUnits: number): { width: number; height: number } {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  return { width: widthUnits, height: Math.round((widthUnits * h) / w * 10) / 10 };
}
