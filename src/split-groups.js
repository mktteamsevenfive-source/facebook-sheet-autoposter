import { loadConfig } from './config.js';
import { getGoogleClients } from './google.js';

const DEFAULT_SPREADSHEET_ID = '1MVpnOu2jnD0HHAA97qjPpCmbdAbJITT6bck2XdC4tFw';
const DEFAULT_SOURCE_SHEET = 'FB Group';
const UNCLASSIFIED_LABEL = 'Unclassified';
const CLEAR_ROWS = 10000;

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

async function ensureSheetExists(sheets, spreadsheetId, title, existingTitles) {
  if (existingTitles.has(title)) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });
  existingTitles.add(title);
}

async function writeGroup(sheets, spreadsheetId, title, headers, rows) {
  const lastColumn = columnLetter(headers.length - 1);
  const range = `'${title.replaceAll("'", "''")}'!A1:${lastColumn}${CLEAR_ROWS}`;
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title.replaceAll("'", "''")}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers, ...rows] }
  });
}

async function main() {
  const config = loadConfig();
  const spreadsheetId = process.argv[2] || DEFAULT_SPREADSHEET_ID;
  const sourceSheet = process.argv[3] || DEFAULT_SOURCE_SHEET;
  const { sheets } = await getGoogleClients(config);

  const source = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sourceSheet.replaceAll("'", "''")}'!A:Z`
  });
  const [headers = [], ...rows] = source.data.values || [];
  const typeIndex = headers.indexOf('type group');
  if (typeIndex < 0) throw new Error(`Column "type group" not found in "${sourceSheet}"`);

  const groups = new Map();
  for (const row of rows) {
    const type = String(row[typeIndex] || '').trim() || UNCLASSIFIED_LABEL;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(row);
  }

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
  const existingTitles = new Set(meta.data.sheets.map((s) => s.properties.title));

  console.log(`Read ${rows.length} rows from "${sourceSheet}".`);
  for (const [type, typeRows] of groups) {
    await ensureSheetExists(sheets, spreadsheetId, type, existingTitles);
    await writeGroup(sheets, spreadsheetId, type, headers, typeRows);
    console.log(`Wrote ${typeRows.length} rows to "${type}"`);
  }
  console.log('Done.');
}

await main();
