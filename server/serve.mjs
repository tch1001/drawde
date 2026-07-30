#!/usr/bin/env node
/**
 * drawde host.
 *
 *   node server/serve.mjs [--port 8080] [--root app/dist]
 *
 * Two jobs the plain static servers can't do:
 *
 *  1. URL-prefix routing. `drawde.example/https://arxiv.org/pdf/1907.04392` has
 *     to serve the app, not 404 — every non-asset path falls through to
 *     index.html and the client reads the target out of the address bar.
 *
 *  2. A PDF proxy. arXiv sends `access-control-allow-origin: *`, so the browser
 *     fetches it directly and this never runs. Most other hosts don't, and the
 *     browser blocks those — `/_proxy?url=` fetches them server-side instead.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(argOf('--port', process.env.PORT || 8080));
const ROOT = resolve(argOf('--root', new URL('../app/dist', import.meta.url).pathname));
const MAX_PDF_BYTES = 100 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** Only real files under ROOT; anything else falls through to the SPA. */
async function tryFile(pathname) {
  // decode + normalize, then verify it is still inside ROOT (path traversal)
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  } catch {
    return null;
  }
  const full = resolve(join(ROOT, rel));
  if (full !== ROOT && !full.startsWith(ROOT + '/')) return null;
  try {
    const s = await stat(full);
    if (s.isFile()) return { full, size: s.size };
  } catch {}
  return null;
}

async function proxyPdf(req, res, target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    res.writeHead(400).end('Invalid url parameter');
    return;
  }
  // Don't let the proxy be pointed at the private network it runs inside.
  if (!/^https?:$/.test(url.protocol)) {
    res.writeHead(400).end('Only http(s) URLs are supported');
    return;
  }
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(url.hostname)) {
    res.writeHead(403).end('Refusing to proxy private addresses');
    return;
  }

  try {
    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: {
        // some hosts serve a bot page to header-less clients
        'user-agent': 'Mozilla/5.0 (compatible; drawde/1.0; +https://github.com/tch1001/drawde)',
        accept: 'application/pdf,*/*',
      },
    });
    if (!upstream.ok) {
      res.writeHead(upstream.status).end(`Upstream returned ${upstream.status}`);
      return;
    }
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len && len > MAX_PDF_BYTES) {
      res.writeHead(413).end('PDF too large');
      return;
    }
    res.writeHead(200, {
      'content-type': upstream.headers.get('content-type') || 'application/pdf',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.writeHead(502).end(`Could not fetch: ${e?.message ?? e}`);
  }
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (u.pathname === '/_proxy') {
    const target = u.searchParams.get('url');
    if (!target) return void res.writeHead(400).end('Missing url parameter');
    return void proxyPdf(req, res, target);
  }

  if (u.pathname === '/_health') {
    return void res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  }

  const file = await tryFile(u.pathname);
  if (file) {
    const type = MIME[extname(file.full).toLowerCase()] || 'application/octet-stream';
    // hashed asset names are safe to cache hard; index.html must not be
    const immutable = /\/assets\//.test(u.pathname);
    res.writeHead(200, {
      'content-type': type,
      'content-length': file.size,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    return void createReadStream(file.full).pipe(res);
  }

  // SPA fallback: any other path is a PDF target for the client to parse
  const index = await tryFile('/index.html');
  if (!index) {
    return void res
      .writeHead(500, { 'content-type': 'text/plain' })
      .end(`No build found at ${ROOT}. Run: cd app && npx vite build`);
  }
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
  createReadStream(index.full).pipe(res);
});

server.listen(PORT, () => {
  console.log(`drawde serving ${ROOT}`);
  console.log(`  http://127.0.0.1:${PORT}/`);
  console.log(`  http://127.0.0.1:${PORT}/https://arxiv.org/pdf/1907.04392`);
});
