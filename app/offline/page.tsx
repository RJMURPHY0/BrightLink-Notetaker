import { PRODUCT_NAME } from '@/lib/branding';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-6 text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-surface-card border border-surface-border flex items-center justify-center">
        <svg className="w-8 h-8 text-surface-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-ftc-gray text-lg mb-1">You're offline</p>
        <p className="text-sm text-ftc-mid max-w-xs">
          {PRODUCT_NAME} needs an internet connection to record and process meetings.
          Connect to Wi-Fi or mobile data and try again.
        </p>
      </div>
      <p className="text-xs text-surface-muted">
        Any recordings you already stopped are safely stored and will finish transcribing when you're back online.
      </p>
      <a href="/" className="btn-brand px-5 py-2.5 rounded-xl text-sm font-semibold text-white touch-manipulation">
        Try again
      </a>
    </div>
  );
}
