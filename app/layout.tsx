import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import GlobalChatWidget from '@/components/GlobalChatWidget';
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar';
import LiveFxSync from '@/components/LiveFxSync';
import EmbedBridge from '@/components/EmbedBridge';
import { PRODUCT_SHORT_NAME, TAB_TITLE } from '@/lib/branding';

// Brand font parity with the BrightLink CRM (Inter). Exposed as a CSS variable so
// tailwind.config's fontFamily.sans picks it up app-wide.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: TAB_TITLE,
  description: 'Record any conversation and get an instant transcript, summary, and action items powered by AI.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: PRODUCT_SHORT_NAME,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1a1a1a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Set theme before first paint to avoid a flash. Default is dark;
            only switches to light when the user has chosen it (key: ftc-theme). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ftc-theme');document.documentElement.classList.toggle('dark',t!=='light')}catch(e){}`,
          }}
        />
        {/* Inside BrightLink (only its origins may frame this app, see
            next.config.js): mark the page embedded before first paint so the
            global chrome is never drawn (data-nt-chrome, globals.css), follow
            BrightLink's theme, and never add browser-history entries. BrightLink
            owns the address and Back; a pushState in here would add a second
            entry to the same Back button, so pushes become replaces.
            See lib/embed-bridge.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(window.self!==window.top){var d=document.documentElement;d.dataset.embed='1';try{var bt=sessionStorage.getItem('bl-theme');if(bt)d.classList.toggle('dark',bt!=='light')}catch(e){}var rs=history.replaceState;history.pushState=function(s,u,l){return rs.call(history,s,u,l)}}}catch(e){}`,
          }}
        />
        {/* Warm the TLS connection to Supabase before the first auth call —
            saves a DNS + handshake round-trip on sign-in and SSO handoff. */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
        )}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=4" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png?v=4" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png?v=4" />
      </head>
      <body className="min-h-screen">
        {children}
        <LiveFxSync />
        {/* Inside BrightLink its own assistant is on screen; one chat, not two. */}
        <div data-nt-chrome>
          <GlobalChatWidget />
        </div>
        <ServiceWorkerRegistrar />
        <Suspense fallback={null}>
          <EmbedBridge />
        </Suspense>
      </body>
    </html>
  );
}
