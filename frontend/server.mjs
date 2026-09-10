import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import http from 'node:http';

const port = Number(process.env.PORT || 8080);
const distDir = resolve('dist');
const indexPath = join(distDir, 'index.html');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function setCacheHeaders(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return;
  }

  if (filePath.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    contentTypes[ext] || 'application/octet-stream',
  );
  setCacheHeaders(res, filePath);
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host}`);

  if (requestUrl.pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (requestUrl.pathname === '/config.js') {
    const apiUrl = (process.env.API_URL || '').trim();
    const wsUrl = (process.env.WS_URL || '').trim();
    const defaultEntityId = (process.env.DEFAULT_ENTITY_ID || 'tw-entity-001').trim();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(
      `window.__APP_CONFIG__ = ${JSON.stringify({
        apiUrl,
        wsUrl,
        defaultEntityId,
        stagedOperationsEnabled: process.env.STAGED_OPERATIONS_ENABLED === 'true',
      })};`,
    );
    return;
  }

  const filePath = join(
    distDir,
    requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname,
  );

  if (existsSync(filePath) && !requestUrl.pathname.endsWith('/')) {
    sendFile(res, filePath);
    return;
  }

  try {
    const html = await readFile(indexPath, 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(html);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Unable to serve frontend: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Frontend server listening on 0.0.0.0:${port}`);
});
