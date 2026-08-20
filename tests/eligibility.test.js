import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibilityReason, scheduledMinutes, selectOldestEligible } from '../src/eligibility.js';

const now = new Date('2026-08-20T07:30:00.000Z'); // 14:30 Asia/Bangkok

function row(overrides = {}) {
  return {
    __rowNumber: 2,
    'Post ID': '100',
    'Scheduled Date': '20/08/2026',
    'Scheduled Time': '10.20',
    'Approval Status': 'Approved',
    'Posting Status': '',
    'Attempt Count': '',
    'Posted URL': '',
    'Error / Notes': '',
    ...overrides
  };
}

test('parses dot and colon scheduled times', () => {
  assert.equal(scheduledMinutes('9.05'), 545);
  assert.equal(scheduledMinutes('09:05'), 545);
  assert.equal(scheduledMinutes('24:00'), null);
});

test('selects only the oldest eligible scheduled row', () => {
  const rows = [
    row({ __rowNumber: 2, 'Post ID': '200', 'Scheduled Time': '12.00' }),
    row({ __rowNumber: 3, 'Post ID': '201', 'Scheduled Time': '09.30' }),
    row({ __rowNumber: 4, 'Post ID': '202', 'Scheduled Time': '10.00' })
  ];
  assert.equal(selectOldestEligible(rows, now, 'Asia/Bangkok')['Post ID'], '201');
});

test('does not select future, unapproved, posted, or exhausted rows', () => {
  const rows = [
    row({ __rowNumber: 2, 'Post ID': '300', 'Scheduled Time': '15.00' }),
    row({ __rowNumber: 3, 'Post ID': '301', 'Approval Status': 'Pending' }),
    row({ __rowNumber: 4, 'Post ID': '302', 'Posted URL': 'https://facebook.test/post' }),
    row({ __rowNumber: 5, 'Post ID': '303', 'Attempt Count': '2' })
  ];
  assert.equal(selectOldestEligible(rows, now, 'Asia/Bangkok'), null);
});

test('blocks unresolved security or group-rule failures', () => {
  const failed = row({ 'Posting Status': 'Failed', 'Attempt Count': '1', 'Error / Notes': 'Facebook security check requires manual review' });
  assert.match(eligibilityReason(failed, [failed], now, 'Asia/Bangkok'), /manual review/i);
});

test('allows one retry for a non-security failure', () => {
  const failed = row({ 'Posting Status': 'Failed', 'Attempt Count': '1', 'Error / Notes': 'network timeout before composer opened' });
  assert.equal(eligibilityReason(failed, [failed], now, 'Asia/Bangkok'), null);
});

test('blocks every duplicated Post ID', () => {
  const first = row({ __rowNumber: 2, 'Post ID': '500' });
  const second = row({ __rowNumber: 3, 'Post ID': '500' });
  assert.match(eligibilityReason(first, [first, second], now, 'Asia/Bangkok'), /duplicated/i);
  assert.equal(selectOldestEligible([first, second], now, 'Asia/Bangkok'), null);
});

test('skips rows for Facebook accounts this machine does not handle', () => {
  const mine = row({ __rowNumber: 2, 'Post ID': '600', 'Facebook Account': 'Thep Arthur' });
  const other = row({ __rowNumber: 3, 'Post ID': '601', 'Facebook Account': 'arunee tangkamolsuk', 'Scheduled Time': '09.00' });
  const knownAccounts = new Set(['thep arthur']);
  assert.equal(eligibilityReason(other, [mine, other], now, 'Asia/Bangkok', knownAccounts), 'Facebook Account is not handled by this machine');
  assert.equal(selectOldestEligible([mine, other], now, 'Asia/Bangkok', knownAccounts)['Post ID'], '600');
});

