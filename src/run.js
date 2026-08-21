import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, readAccountConfig } from './config.js';
import { getGoogleClients } from './google.js';
import { eligibilityReason, selectOldestEligible } from './eligibility.js';
import { formatDurationCell, readRow, readTable, updateRow } from './sheet.js';
import { ensureMedia } from './media.js';
import { prepareFacebookPost } from './facebook.js';
import { displayTimestamp, sheetTimestamp } from './time.js';

function log(event, details = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...details }));
}

async function acquireLock(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, 'run.lock');
  let handle;
  try {
    handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another run is active (${lockPath}).`);
    throw error;
  }
  return async () => {
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  };
}

function replaceRow(rows, row) {
  return rows.map((candidate) => candidate.__rowNumber === row.__rowNumber ? row : candidate);
}

async function prefetchMissingMedia({ sheets, config, headers, rows, drive }) {
  const candidates = rows.filter((row) =>
    String(row['Local Media Path'] || '').trim() === '' &&
    String(row['Media URL 1'] || '').trim() !== '' &&
    String(row['Posted URL'] || '').trim() === ''
  );
  for (const row of candidates) {
    try {
      await ensureMedia({
        row,
        drive,
        mediaDir: config.mediaDir,
        largeFileBytes: config.largeMediaThresholdBytes,
        onLocalPath: async (localPath) => {
          await updateRow(sheets, config, headers, row.__rowNumber, { 'Local Media Path': localPath });
        }
      });
      log('media-prefetched', { row: row.__rowNumber, postId: row['Post ID'] });
    } catch (error) {
      log('media-prefetch-failed', { row: row.__rowNumber, postId: row['Post ID'], message: error.message });
    }
  }
}

async function writeTerminalState({ sheets, config, headers, row, startMs, updates }) {
  const elapsedDays = (Date.now() - startMs) / 86400000;
  await updateRow(sheets, config, headers, row.__rowNumber, { ...updates, 'time use': elapsedDays });
  await formatDurationCell(sheets, config, headers, row.__rowNumber);
}

async function main() {
  const config = loadConfig();
  const commandDryRun = process.argv.includes('--dry-run');
  const live = config.publishEnabled && !commandDryRun;
  const releaseLock = await acquireLock(config.dataDir);
  let prepared = null;
  let selected = null;
  let headers = null;
  let sheets = null;
  let drive = null;
  let table = null;
  let startMs = null;
  try {
    const accounts = readAccountConfig(config);
    const knownAccounts = new Set(accounts.map((item) => item.sheetAccount.trim().toLowerCase()));
    const clients = await getGoogleClients(config);
    sheets = clients.sheets;
    drive = clients.drive;
    startMs = Date.now(); // starts immediately before the first Sheet cell read
    table = await readTable(sheets, config);
    headers = table.headers;
    selected = selectOldestEligible(table.rows, new Date(), config.timezone, knownAccounts);
    if (!selected) {
      log('no-eligible-row', { mode: live ? 'live' : 'dry-run', localTime: displayTimestamp(new Date(), config.timezone) });
      return;
    }

    const current = await readRow(sheets, config, headers, selected.__rowNumber);
    const currentRows = replaceRow(table.rows, current);
    const reason = eligibilityReason(current, currentRows, new Date(), config.timezone, knownAccounts);
    if (reason || String(current['Post ID']) !== String(selected['Post ID'])) {
      log('row-changed-before-processing', { row: selected.__rowNumber, postId: selected['Post ID'], reason: reason || 'Post ID changed' });
      return;
    }
    selected = current;
    log('selected', {
      mode: live ? 'live' : 'dry-run', row: selected.__rowNumber, postId: selected['Post ID'],
      scheduledTime: selected['Scheduled Time'], account: selected['Facebook Account'], group: selected['Facebook Group URL']
    });
    if (!live) {
      log('dry-run-complete', { note: 'No media, browser, Facebook, or Sheet writes were performed.' });
      return;
    }

    const attempts = Number(selected['Attempt Count'] || 0);
    const mediaPaths = await ensureMedia({
      row: selected,
      drive,
      mediaDir: config.mediaDir,
      largeFileBytes: config.largeMediaThresholdBytes,
      onLocalPath: async (localPath) => {
        await updateRow(sheets, config, headers, selected.__rowNumber, { 'Local Media Path': localPath });
        selected['Local Media Path'] = localPath;
      }
    });

    const account = accounts.find((item) => item.sheetAccount.trim().toLowerCase() === String(selected['Facebook Account']).trim().toLowerCase());
    if (!account) throw new Error(`No Facebook profile mapping for Sheet account: ${selected['Facebook Account']}`);

    prepared = await prepareFacebookPost({ config, account, row: selected, mediaPaths });
    await updateRow(sheets, config, headers, selected.__rowNumber, { 'Posting Status': 'Posting' });
    const result = await prepared.submit();
    const postedAt = sheetTimestamp(new Date(), config.timezone);
    await writeTerminalState({
      sheets, config, headers, row: selected, startMs,
      updates: {
        'Posting Status': result.status,
        'Attempt Count': attempts + 1,
        'Last Attempt At': '',
        'Posted At': postedAt,
        'Posted URL': result.postedUrl,
        'Error / Notes': ''
      }
    });
    log('published', { row: selected.__rowNumber, postId: selected['Post ID'], status: result.status, postedUrl: result.postedUrl });
  } catch (error) {
    log('run-failed', { message: error.message, stack: error.stack });
    if (selected && headers && sheets && startMs) {
      const attempts = Number(selected['Attempt Count'] || 0);
      const submissionStarted = Boolean(error.submissionStarted);
      const now = sheetTimestamp(new Date(), config.timezone);
      const updates = submissionStarted ? {
        'Posting Status': 'Submitted for review',
        'Attempt Count': attempts + 1,
        'Last Attempt At': '',
        'Posted At': now,
        'Posted URL': 'Submission started — outcome/URL requires manual review',
        'Error / Notes': `Manual review required after submission started: ${error.message}`
      } : {
        'Posting Status': 'Failed',
        'Attempt Count': attempts + 1,
        'Last Attempt At': now,
        'Error / Notes': error.message
      };
      await writeTerminalState({ sheets, config, headers, row: selected, startMs, updates }).catch((sheetError) => {
        log('sheet-failure-write-failed', { message: sheetError.message });
      });
    }
    process.exitCode = 1;
  } finally {
    if (prepared) await prepared.close().catch(() => {});
    if (live && sheets && headers && table && drive) {
      const rows = table.rows.filter((row) => row.__rowNumber !== selected?.__rowNumber);
      await prefetchMissingMedia({ sheets, config, headers, rows, drive }).catch((error) => {
        log('media-prefetch-run-failed', { message: error.message });
      });
    }
    await releaseLock();
  }
}

await main();

