import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import http from 'node:http';
import https from 'node:https';

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
    res.setHeader('Referrer-Policy', 'no-referrer');
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

  // The original Next application keeps its own Server Actions and rendering.
  // Only this fixed same-origin mount is forwarded; it cannot proxy arbitrary URLs.
  if (requestUrl.pathname === '/after-sales-app' || requestUrl.pathname.startsWith('/after-sales-app/')) {
    const upstream = process.env.AFTER_SALES_MODULE_URL || '';
    const enabled = process.env.AFTER_SALES_MODULE_ENABLED === 'true';
    if (!enabled || !/^https:\/\/corely-aftersales-module-dev-sp5g377smq-de\.a\.run\.app$/.test(upstream)) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: '售後整合模組尚未開通' })); return;
    }
    const target = new URL(upstream + requestUrl.pathname + requestUrl.search);
    const headers = { ...req.headers, host: target.hostname,
      'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'https' };
    delete headers['x-erp-operation-mode'];
    const forwarded = https.request(target, { method: req.method, headers, timeout: 60000 }, response => {
      const responseHeaders = { ...response.headers, 'Cache-Control': 'no-store' };
      delete responseHeaders['x-frame-options'];
      const mountedRedirect = (value) => {
        if (typeof value !== 'string') return value;
        const [destination, ...suffix] = value.split(';');
        let local = destination;
        try { const parsed = new URL(destination, upstream); if (parsed.origin === upstream && destination.startsWith('http')) local = parsed.pathname + parsed.search + parsed.hash; } catch { return value; }
        if (local.startsWith('/') && !local.startsWith('//') && !local.startsWith('/after-sales-app')) local = '/after-sales-app' + local;
        return [local,...suffix].join(';');
      };
      for (const key of ['location','x-action-redirect']) if (responseHeaders[key]) responseHeaders[key] = mountedRedirect(responseHeaders[key]);
      res.writeHead(response.statusCode || 502, responseHeaders); response.pipe(res);
    });
    forwarded.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Cache-Control': 'no-store' }); res.end('售後模組暫時無法連線'); });
    forwarded.on('timeout', () => forwarded.destroy());
    req.on('aborted', () => forwarded.destroy()); req.pipe(forwarded); return;
  }

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
        wmsPortalUrl: process.env.WMS_PORTAL_URL || '',
        apiUrl,
        wsUrl,
        defaultEntityId,
        b2bPublicOrderEnabled: process.env.B2B_PUBLIC_ORDER_ENABLED === 'true',
        mailroomEnabled: process.env.MAILROOM_ENABLED === 'true',
        stagedOperationsEnabled: process.env.STAGED_OPERATIONS_ENABLED === 'true',
        afterSalesModuleEnabled: process.env.AFTER_SALES_MODULE_ENABLED === 'true',
        devEnvironment: process.env.ERP_DEV_ENVIRONMENT === 'true',
        dataSnapshotDate: process.env.ERP_DEV_SNAPSHOT_DATE || '',
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
    res.setHeader('Referrer-Policy', 'no-referrer');
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
