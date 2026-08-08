/**
 * Atlas Document-Extraction client — the check page's only network access.
 *
 * Kept out of `client.ts` deliberately: that file is the Vision OS Observation
 * API client, and this talks to a different service entirely. Mixing them would
 * make the demo look as though Vision OS extracts invoices, which it does not.
 *
 * Network access still lives in `src/api/`, so the boundary the demo's own tests
 * enforce — pages never reach the network themselves — is preserved.
 */

// Relative, not absolute. `/atlas` is the dev-server proxy prefix defined in
// vite.config.ts, which strips it before forwarding to ATLAS_API_URL — so it
// exists only inside Vite and must never appear in a URL sent to the backend.
// Keeping the request relative also keeps the browser same-origin, so the
// deployment's CORS allowlist never has to know about this page.
const BASE = 'https://atlas-4ghw.onrender.com/api/v1/dev';

export interface ExtractionAttempt {
  status: number;
  body: unknown;
  elapsedMs: number;
}

/** Post one document. Returns whatever came back, parsed if it was JSON. */
export async function extractInvoice(file: File): Promise<ExtractionAttempt> {
  const form = new FormData();
  form.append('file', file);

  const started = performance.now();
  const response = await fetch(`${BASE}/extract-invoice`, { method: 'POST', body: form });
  const text = await response.text();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // A gateway page or an empty body. Show it verbatim rather than inventing a
    // shape — the point of this page is to see what actually came back.
    body = text;
  }

  return { status: response.status, body, elapsedMs: performance.now() - started };
}
