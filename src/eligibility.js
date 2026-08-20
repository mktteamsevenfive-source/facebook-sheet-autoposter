import { zonedParts } from './time.js';

export const BLOCKING_ERROR = /security\s*check|restriction|restricted|warning|unusual\s*activity|login\s*request|manual\s*review|group[-\s]*rule|checkpoint|ยืนยันตัวตน|กิจกรรม(?:ที่)?ผิดปกติ|ถูกจำกัด|คำเตือน|ตรวจสอบความปลอดภัย|กฎของกลุ่ม|รอการตรวจสอบ/i;

function dateParts(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return null;
  return { day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) };
}

export function scheduledMinutes(value) {
  const text = String(value ?? '').trim().replace('.', ':');
  const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function nonBlank(value) {
  return String(value ?? '').trim() !== '';
}

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function buildPostIdIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const id = String(row['Post ID'] ?? '').trim();
    if (!id) continue;
    const list = index.get(id) || [];
    list.push(row);
    index.set(id, list);
  }
  return index;
}

export function eligibilityReason(row, rows, now = new Date(), timezone = 'Asia/Bangkok', knownAccounts = null) {
  const id = String(row['Post ID'] ?? '').trim();
  if (!id) return 'Post ID is blank';
  const idRows = buildPostIdIndex(rows).get(id) || [];
  if (idRows.length !== 1) return `Post ID ${id} is duplicated`;
  if (knownAccounts && !knownAccounts.has(normalized(row['Facebook Account']))) {
    return 'Facebook Account is not handled by this machine';
  }

  const today = zonedParts(now, timezone);
  const scheduledDate = dateParts(row['Scheduled Date']);
  if (!scheduledDate || scheduledDate.year !== today.year || scheduledDate.month !== today.month || scheduledDate.day !== today.day) {
    return 'Scheduled Date is not today';
  }
  const minutes = scheduledMinutes(row['Scheduled Time']);
  if (minutes === null) return 'Scheduled Time is invalid';
  if (minutes > today.hour * 60 + today.minute) return 'Scheduled Time is not due';
  if (normalized(row['Approval Status']) !== 'approved') return 'Approval Status is not Approved';
  if (nonBlank(row['Posted URL'])) return 'Posted URL is not blank';
  const attempts = Number(row['Attempt Count'] || 0);
  if (!Number.isFinite(attempts) || attempts >= 2) return 'Attempt Count is 2 or more';
  const status = normalized(row['Posting Status']);
  if (['posting', 'posted', 'submitted for review'].includes(status)) return `Posting Status is ${row['Posting Status']}`;
  if (status === 'failed' && BLOCKING_ERROR.test(String(row['Error / Notes'] || ''))) {
    return 'Failed row still requires manual review';
  }
  return null;
}

export function selectOldestEligible(rows, now = new Date(), timezone = 'Asia/Bangkok', knownAccounts = null) {
  return rows
    .filter((row) => eligibilityReason(row, rows, now, timezone, knownAccounts) === null)
    .sort((a, b) => scheduledMinutes(a['Scheduled Time']) - scheduledMinutes(b['Scheduled Time']) || a.__rowNumber - b.__rowNumber)[0] || null;
}

