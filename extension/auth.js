// The extension's copy of the user's Supabase session.
//
// Paired once from the web app's connect page, then refreshed here the same
// way any Supabase client refreshes: POST the refresh token to the project's
// token endpoint with the public anon key. Nothing secret is stored that the
// browser was not already holding for the same user on the same machine.
//
// An access token lasts an hour, and meetings run longer than that, so a
// recording that could not refresh mid-call would fail its uploads two thirds
// of the way through. Refreshing eagerly, a minute before expiry, is the whole
// reason this file exists.

const REFRESH_MARGIN_MS = 60_000;

let refreshing = null; // de-duplicates concurrent refreshes

export async function setToken(auth) {
  await chrome.storage.local.set({ auth });
}

export async function clearToken() {
  await chrome.storage.local.remove('auth');
}

export async function getAuth() {
  const { auth } = await chrome.storage.local.get('auth');
  return auth ?? null;
}

/**
 * A valid access token, refreshed if it is about to expire. Null when the
 * extension has never been paired or the refresh token has been revoked.
 */
export async function getToken() {
  const auth = await getAuth();
  if (!auth?.accessToken) return null;

  const expiresAt = Number(auth.expiresAt ?? 0) * 1000;
  if (expiresAt && Date.now() < expiresAt - REFRESH_MARGIN_MS) {
    return auth.accessToken;
  }

  if (!auth.refreshToken || !auth.supabaseUrl || !auth.supabaseAnonKey) {
    // Paired by an older connect page that sent no refresh token. Usable until
    // it expires, then the user reconnects.
    return expiresAt && Date.now() >= expiresAt ? null : auth.accessToken;
  }

  refreshing ??= refresh(auth).finally(() => { refreshing = null; });
  return refreshing;
}

async function refresh(auth) {
  try {
    const res = await fetch(`${auth.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: auth.supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: auth.refreshToken }),
    });
    if (!res.ok) {
      // A revoked or rotated refresh token is terminal: the user signed out
      // somewhere, and the correct response is to make them reconnect rather
      // than to keep a dead session around looking connected.
      if (res.status === 400 || res.status === 401) await clearToken();
      return null;
    }
    const data = await res.json();
    if (!data.access_token) return null;

    await setToken({
      ...auth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? auth.refreshToken,
      expiresAt: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    });
    return data.access_token;
  } catch (e) {
    console.warn('[ftc] token refresh failed:', e.message);
    return null;
  }
}
