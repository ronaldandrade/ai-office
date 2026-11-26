let sessionReady = false;
let inflight: Promise<boolean> | null = null;

export async function ensureSession(forceRefresh = false): Promise<boolean> {
  if (sessionReady && !forceRefresh) return true;
  if (inflight && !forceRefresh) return inflight;

  inflight = fetch('/api/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'X-Office-Bootstrap': '1',
    },
  })
    .then((res) => {
      sessionReady = res.ok;
      return res.ok;
    })
    .catch(() => {
      sessionReady = false;
      return false;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearCachedSession(): void {
  sessionReady = false;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function safeHexColor(color: string | undefined, fallback = '#3b82f6'): string {
  return color && HEX_COLOR_RE.test(color) ? color : fallback;
}
