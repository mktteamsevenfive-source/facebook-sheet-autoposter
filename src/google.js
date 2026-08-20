import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { google } from 'googleapis';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly'
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function loginGoogle(config) {
  const oauthConfig = await readJson(config.googleOauthClientFile);
  const details = oauthConfig.installed || oauthConfig.web;
  if (!details) throw new Error('Google OAuth file must contain an installed or web client.');
  const state = crypto.randomBytes(24).toString('hex');
  let finish;
  let fail;
  const callback = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      if (url.searchParams.get('state') !== state) throw new Error('OAuth state did not match.');
      const error = url.searchParams.get('error');
      if (error) throw new Error(`Google authorization failed: ${error}`);
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Google authorization did not return a code.');
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Google authorization completed. You can close this tab.');
      finish(code);
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.message);
      fail(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const client = new google.auth.OAuth2(details.client_id, details.client_secret, redirectUri);
  const authorizationUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state
  });
  console.log(`Opening Google authorization in your default browser:\n${authorizationUrl}`);
  const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', authorizationUrl], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  browser.unref();
  const timeout = setTimeout(() => fail(new Error('Google authorization timed out after 5 minutes.')), 300000);
  let code;
  try {
    code = await callback;
  } finally {
    clearTimeout(timeout);
    server.close();
  }
  const tokenResponse = await client.getToken(code);
  client.setCredentials(tokenResponse.tokens);
  if (!client.credentials.refresh_token) {
    throw new Error('Google did not return a refresh token. Revoke the app grant and run login again.');
  }
  const token = {
    type: 'authorized_user',
    client_id: details.client_id,
    client_secret: details.client_secret,
    refresh_token: client.credentials.refresh_token
  };
  await fs.mkdir(path.dirname(config.googleTokenFile), { recursive: true });
  await fs.writeFile(config.googleTokenFile, `${JSON.stringify(token, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return config.googleTokenFile;
}

export async function getGoogleClients(config) {
  let auth;
  if (config.googleAuthMode === 'service_account') {
    auth = new google.auth.GoogleAuth({ keyFile: config.googleServiceAccountFile, scopes: GOOGLE_SCOPES });
  } else if (config.googleAuthMode === 'oauth') {
    const authorizedUser = await readJson(config.googleTokenFile).catch(() => null);
    if (!authorizedUser) throw new Error(`Google token not found. Run: npm run login:google`);
    auth = google.auth.fromJSON(authorizedUser);
    auth.scopes = GOOGLE_SCOPES;
  } else {
    throw new Error(`Unsupported GOOGLE_AUTH_MODE: ${config.googleAuthMode}`);
  }
  return {
    auth,
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth })
  };
}
