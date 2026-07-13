import { describe, it, expect } from 'vitest';
import { relativeTime, syncStatusLabel, formatSqFt, formatLeaseExpiry } from './format';

describe('formatSqFt', () => {
  it('adds thousands separators', () => {
    expect(formatSqFt(21347)).toBe('21,347');
    expect(formatSqFt(500)).toBe('500');
    expect(formatSqFt(1234567)).toBe('1,234,567');
  });
  it('blank for null/zero/negative', () => {
    expect(formatSqFt(null)).toBe('—');
    expect(formatSqFt(undefined)).toBe('—');
    expect(formatSqFt(0)).toBe('—');
    expect(formatSqFt(-5)).toBe('—');
  });
});

describe('formatLeaseExpiry', () => {
  it('YYYY-MM-DD -> MM/DD/YYYY (no timezone drift)', () => {
    expect(formatLeaseExpiry('2027-04-30')).toBe('04/30/2027');
    expect(formatLeaseExpiry('2024-02-29')).toBe('02/29/2024');
    expect(formatLeaseExpiry('2027-04-30T00:00:00')).toBe('04/30/2027');
  });
  it('blank for null/invalid', () => {
    expect(formatLeaseExpiry(null)).toBe('—');
    expect(formatLeaseExpiry(undefined)).toBe('—');
    expect(formatLeaseExpiry('')).toBe('—');
    expect(formatLeaseExpiry('nope')).toBe('—');
  });
});

describe('relativeTime', () => {
  it('handles missing/invalid', () => {
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime(undefined)).toBe('never');
    expect(relativeTime('not-a-date')).toBe('never');
  });
  it('formats recent + old windows (from now)', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(relativeTime(ago(10_000))).toMatch(/^\d+s ago$/);
    expect(relativeTime(ago(5 * 60_000))).toBe('5 min ago');
    expect(relativeTime(ago(3 * 3_600_000))).toBe('3 hr ago');
    expect(relativeTime(ago(2 * 86_400_000))).toBe('2 days ago');
    expect(relativeTime(ago(86_400_000))).toBe('1 day ago');
  });
});

describe('syncStatusLabel', () => {
  it('null -> Never synced', () => {
    expect(syncStatusLabel(null)).toBe('Never synced');
  });
  it('running/queued -> Syncing', () => {
    expect(syncStatusLabel({ status: 'running', completedAt: null, triggeredBy: 'cron' })).toBe('Syncing…');
    expect(syncStatusLabel({ status: 'queued', completedAt: null, triggeredBy: 'reed' })).toBe('Syncing…');
  });
  it('failed -> failed label', () => {
    expect(syncStatusLabel({ status: 'failed', completedAt: new Date().toISOString(), triggeredBy: 'cron' })).toMatch(/^Last sync failed/);
  });
  it('completed -> Synced + actor (cron shown as auto)', () => {
    const cron = syncStatusLabel({ status: 'completed', completedAt: new Date().toISOString(), triggeredBy: 'cron' });
    expect(cron).toMatch(/^Synced /);
    expect(cron).toContain('auto');
    const person = syncStatusLabel({ status: 'completed', completedAt: new Date().toISOString(), triggeredBy: 'reed.labar@cbre.com' });
    expect(person).toContain('reed.labar@cbre.com');
  });
});
