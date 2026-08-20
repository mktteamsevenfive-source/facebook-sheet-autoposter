import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig, readAccountConfig } from './config.js';
import { launchFacebookContext } from './facebook.js';

const config = loadConfig();
const accounts = readAccountConfig(config);
const accountArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
if (!accountArg) {
  console.error(`Usage: npm run login:facebook -- "<Facebook Account from Sheet>"\nAvailable: ${accounts.map((a) => a.sheetAccount).join(', ')}`);
  process.exit(1);
}
const account = accounts.find((item) => item.sheetAccount.trim().toLowerCase() === accountArg.trim().toLowerCase());
if (!account) throw new Error(`Account is not mapped in accounts.json: ${accountArg}`);

const context = await launchFacebookContext(config, account);
const page = context.pages()[0] || await context.newPage();
await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
console.log(`Chrome profile: ${account.profileDir}`);
console.log(`Log in as: ${account.expectedDisplayName}`);
const prompt = readline.createInterface({ input, output });
await prompt.question('After Facebook login is complete, press Enter here to save the session...');
prompt.close();
await context.close();
console.log('Facebook session saved.');

