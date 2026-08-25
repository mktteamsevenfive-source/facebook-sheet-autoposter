import { chromium } from 'playwright';
import { loadConfig } from './config.js';
import { getGoogleClients } from './google.js';

const DEFAULT_SPREADSHEET_ID = '1MVpnOu2jnD0HHAA97qjPpCmbdAbJITT6bck2XdC4tFw';
const DEFAULT_SOURCE_SHEET = 'FB Group';

const BUY_SELL_TAB = /ซื้อและขาย|buy\s*and\s*sell/i;
const PRIVATE_LABEL = /กลุ่มส่วนตัว|private\s*group/i;
const PUBLIC_LABEL = /กลุ่มสาธารณะ|public\s*group/i;

function columnLetter(index) {
  let number = index + 1;
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function isFacebookGroupUrl(url) {
  return /^https?:\/\/(www\.|m\.)?facebook\.com\//i.test(String(url || '').trim());
}

async function detectGroupType(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const text = await page.locator('body').innerText({ timeout: 15000 }).catch(() => '');
  if (BUY_SELL_TAB.test(text)) return 'Sell Group';
  if (PRIVATE_LABEL.test(text)) return 'Private';
  if (PUBLIC_LABEL.test(text)) return 'Public';
  return null;
}

async function main() {
  const config = loadConfig();
  const spreadsheetId = process.argv[2] || DEFAULT_SPREADSHEET_ID;
  const sourceSheet = process.argv[3] || DEFAULT_SOURCE_SHEET;
  const limit = Number(process.argv[4] || Infinity);

  const { sheets } = await getGoogleClients(config);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sourceSheet.replaceAll("'", "''")}'!A:Z`
  });
  const [headers = [], ...rows] = response.data.values || [];
  const typeIndex = headers.indexOf('type group');
  const urlIndex = headers.indexOf('FB URL');
  if (typeIndex < 0) throw new Error('Column "type group" not found');
  if (urlIndex < 0) throw new Error('Column "FB URL" not found');
  const typeColumn = columnLetter(typeIndex);

  const targets = rows
    .map((row, index) => ({ rowNumber: index + 2, url: row[urlIndex], type: row[typeIndex] }))
    .filter((item) => !String(item.type || '').trim() && isFacebookGroupUrl(item.url))
    .slice(0, limit);

  console.log(`Found ${targets.length} row(s) to classify (limit=${Number.isFinite(limit) ? limit : 'none'}).`);

  const browser = await chromium.launch({ channel: config.chromeChannel, headless: config.facebookHeadless });
  const page = await browser.newPage();
  let classified = 0;
  let skipped = 0;

  for (const target of targets) {
    try {
      const type = await detectGroupType(page, target.url);
      if (type) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sourceSheet.replaceAll("'", "''")}'!${typeColumn}${target.rowNumber}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[type]] }
        });
        console.log(`Row ${target.rowNumber}: ${type}`);
        classified += 1;
      } else {
        console.log(`Row ${target.rowNumber}: could not determine type, left blank`);
        skipped += 1;
      }
    } catch (error) {
      console.log(`Row ${target.rowNumber}: ERROR ${error.message}`);
      skipped += 1;
    }
    await page.waitForTimeout(6000);
  }

  await browser.close();
  console.log(`Done. Classified ${classified}, skipped ${skipped}, out of ${targets.length}.`);
}

await main();
