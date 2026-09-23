'use client';

import { useEffect } from 'react';
import { reportTitle, setEmbedTitle } from '@/lib/embed-bridge';

/**
 * Tells BrightLink the name of the meeting on screen, so its browser tab reads
 * the meeting's name. Renders nothing; does nothing outside a BrightLink frame.
 */
export default function EmbedTitle({ title }: { title: string }) {
  useEffect(() => {
    setEmbedTitle(title);
    reportTitle(title);
    return () => setEmbedTitle('');
  }, [title]);
  return null;
}
