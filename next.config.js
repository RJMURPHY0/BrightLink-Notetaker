/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === 'development';

// BrightLink (the CRM) shows the Notetaker inside its own pages, in a frame.
// Only BrightLink may do that: CRM_ALLOWED_ORIGINS (comma separated, already
// the CORS list for the CRM's calls) adds origins beyond app.brightlink.io, and
// a development build also accepts any localhost port. frame-ancestors is the
// whole rule; X-Frame-Options was DENY and cannot name an origin, and browsers
// ignore it once frame-ancestors is present, so it is gone rather than left to
// contradict it. See lib/embed-bridge.ts.
const CRM_ORIGINS = [
  'https://app.brightlink.io',
  // The CRM is served on www too until the marketing site moves to its own
  // project, and people are signed in there (every frame failure on 2026-09-24).
  'https://www.brightlink.io',
  ...(process.env.CRM_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
];
const frameAncestors = ["'self'", ...CRM_ORIGINS, ...(isDev ? ['http://localhost:*', 'http://127.0.0.1:*'] : [])].join(' ');

const securityHeaders = [
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'X-XSS-Protection',          value: '1; mode=block' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), geolocation=(), microphone=(self)' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' https://api.anthropic.com https://api.groq.com https://api.openai.com https://ijeeghdxokfvlfarojlm.supabase.co",
      "font-src 'self'",
      `frame-ancestors ${frameAncestors}`,
    ].join('; '),
  },
];

// Voice-ID native deps: keep out of the webpack bundle (loaded via require at
// runtime) and force-trace the platform binaries that dynamic requires hide
// from Vercel's file tracer.
const voiceIdTraceIncludes = [
  './node_modules/sherpa-onnx-node/**',
  './node_modules/sherpa-onnx-linux-x64/**',
  './node_modules/ffmpeg-static/**',
];

// The .docx / .pdf exporters read the wordmark off disk at request time
// (lib/export-doc.ts → readDocLogo). Nothing imports it, so the tracer can't
// see it and the serverless bundle shipped without it — the logo silently
// vanished from every document generated in production while still appearing
// in local builds. Force-trace it.
const docLogoTraceIncludes = [
  './public/logo-dark.png',
  './public/logo.png',
];

const nextConfig = {
  // The same list, for the browser side of the bridge (lib/embed-bridge.ts).
  env: {
    NEXT_PUBLIC_CRM_ORIGINS: process.env.NEXT_PUBLIC_CRM_ORIGINS || process.env.CRM_ALLOWED_ORIGINS || '',
  },
  experimental: {
    serverComponentsExternalPackages: ['sherpa-onnx-node', 'ffmpeg-static'],
    // Both key forms — with and without /route — since Next matches the
    // compiled route entry name, which differs across versions.
    outputFileTracingIncludes: Object.fromEntries([
      ...[
        '/api/recordings/[id]/append-chunk',
        '/api/recordings/[id]/finalize',
        '/api/recordings/[id]/rediarize',
        '/api/jobs/finalize',
        '/api/voice-profiles',
        '/api/transcribe',
        '/api/health',
      ].flatMap((route) => [
        [route, voiceIdTraceIncludes],
        [`${route}/route`, voiceIdTraceIncludes],
      ]),
      ...[
        '/api/recordings/[id]/export/word',
        '/api/recordings/[id]/export/pdf',
      ].flatMap((route) => [
        [route, docLogoTraceIncludes],
        [`${route}/route`, docLogoTraceIncludes],
      ]),
    ]),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/manifest.json',
        headers: [{ key: 'Content-Type', value: 'application/manifest+json' }],
      },
    ];
  },
};

module.exports = nextConfig;
