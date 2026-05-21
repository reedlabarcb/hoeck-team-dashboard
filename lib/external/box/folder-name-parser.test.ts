import { describe, test, expect } from 'vitest';
import { parseDealFolderName, isMtClient, isLeaseFolderHint } from './folder-name-parser';

describe('parseDealFolderName', () => {
  test('simple acquisition with year only', () => {
    expect(parseDealFolderName('2026 – Lease Acquisition')).toEqual({
      yearStart: 2026,
      yearEnd: undefined,
      dealType: 'Acquisition',
      address: undefined,
    });
  });

  test('acquisition with address', () => {
    expect(parseDealFolderName('2026 – Lease Acquisition – 350 10th Ave')).toEqual({
      yearStart: 2026,
      yearEnd: undefined,
      dealType: 'Acquisition',
      address: '350 10th Ave',
    });
  });

  test('disposition with address', () => {
    expect(parseDealFolderName('2026 – Lease Disposition – 350 10th Ave')).toEqual({
      yearStart: 2026,
      yearEnd: undefined,
      dealType: 'Disposition',
      address: '350 10th Ave',
    });
  });

  test('year range with em-dash', () => {
    expect(parseDealFolderName('2018–2025 – Lease Acquisition – Lake Oswego')).toEqual({
      yearStart: 2018,
      yearEnd: 2025,
      dealType: 'Acquisition',
      address: 'Lake Oswego',
    });
  });

  test('year range with hyphen', () => {
    expect(parseDealFolderName('2024-2026 - Lease Acquisition - Some Address')).toEqual({
      yearStart: 2024,
      yearEnd: 2026,
      dealType: 'Acquisition',
      address: 'Some Address',
    });
  });

  test('trims surrounding whitespace', () => {
    expect(parseDealFolderName('  2026 – Lease Acquisition – 350 10th Ave  ')?.address).toBe(
      '350 10th Ave',
    );
  });

  test('returns null for non-matching folder names', () => {
    expect(parseDealFolderName('Survey(s)')).toBeNull();
    expect(parseDealFolderName('Lease Documents')).toBeNull();
    expect(parseDealFolderName('Luminia')).toBeNull();
    expect(parseDealFolderName('2026 – Lease Renewal')).toBeNull(); // not Acquisition/Disposition
    expect(parseDealFolderName('26 – Lease Acquisition')).toBeNull(); // 2-digit year
  });
});

describe('isMtClient', () => {
  test.each([
    ['Northwestern Mutual – MT', true],
    ['Some Client – MT', true],
    ['Foo - MT', true],
    ['Foo –MT', true], // tight against the dash
  ])('detects MT suffix: "%s"', (name, expected) => {
    expect(isMtClient(name)).toBe(expected);
  });

  test.each([
    ['Luminia', false],
    ['Care Solace', false],
    ['MT Bank', false], // MT at start, not suffix
    ['Northwestern Mutual', false],
    ['Smith MT-LLC', false], // MT not at end
  ])('does not treat as MT: "%s"', (name, expected) => {
    expect(isMtClient(name)).toBe(expected);
  });
});

describe('isLeaseFolderHint', () => {
  test('matches lease folders even with typos in convention', () => {
    expect(isLeaseFolderHint('2026 – Lease Acquisition')).toBe(true);
    expect(isLeaseFolderHint('Lease Acquisition 2026')).toBe(true); // order swapped
    expect(isLeaseFolderHint('lease  disposition')).toBe(true);
    expect(isLeaseFolderHint('Luminia')).toBe(false);
    expect(isLeaseFolderHint('Survey(s)')).toBe(false);
  });
});
