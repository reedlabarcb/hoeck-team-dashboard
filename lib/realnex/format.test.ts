import { describe, it, expect } from 'vitest';
import { relativeTime, syncStatusLabel, formatSqFt, formatLeaseExpiry, formatAddress, normalizeWebsiteUrl, detailPath } from './format';

describe('normalizeWebsiteUrl', () => {
  it('prepends https:// when the scheme is missing', () => {
    expect(normalizeWebsiteUrl('gensler.com')).toBe('https://gensler.com');
    expect(normalizeWebsiteUrl('http://x.com')).toBe('http://x.com');
    expect(normalizeWebsiteUrl('https://x.com')).toBe('https://x.com');
  });
  it('null for blank/absent', () => {
    expect(normalizeWebsiteUrl(null)).toBeNull();
    expect(normalizeWebsiteUrl(undefined)).toBeNull();
    expect(normalizeWebsiteUrl('   ')).toBeNull();
  });
});

describe('formatAddress', () => {
  it('joins the REAL RealNex PascalCase shape (Address1/City/State/ZipCode) — the actual mirror jsonb', () => {
    // This is exactly what RealNex/OData returns and the sync stores verbatim in realnex_companies.address.
    // Reading camelCase keys missed all of these → "" → the /companies "all dashes" bug. Case-insensitive
    // lookup must handle it; extra fields (Country/Latitude) are ignored.
    expect(
      formatAddress({ Address1: '225 Broadway', Address2: 'Ste 100', City: 'San Diego', State: 'CA', Country: 'US', ZipCode: '92101', Latitude: 32.71 }),
    ).toBe('225 Broadway, Ste 100, San Diego, CA 92101');
  });
  it('also handles camelCase input (source-agnostic)', () => {
    expect(formatAddress({ address1: '525 B Street', address2: 'Ste 2200', city: 'San Diego', state: 'CA', zipCode: '92101' })).toBe('525 B Street, Ste 2200, San Diego, CA 92101');
    expect(formatAddress({ address1: '1 Main', city: 'SD', state: 'CA' })).toBe('1 Main, SD, CA');
  });
  it('partial PascalCase address — shows what it has, no stray comma', () => {
    expect(formatAddress({ City: 'San Diego' })).toBe('San Diego');
    expect(formatAddress({ Address1: '525 B Street' })).toBe('525 B Street');
  });
  it('empty string for null / non-object / empty', () => {
    expect(formatAddress(null)).toBe('');
    expect(formatAddress(undefined)).toBe('');
    expect(formatAddress({})).toBe('');
    expect(formatAddress('nope')).toBe('');
  });
});

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

describe('detailPath', () => {
  it('routes company → /companies/[key] and contact → /contacts/[key]', () => {
    expect(detailPath({ type: 'company', key: 'CO1' })).toBe('/companies/CO1');
    expect(detailPath({ type: 'contact', key: 'CT1' })).toBe('/contacts/CT1');
  });
  it('never routes to a list (no ?q=) and encodes the key', () => {
    const p = detailPath({ type: 'company', key: 'A/B C' });
    expect(p).toBe('/companies/A%2FB%20C');
    expect(p).not.toContain('?q=');
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
