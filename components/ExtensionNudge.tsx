// Point Chrome users at the one-click path.
//
// The browser's share picker cannot be removed from a web page — Chrome
// mandates it — so the only honest way to offer one-click recording here is to
// point at the thing that has it. Shown only in Chromium on a desktop, where
// the extension can actually be installed, and dismissible so it does not
// nag someone who has decided against it.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MousePointerClick, X } from 'lucide-react';

const DISMISSED_KEY = 'ftc-extension-nudge-dismissed';

export default function ExtensionNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISSED_KEY)) return;
    } catch { /* private mode — just show it */ }

    const ua = navigator.userAgent;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    const isChromium = !isMobile
      && /Chrome|Chromium|Edg\//i.test(ua)
      && !/OPR\//i.test(ua);
    setShow(isChromium);
  }, []);

  if (!show) return null;

  return (
    <div className="w-full max-w-sm rounded-2xl border border-brand/25 bg-brand/5 p-4">
      <div className="flex items-start gap-3">
        <MousePointerClick className="w-4 h-4 text-brand mt-0.5 flex-none" />
        <div className="flex-1 space-y-1.5">
          <p className="text-sm font-medium text-ftc-gray">Record in one click</p>
          <p className="text-xs text-ftc-mid leading-relaxed">
            The Chrome extension skips the share picker entirely and reads everyone&apos;s
            real name from the meeting&apos;s participant list.
          </p>
          <Link
            href="/extension"
            className="inline-block text-xs font-semibold text-brand hover:underline underline-offset-2"
          >
            Set it up →
          </Link>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            try { window.localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
            setShow(false);
          }}
          className="flex-none text-surface-muted hover:text-ftc-mid transition-colors touch-manipulation"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
