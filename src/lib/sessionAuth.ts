let cachedToken: string | null = null;
let inflight: Promise<string | null> | null = null;

export async function getSessionToken(forceRefresh = false): Promise<string | null> {
  if (cachedToken && !forceRefresh) return cachedToken;
  if (inflight && !forceRefresh) return inflight;

  inflight = fetch('/api/session', { credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string };
      cachedToken = typeof data.token === 'string' ? data.token : null;
      return cachedToken;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearCachedSessionToken(): void {
  cachedToken = null;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function safeHexColor(color: string | undefined, fallback = '#3b82f6'): string {
  return color && HEX_COLOR_RE.test(color) ? color : fallback;
}
