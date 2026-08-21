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
  const text = await pageText(page);
  const expected = cleanText(expectedDisplayName).trim();
  if (!expected || !text.toLocaleLowerCase().includes(expected.toLocaleLowerCase())) {
    throw new Error(`Facebook account mismatch: expected "${expected}" not found on profile page`);
  }
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
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /create (?:a )?(?:public )?post|สร้างโพสต์/i }).first();
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
  return dialog;
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

async function permalinkSet(page, groupId) {
  const links = await page.locator('a[href*="/posts/"]').evaluateAll((nodes) => nodes.map((node) => node.href)).catch(() => []);
  return new Set(links.map((link) => normalizePermalink(link, groupId)).filter(Boolean));
}

async function findNewPermalink(page, before, caption, groupId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 3000 : 5000);
    const after = await permalinkSet(page, groupId);
    const created = [...after].find((url) => !before.has(url));
    if (created) return created;
    const needle = cleanText(caption).trim().slice(0, 48);
    if (needle) {
      const article = page.locator('[role="article"]').filter({ hasText: needle }).first();
      if (await article.isVisible().catch(() => false)) {
        const href = await article.locator('a[href*="/posts/"]').first().getAttribute('href').catch(() => null);
        const normalized = normalizePermalink(href, groupId);
        if (normalized) return normalized;
      }
    }
  }
  return null;
}

export async function launchFacebookContext(config, account) {
  await fs.mkdir(account.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(account.profileDir, {
    channel: config.chromeChannel,
    headless: config.facebookHeadless,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-GB',
    timezoneId: config.timezone,
    args: ['--disable-notifications']
  });
  context.setDefaultTimeout(config.navigationTimeoutMs);
  context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  return context;
}

export async function prepareFacebookPost({ config, account, row, mediaPaths }) {
  const context = await launchFacebookContext(config, account);
  const page = context.pages()[0] || await context.newPage();
  let submissionStarted = false;
  try {
    await verifyFacebookAccount(page, account.expectedDisplayName);
    const groupId = groupIdFromUrl(row['Facebook Group URL']);
    await page.goto(String(row['Facebook Group URL']), { waitUntil: 'domcontentloaded' });
    await assertNoBlockingIssue(page);
    const before = await permalinkSet(page, groupId);
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
    // overlaps the Post button and blocks clicks on it. Blur (not click) to close it safely.
    await editor.evaluate((node) => node.blur());
    await page.waitForTimeout(500);

    const postButton = dialog.getByRole('button', { name: /^(post|โพสต์)$/i }).last();
    await postButton.waitFor({ state: 'visible', timeout: config.uploadTimeoutMs });

    return {
      async submit() {
        try {
          await assertNoBlockingIssue(page);
          await postButton.click({ timeout: config.uploadTimeoutMs });
          submissionStarted = true;
          await dialog.waitFor({ state: 'hidden', timeout: config.uploadTimeoutMs }).catch(() => {});
          const body = await pageText(page);
          const submittedForReview = /submitted for review|pending post|waiting for admin approval|ส่งให้ตรวจสอบแล้ว|รอการอนุมัติ|โพสต์ที่รอดำเนินการ/i.test(body);
          const actualUrl = await findNewPermalink(page, before, caption, groupId);
          return {
            status: submittedForReview ? 'Submitted for review' : 'Posted',
            postedUrl: actualUrl || (submittedForReview
              ? 'Submitted for review — Facebook did not provide a post URL'
              : 'Processing — Facebook did not provide a post URL yet')
          };
        } catch (error) {
          error.submissionStarted = submissionStarted;
          await addFailureScreenshot(config, page, row, error);
          throw error;
        }
      },
      async close() { await context.close(); }
    };
  } catch (error) {
    error.submissionStarted = submissionStarted;
    await addFailureScreenshot(config, page, row, error);
    await context.close().catch(() => {});
    throw error;
  }
}
