#!/usr/bin/env node
/* eslint-disable no-console */
const crypto = require('crypto');
const http = require('http');
const { execFile } = require('child_process');
const readline = require('readline');

const PORT = Number(process.env.PORT || 53682);
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  if (!hidden) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  return new Promise((resolve) => {
    const onData = (char) => {
      char = String(char);
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          break;
        default:
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(question + '*'.repeat(rl.line.length));
          break;
      }
    };
    process.stdin.on('data', onData);
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function openUrl(url) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(command, args, (error) => {
    if (error) {
      console.log('Open this URL manually:');
      console.log(url);
    }
  });
}

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || '', REDIRECT_URI);
        const error = url.searchParams.get('error');
        if (error) {
          res.end('Authorization failed. You can close this tab.');
          server.close();
          reject(new Error(error));
          return;
        }
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        if (state !== expectedState || !code) {
          res.statusCode = 400;
          res.end('Invalid OAuth callback. You can close this tab.');
          return;
        }
        res.end('Google Ads OAuth completed. You can return to Terminal.');
        server.close();
        resolve(code);
      } catch (error) {
        server.close();
        reject(error);
      }
    });
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Listening for OAuth callback on ${REDIRECT_URI}`);
    });
  });
}

async function exchangeCode({ clientId, clientSecret, code }) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.refresh_token) {
    throw new Error(
      `Token exchange failed: ${body.error_description || body.error || response.statusText}`,
    );
  }
  return body.refresh_token;
}

async function main() {
  console.log('Google Ads OAuth refresh token helper');
  console.log(`Redirect URI to add to OAuth client if needed: ${REDIRECT_URI}`);
  console.log('');

  const clientId =
    process.env.GOOGLE_ADS_CLIENT_ID ||
    (await ask('Paste Google OAuth client ID: '));
  const clientSecret =
    process.env.GOOGLE_ADS_CLIENT_SECRET ||
    (await ask('Paste Google OAuth client secret (hidden): ', { hidden: true }));

  if (!clientId || !clientSecret) {
    throw new Error('Client ID and client secret are required');
  }

  const state = crypto.randomBytes(18).toString('hex');
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  const codePromise = waitForCode(state);
  openUrl(authUrl.toString());
  console.log('Browser opened. Sign in with the Google account that can access Google Ads.');
  const code = await codePromise;
  const refreshToken = await exchangeCode({ clientId, clientSecret, code });

  console.log('');
  console.log('Refresh token generated. Store it in Secret Manager; do not commit it.');
  console.log('');
  console.log(refreshToken);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
