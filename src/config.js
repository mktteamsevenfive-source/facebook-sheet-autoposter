import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function absolute(value, fallback) {
  const selected = value || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(projectRoot, selected);
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export function loadConfig() {
  parseEnvFile(path.join(projectRoot, '.env'));
  const config = {
    spreadsheetId: process.env.SPREADSHEET_ID || '1vlt8wg7mzFU9b-FHznfKSzptcDLUfqPsColzc6rthgA',
    sheetName: process.env.SHEET_NAME || 'facebook_autopost',
    sheetId: Number(process.env.SHEET_ID || 1421564912),
    timezone: process.env.TIMEZONE || 'Asia/Bangkok',
    maxRows: Number(process.env.MAX_ROWS || 11000),
    mediaDir: absolute(process.env.MEDIA_DIR, '../facebook-autopost-media'),
    dataDir: absolute(process.env.DATA_DIR, './data'),
    accountConfigFile: absolute(process.env.ACCOUNT_CONFIG_FILE, './accounts.json'),
    googleAuthMode: (process.env.GOOGLE_AUTH_MODE || 'oauth').toLowerCase(),
    googleOauthClientFile: absolute(process.env.GOOGLE_OAUTH_CLIENT_FILE, './secrets/google-oauth-client.json'),
    googleTokenFile: absolute(process.env.GOOGLE_TOKEN_FILE, './secrets/google-token.json'),
    googleServiceAccountFile: absolute(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, './secrets/google-service-account.json'),
    publishEnabled: bool(process.env.PUBLISH_ENABLED, false),
    chromeChannel: process.env.CHROME_CHANNEL || 'chrome',
    facebookHeadless: bool(process.env.FACEBOOK_HEADLESS, false),
    navigationTimeoutMs: Number(process.env.FACEBOOK_NAVIGATION_TIMEOUT_MS || 60000),
    uploadTimeoutMs: Number(process.env.FACEBOOK_UPLOAD_TIMEOUT_MS || 180000),
    largeMediaThresholdBytes: Number(process.env.LARGE_MEDIA_THRESHOLD_MB || 100) * 1024 * 1024
  };
  if (!config.spreadsheetId || !config.sheetName || !Number.isInteger(config.sheetId)) {
    throw new Error('SPREADSHEET_ID, SHEET_NAME and SHEET_ID are required.');
  }
  return config;
}

export function readAccountConfig(config) {
  if (!fs.existsSync(config.accountConfigFile)) {
    throw new Error(`Missing ${config.accountConfigFile}. Copy accounts.example.json to accounts.json first.`);
  }
  const parsed = JSON.parse(fs.readFileSync(config.accountConfigFile, 'utf8'));
  if (!Array.isArray(parsed.accounts)) throw new Error('accounts.json must contain an accounts array.');
  return parsed.accounts.map((account) => ({
    ...account,
    profileDir: absolute(account.profileDir, './data/facebook-profiles/default')
  }));
}

