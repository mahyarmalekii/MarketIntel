import type { ApiFetch } from "./types";

// Parse a Response as JSON, throwing a useful error on non-2xx responses.
// Use this instead of `.then(r => r.json())` so failed requests don't silently
// hand garbage to setState (which then crashes downstream renders).
export async function okJson<T = unknown>(p: Promise<Response>): Promise<T> {
  const r = await p;
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const body = await r.text();
      if (body) {
        try { detail = JSON.parse(body).detail ?? body; }
        catch { detail = body; }
      }
    } catch { /* ignore */ }
    throw new Error(`${r.status} ${detail}`);
  }
  return r.json() as Promise<T>;
}

export const getJson = <T = unknown>(api: ApiFetch, path: string, opts?: RequestInit): Promise<T> =>
  okJson<T>(api(path, opts));
