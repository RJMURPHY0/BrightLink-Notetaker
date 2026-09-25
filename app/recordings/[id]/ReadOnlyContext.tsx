'use client';

// A meeting opened by a colleague it was shared with (tagged as having been
// there) is read-only: they see everything and change nothing. The server
// refuses their writes anyway (every write route checks canAccessRecording
// alone); this only stops the page offering controls that would fail.
import { createContext, useContext } from 'react';

const ReadOnly = createContext(false);

export function ReadOnlyProvider({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  return <ReadOnly.Provider value={readOnly}>{children}</ReadOnly.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnly);
}
