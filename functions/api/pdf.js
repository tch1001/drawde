/**
 * Cloudflare Pages Function: PDF proxy.
 *
 * Route: /api/pdf?url=<encoded pdf url>
 *
 * The only server-side code drawde needs. Most of the app is static — rendering,
 * OCR and the LLM calls all happen in the browser — but a PDF whose host refuses
 * cross-origin requests can't be fetched by the page itself. arXiv sends
 * `access-control-allow-origin: *`, so the common case never reaches here; this
 * is the fallback for everything else.
 *
 * Mirrors the `/api/pdf` handler in server/serve.mjs so self-hosting and Pages
 * behave identically.
 */

const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** Block the proxy from being aimed at private networks (SSRF). */
function isPrivateHost(hostname) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1|\[?fc|\[?fd)/i.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

export async function onRequestGet({ request }) {
  const target = new URL(request.url).searchParams.get('url');
  if (!target) return new Response('Missing url parameter', { status: 400 });

  let url;
  try {
    url = new URL(target);
  } catch {
    return new Response('Invalid url parameter', { status: 400 });
  }
  if (!/^https?:$/.test(url.protocol)) {
    return new Response('Only http(s) URLs are supported', { status: 400 });
  }
  if (isPrivateHost(url.hostname)) {
    return new Response('Refusing to proxy private addresses', { status: 403 });
  }

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      redirect: 'follow',
      headers: {
        // some hosts serve a bot page to header-less clients
        'user-agent':
          'Mozilla/5.0 (compatible; drawde/1.0; +https://github.com/tch1001/drawde)',
        accept: 'application/pdf,*/*',
      },
    });
  } catch (e) {
    return new Response(`Could not fetch: ${e?.message ?? e}`, { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(`Upstream returned ${upstream.status}`, { status: upstream.status });
  }
  const len = Number(upstream.headers.get('content-length') || 0);
  if (len && len > MAX_PDF_BYTES) {
    return new Response('PDF too large', { status: 413 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/pdf',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    },
  });
}
