import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('../../backend/node_modules/playwright');
const executablePath = [chromium.executablePath(), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);

test('production web server serves the real PWA assets and a browser caches only the public offline shell', {
  timeout: 60000, skip: !executablePath && 'No installed browser; never installs one',
}, async t => {
  assert.ok(existsSync(root + 'dist/index.html'), 'Build frontend before the runtime check');
  const lease = createServer(); lease.listen(0, '127.0.0.1'); await once(lease, 'listening');
  const port = lease.address().port; await new Promise(resolve => lease.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, [root + 'server.mjs'], {
    cwd: root, stdio: 'ignore', env: {
      ...process.env, PORT: String(port), API_URL: '/__offline_api', WS_URL: '',
      AFTER_SALES_MODULE_ENABLED: 'false', MAILROOM_ENABLED: 'true',
      STAGED_OPERATIONS_ENABLED: 'false', WMS_PORTAL_URL: '',
    },
  });
  let browser;
  t.after(async () => {
    try { await browser?.close(); }
    finally { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } }
  });
  let available = false;
  for (let attempt = 0; attempt < 50 && !available; attempt++) {
    try { available = (await fetch(origin + '/healthz')).ok; } catch { /* startup */ }
    if (!available) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(available, 'The isolated production server must start');
  const assets = ['/mailroom.webmanifest', '/mailroom-offline.html', '/brand/mailroom-icon.svg', '/brand/mailroom-icon-192.png', '/brand/mailroom-icon-512.png'];
  for (const path of ['/mailroom-sw.js', ...assets]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), readFileSync(root + 'public' + path));
    if (path.endsWith('.webmanifest')) assert.match(response.headers.get('content-type'), /^application\/manifest\+json/);
    if (path.endsWith('.js')) assert.match(response.headers.get('content-type'), /^application\/javascript/);
  }
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext(); const page = await context.newPage();
  const external = [], businessWrites = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { external.push(request.url()); return route.abort(); }
    if (request.method() !== 'GET') { businessWrites.push(request.method() + ' ' + url.pathname); return route.abort(); }
    if (url.pathname.startsWith('/__offline_api') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return route.abort();
    return route.continue();
  });
  await page.goto(origin + '/operations/mailroom?entityId=company-a&itemId=11111111-2222-4333-8444-555555555555');
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration('/operations/mailroom'))?.active?.state === 'activated');
  const cache = await page.evaluate(async () => {
    const names = await caches.keys();
    return { names, entries: await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname))) };
  });
  assert.deepEqual(cache.names, ['corely-mailroom-public-shell-v1']);
  assert.deepEqual(cache.entries[0].sort(), assets.sort());
  await context.setOffline(true);
  await page.goto(origin + '/operations/repair?entityId=company-a&itemId=11111111-2222-4333-8444-555555555555');
  await page.getByRole('heading', { name: '目前無法連線' }).waitFor();
  assert.equal(await page.locator('script,form').count(), 0);
  assert.equal(await page.locator('body').textContent().then(text => text.includes('11111111')), false);
  const unchanged = await page.evaluate(async () => (await (await caches.open('corely-mailroom-public-shell-v1')).keys()).map(request => new URL(request.url).pathname).sort());
  assert.deepEqual(unchanged, assets.sort());
  assert.deepEqual(external, []); assert.deepEqual(businessWrites, []);
});
