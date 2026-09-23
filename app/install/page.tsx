'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, CheckCircle2 } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import { PRODUCT_SHORT_NAME } from '@/lib/branding';

// "Get the app", reached from BrightLink's Notetaker header. The Notetaker is an
// installable web app (public/manifest.json + sw.js): installed, it opens in
// its own window from the Start menu or Dock. Browsers only offer installation
// from a top-level page of the app's own site, never from inside a frame, which
// is why BrightLink opens this page in a new tab.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'installable' | 'safari-mac' | 'ios' | 'other';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)) return 'safari-mac';
  if (/Chrome|Chromium|Edg\//i.test(ua) && !/OPR\//i.test(ua)) return 'installable';
  return 'other';
}

export default function InstallPage() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>('installable');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    setPrompt(null);
    if (choice.outcome === 'accepted') setInstalled(true);
    else setDismissed(true);
  };

  let body: React.ReactNode;
  if (installed) {
    body = (
      <p className="flex items-center justify-center gap-2 text-sm text-ftc-gray">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        Installed. Open it from your Start menu or Dock.
      </p>
    );
  } else if (prompt) {
    body = (
      <button
        type="button"
        onClick={install}
        className="btn-brand inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
      >
        <Download className="h-4 w-4" /> Install
      </button>
    );
  } else if (platform === 'safari-mac') {
    body = <p className="text-sm text-ftc-gray">In Safari, choose File, then Add to Dock.</p>;
  } else if (platform === 'ios') {
    body = <p className="text-sm text-ftc-gray">Tap Share, then Add to Home Screen.</p>;
  } else if (platform === 'other') {
    body = <p className="text-sm text-ftc-gray">Open this page in Chrome or Edge to install it.</p>;
  } else {
    // A Chromium browser that has not offered installation: already installed,
    // or the browser keeps it in its own menu.
    body = (
      <p className="text-sm text-ftc-gray">
        {dismissed ? 'Not installed.' : 'Use Install in the address bar, or Install from the browser menu.'}
      </p>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-sm rounded-2xl border border-surface-border bg-surface-card p-6 text-center">
        <div className="mx-auto mb-4 flex h-10 justify-center">
          <BrandLogo className="h-full object-contain" />
        </div>
        <h1 className="text-lg font-semibold text-ftc-gray">Install {PRODUCT_SHORT_NAME}</h1>
        <p className="mt-1 mb-5 text-sm text-ftc-mid">It opens in its own window.</p>
        {body}
        <div className="mt-6 flex flex-col gap-2 text-sm">
          <Link href="/extension" className="text-brand underline underline-offset-2">Chrome extension</Link>
          <Link href="/" className="text-ftc-mid hover:text-ftc-gray">Continue in the browser</Link>
        </div>
      </div>
    </div>
  );
}
