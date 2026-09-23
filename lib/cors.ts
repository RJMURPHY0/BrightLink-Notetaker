// Cross-origin allowances, in one place.
//
// Three other surfaces talk to this API from another origin:
//
//   the CRM (Brightlink)  — ticks action items off a meeting's summary
//   the Chrome extension  — uploads one-click tab captures and participant lists
//   a local dev server    — either of the above, on localhost
//
// The extension is the reason this moved out of the summary route. An MV3
// extension's origin is `chrome-extension://<id>`, and the id is not a secret
// but is also not guessable, so allowing a specific id is a real restriction
// rather than a decorative one. Allowing `chrome-extension://*` would let ANY
// installed extension read this user's meetings, which is precisely the attack
// the same-origin policy exists to prevent.

const CRM_ORIGINS = [
  'https://app.brightlink.io',
  ...(process.env.CRM_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
];

// Comma-separated extension ids, NOT full origins: the `chrome-extension://`
// scheme is added here so a mis-set env var cannot smuggle in an http origin.
const EXTENSION_ORIGINS = (process.env.EXTENSION_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => /^[a-p]{32}$/.test(s))
  .map((id) => `chrome-extension://${id}`);

const LOCALHOST = /^http:\/\/localhost:\d+$/;

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true; // same-origin request — no Origin header is sent
  return CRM_ORIGINS.includes(origin)
    || EXTENSION_ORIGINS.includes(origin)
    || LOCALHOST.test(origin)
    // An unpacked extension loaded from disk during development has an id that
    // changes on every reload, so it cannot be listed. Permitted only when the
    // server is itself running in development.
    || (process.env.NODE_ENV !== 'production' && origin.startsWith('chrome-extension://'));
}

export function corsHeaders(
  origin: string | null,
  methods = 'GET, POST, PATCH, OPTIONS',
): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
