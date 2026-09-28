import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const SECURITY_OR_RESTRICTION = /security check|confirm your identity|unusual activity|temporarily blocked|account restricted|you(?:'|’)re restricted|you can(?:'|’)t post|unable to post|suspended|login request|manual review|ตรวจสอบความปลอดภัย|ยืนยันตัวตน|กิจกรรม(?:ที่)?ผิดปกติ|ถูกจำกัด|ไม่สามารถโพสต์|โพสต์ไม่ได้|คำเตือน/i;
const GROUP_RULE_PROBLEM = /answer (?:the )?(?:membership|group) questions|required questions|agree to (?:the )?group rules|pending member|posting permission|ตอบคำถาม(?:การเข้าร่วม|ของกลุ่ม)|ยอมรับกฎของกลุ่ม|ไม่มีสิทธิ์โพสต์/i;
const PERMALINK = /https:\/\/(?:www\.)?facebook\.com\/groups\/[^/?#]+\/posts\/\d+/i;

function cleanText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function pageText(page) {
  return cleanText(await page.locator('body').innerText({ timeout: 15000 }).catch(() => ''));
}

async function assertNoBlockingIssue(page) {
  const url = page.url();
  if (/\/login|\/checkpoint/i.test(url) || await page.locator('input[name="email"]').isVisible().catch(() => false)) {
    throw new Error('login request: Facebook session is not signed in or requires a checkpoint');
  }
  const text = await pageText(page);
  const security = text.match(SECURITY_OR_RESTRICTION)?.[0];
  if (security) throw new Error(`Facebook security/restriction warning: ${security}`);
  const groupRule = text.match(GROUP_RULE_PROBLEM)?.[0];
  if (groupRule) throw new Error(`Facebook group-rule problem: ${groupRule}`);
}

async function verifyFacebookAccount(page, expectedDisplayName) {
  await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded' });
  await assertNoBlockingIssue(page);
  const expected = cleanText(expectedDisplayName).trim();
  // The profile header can still be a loading skeleton right after navigation,
  // especially back-to-back with a prior post, so poll instead of checking once.
  const deadline = Date.now() + 15000;
  let text = '';
  while (Date.now() < deadline) {
    text = await pageText(page);
    if (expected && text.toLocaleLowerCase().includes(expected.toLocaleLowerCase())) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Facebook account mismatch: expected "${expected}" not found on profile page`);
}

async function openComposer(page) {
  const patterns = [/write something/i, /create (?:a )?(?:public )?post/i, /เขียนอะไร/i, /สร้างโพสต์/i];
  let opener = null;
  for (const pattern of patterns) {
    const candidate = page.locator('[role="button"]').filter({ hasText: pattern }).first();
    const found = await candidate.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (found) { opener = candidate; break; }
  }
  if (!opener) throw new Error('Facebook group-rule problem: posting composer is unavailable; verify membership and posting permission');
  const namedDialog = page.getByRole('dialog', { name: /create (?:a )?(?:public )?post|สร้างโพสต์/i }).first();
  const editorDialog = page.locator('[role="dialog"]').filter({ has: page.locator('[contenteditable="true"]') }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await opener.scrollIntoViewIfNeeded().catch(() => {});
    await opener.click({ force: attempt > 0 });
    const dialog = await Promise.any([
      namedDialog.waitFor({ state: 'visible', timeout: 10000 }).then(() => namedDialog),
      editorDialog.waitFor({ state: 'visible', timeout: 10000 }).then(() => editorDialog)
    ]).catch(() => null);
    if (dialog) return dialog;
    await page.waitForTimeout(1000);
  }
  throw new Error('Facebook post composer did not open after 3 attempts');
}

async function attachMedia(page, dialog, mediaPaths, timeoutMs) {
  if (!mediaPaths.length) return;
  const existingInput = dialog.locator('input[type="file"]').first();
  if (await existingInput.count()) {
    await existingInput.setInputFiles(mediaPaths, { timeout: timeoutMs });
    return;
  }
  const button = dialog.getByRole('button', { name: /photo\/video|รูปภาพ\/วิดีโอ|รูป\/วิดีโอ/i }).first();
  await button.waitFor({ state: 'visible', timeout: 30000 }).catch(() => { throw new Error('Facebook media control was not found'); });
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });
  await button.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(mediaPaths, { timeout: timeoutMs });
}

async function addFailureScreenshot(config, page, row, error) {
  try {
    const directory = path.join(config.dataDir, 'screenshots');
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `post-${String(row['Post ID'] || row.__rowNumber).replace(/[^A-Za-z0-9_-]/g, '_')}-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    error.message = `${error.message}; screenshot: ${filePath}`;
  } catch {
    // Keep the original Facebook error if screenshot capture also fails.
  }
}

function groupIdFromUrl(url) {
  return String(url || '').match(/\/groups\/([^/?#]+)/)?.[1] || null;
}

function normalizePermalink(value, groupId) {
  const match = String(value || '').match(PERMALINK);
  if (!match) return null;
  const normalized = match[0].replace('://facebook.com', '://www.facebook.com') + '/';
  if (groupId && !normalized.includes(`/groups/${groupId}/posts/`)) return null;
  return normalized;
}

// Looks up a post's permalink by matching the start of its caption against articles
// currently visible on the group page. Used by resolvePostedUrl in a later, separate
// pass so permalink lookup never blocks the posting loop for the next row.
async function findPermalinkByCaption(page, caption, groupId, { attempts = 4, waitMs = 4000 } = {}) {
  const needle = cleanText(caption).trim().slice(0, 48);
  if (!needle) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await page.waitForTimeout(waitMs);
    const article = page.locator('[role="article"]').filter({ hasText: needle }).first();
    if (await article.isVisible().catch(() => false)) {
      const href = await article.locator('a[href*="/posts/"]').first().getAttribute('href').catch(() => null);
      const normalized = normalizePermalink(href, groupId);
      if (normalized) return normalized;
    }
  }
  return null;
}

export async function launchFacebookContext(config, account, { onScreen = false } = {}) {
  await fs.mkdir(account.profileDir, { recursive: true });
  const args = ['--disable-notifications'];
  if (!onScreen) args.push('--window-position=-32000,-32000');
  const context = await chromium.launchPersistentContext(account.profileDir, {
    channel: config.chromeChannel,
    headless: config.facebookHeadless,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-GB',
    timezoneId: config.timezone,
    args
  });
  context.setDefaultTimeout(config.navigationTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  return context;
}

export async function checkAccountLogin(config, account) {
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    await context.close().catch(() => {});
  }
}

async function prepareFacebookPostOnPage({ config, page, row, mediaPaths, close }) {
  let submissionStarted = false;
  try {
    await page.goto(String(row['Facebook Group URL']), { waitUntil: 'domcontentloaded' });
    await assertNoBlockingIssue(page);
    const dialog = await openComposer(page);
    await assertNoBlockingIssue(page);
    await attachMedia(page, dialog, mediaPaths, config.uploadTimeoutMs);
    const editor = dialog.locator('[contenteditable="true"][role="textbox"], [contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 30000 });
    const caption = cleanText(row.Caption);
    await editor.fill(caption);
    const actualCaption = cleanText(await editor.innerText());
    if (actualCaption !== caption) throw new Error('Caption verification failed: Facebook composer text differs from the Sheet');
    // Typing a hashtag/mention can leave Facebook's suggestion popover open, which visually
    // overlaps the Post button and blocks clicks on it. Facebook only closes it on a real
    // click outside the editor (blur alone isn't enough), so click empty dialog padding.
    await dialog.click({ position: { x: 16, y: 16 } }).catch(() => {});
    await page.waitForTimeout(500);

    const postButton = dialog.getByRole('button', { name: /^(post|โพสต์)$/i }).last();
    await postButton.waitFor({ state: 'visible', timeout: config.uploadTimeoutMs });

    return {
      async submit() {
        try {
          await assertNoBlockingIssue(page);
          // A transient overlay (hashtag suggestions, a hover tooltip, etc.) can sit on top of
          // the Post button and block a mouse click. Focus + Enter activates it without any
          // pointer interaction, so it can't be blocked by whatever happens to be on top.
          await postButton.focus({ timeout: config.uploadTimeoutMs });
          await postButton.press('Enter', { timeout: config.uploadTimeoutMs });
          submissionStarted = true;
          await dialog.waitFor({ state: 'hidden', timeout: config.uploadTimeoutMs }).catch(() => {});
          const body = await pageText(page);
          const submittedForReview = /submitted for review|pending post|waiting for admin approval|ส่งให้ตรวจสอบแล้ว|รอการอนุมัติ|โพสต์ที่รอดำเนินการ/i.test(body);
          // Permalink lookup happens later, in a separate pass (see resolvePostedUrl below),
          // so it never delays moving on to the next row while posting a batch.
          return { status: submittedForReview ? 'Submitted for review' : 'Posted' };
        } catch (error) {
          error.submissionStarted = submissionStarted;
          await addFailureScreenshot(config, page, row, error);
          throw error;
        }
      },
      close
    };
  } catch (error) {
    error.submissionStarted = submissionStarted;
    await addFailureScreenshot(config, page, row, error);
    throw error;
  }
}

export async function createFacebookSession({ config, account }) {
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }

  return {
    async preparePost({ row, mediaPaths }) {
      return prepareFacebookPostOnPage({ config, page, row, mediaPaths, close: async () => {} });
    },
    async resolvePostedUrl({ row }) {
      return resolvePostedUrlOnPage({ page, row });
    },
    async close() {
      await context.close();
    }
  };
}

export async function prepareFacebookPost({ config, account, row, mediaPaths, session }) {
  if (session) return session.preparePost({ row, mediaPaths });
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    return await prepareFacebookPostOnPage({
      config,
      page,
      row,
      mediaPaths,
      close: async () => { await context.close(); }
    });
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

// Revisits a group page after posting is done to look up the permalink of a post that
// was already submitted. Meant to run in a batch, after every row has been posted, so a
// slow or failed lookup for one row never holds up posting the next one.
async function resolvePostedUrlOnPage({ page, row }) {
  try {
    const groupId = groupIdFromUrl(row['Facebook Group URL']);
    await page.goto(String(row['Facebook Group URL']), { waitUntil: 'domcontentloaded' });
    await assertNoBlockingIssue(page);
    const url = await findPermalinkByCaption(page, row.Caption, groupId);
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function resolvePostedUrl({ config, account, row, session }) {
  if (session) return session.resolvePostedUrl({ row });
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    return await resolvePostedUrlOnPage({ page, row });
  } catch (error) {
    return { ok: false, error };
  } finally {
    await context.close().catch(() => {});
  }
}
