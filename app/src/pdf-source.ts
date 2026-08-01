/**
 * Resolves which PDF to open from the URL.
 *
 *   drawde.tchlabs.net/https://arxiv.org/pdf/1907.04392   ← full URL
 *   drawde.tchlabs.net/arxiv.org/pdf/1907.04392           ← scheme optional
 *   drawde.tchlabs.net/https://arxiv.org/abs/2510.01051   ← abstract page works too
 *   drawde.tchlabs.net/2510.01051                         ← a bare arXiv id
 *
 * Nothing after the origin means the bundled sample paper.
 */

export const SAMPLE_PDF = './sample.pdf';

/** e.g. 2510.01051, 2510.01051v2, hep-th/9711200 */
const ARXIV_ID = /^(\d{4}\.\d{4,5}(v\d+)?|[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?)$/;

export interface PdfSource {
  /** URL to load, or null for the bundled sample. */
  url: string | null;
  /** Short human label for the toolbar. */
  label: string;
}

/** arXiv abstract pages aren't PDFs — send people to the PDF they meant. */
function arxivAbsToPdf(u: URL): URL {
  if (!/(^|\.)arxiv\.org$/i.test(u.hostname)) return u;
  const m = u.pathname.match(/^\/abs\/(.+)$/);
  if (!m) return u;
  const out = new URL(u.toString());
  out.pathname = `/pdf/${m[1]}`;
  return out;
}

/**
 * Everything after the leading slash is the target. Read it from the raw href
 * rather than location.pathname: a target URL contains its own `?query` and
 * `#hash`, which the browser would otherwise split off as ours.
 */
export function rawTargetFromHref(href: string, origin: string): string {
  let rest = href.startsWith(origin) ? href.slice(origin.length) : new URL(href).pathname;
  rest = rest.replace(/^\/+/, '');
  // Tolerate a collapsed scheme: some servers and copy-paste turn "https://x"
  // into "https:/x".
  rest = rest.replace(/^(https?:)\/{1,2}/i, '$1//');
  return rest;
}

export function resolvePdfSource(href: string, origin: string): PdfSource {
  const raw = decodeURIComponent(rawTargetFromHref(href, origin));
  if (!raw) return { url: null, label: 'sample paper' };

  // bare arXiv id
  if (ARXIV_ID.test(raw)) {
    return { url: `https://arxiv.org/pdf/${raw}`, label: `arXiv:${raw}` };
  }

  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { url: null, label: 'sample paper' };
  }
  u = arxivAbsToPdf(u);

  const arxiv = /(^|\.)arxiv\.org$/i.test(u.hostname) && u.pathname.match(/^\/pdf\/(.+?)(\.pdf)?$/);
  return {
    url: u.toString(),
    label: arxiv ? `arXiv:${arxiv[1]}` : u.hostname + u.pathname,
  };
}

/**
 * Fetch the PDF, falling back to our proxy when the host doesn't serve CORS.
 *
 * Direct-first matters: arXiv sends `access-control-allow-origin: *`, so the
 * common case never touches our server and costs us no bandwidth. The proxy is
 * only for hosts that refuse — and it's absent on a purely static deployment,
 * which is why its failure is reported distinctly.
 */
export async function fetchPdf(url: string, signal?: AbortSignal): Promise<Blob> {
  try {
    const res = await fetch(url, { signal, redirect: 'follow' });
    if (res.ok) return await res.blob();
    throw new Error(`${res.status} ${res.statusText}`);
  } catch (direct: any) {
    if (signal?.aborted) throw direct;
    // Same path on both deployments: a Pages Function in production
    // (functions/api/pdf.js), the equivalent handler in server/serve.mjs when
    // self-hosting. Not `/_proxy`: Pages reserves leading-underscore names.
    const res = await fetch(`/api/pdf?url=${encodeURIComponent(url)}`, { signal }).catch(
      () => null,
    );
    if (!res) {
      throw new Error(
        `Could not load ${url} — the site blocked the request and no proxy is available here.`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Could not load ${url} — ${detail.slice(0, 200) || res.statusText}`);
    }
    return await res.blob();
  }
}
