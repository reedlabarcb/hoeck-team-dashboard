import { describe, it, expect } from 'vitest';
import {
  daysToAct,
  formatDaysToAct,
  daysUrgency,
  matchesDaysBucket,
  DAYS_BUCKETS,
  type DaysBucket,
} from './days-to-act';

// `now` is INJECTED in every case — no hardcoded "today", so these can't rot as the clock moves.
// (A fixture like "2026-08-28" is future today and past in two months; that trap is avoided here by
// deriving every expectation from an explicit now.)
const NOW = new Date(2026, 6, 28, 15, 30); // 2026-07-28 15:30 local — afternoon, to prove time-of-day
                                           // doesn't leak into a whole-day count.

describe('daysToAct', () => {
  it('counts whole calendar days to a future window close', () => {
    expect(daysToAct('2026-08-28T00:00:00', NOW)).toBe(31);
    expect(daysToAct('2026-07-29T00:00:00', NOW)).toBe(1);
  });

  it('returns 0 on the day the window closes (regardless of time of day on either side)', () => {
    expect(daysToAct('2026-07-28T00:00:00', NOW)).toBe(0);
    expect(daysToAct('2026-07-28T23:59:59', NOW)).toBe(0);
    expect(daysToAct('2026-07-28', new Date(2026, 6, 28, 0, 1))).toBe(0);
  });

  it('returns NEGATIVE days for an already-closed window (never clamped to 0)', () => {
    expect(daysToAct('2026-07-18T00:00:00', NOW)).toBe(-10);
    expect(daysToAct('2025-07-28T00:00:00', NOW)).toBe(-365);
  });

  it('null for absent/blank/unparseable dates', () => {
    expect(daysToAct(null, NOW)).toBeNull();
    expect(daysToAct(undefined, NOW)).toBeNull();
    expect(daysToAct('', NOW)).toBeNull();
    expect(daysToAct('not a date', NOW)).toBeNull();
  });

  it('takes the ISO date part verbatim — no timezone off-by-one', () => {
    // A bare "YYYY-MM-DD" parsed via `new Date()` is UTC midnight, which is the PREVIOUS day west of
    // Greenwich. Both spellings must agree, and both must be 0 on the day itself.
    expect(daysToAct('2026-07-28', NOW)).toBe(daysToAct('2026-07-28T00:00:00', NOW));
    expect(daysToAct('2026-07-28', NOW)).toBe(0);
  });

  it('crosses a DST boundary without drifting a day (US spring-forward)', () => {
    // 2026-03-08 is US spring-forward. Counting from Mar 1 to Mar 15 spans it.
    expect(daysToAct('2026-03-15T00:00:00', new Date(2026, 2, 1, 12, 0))).toBe(14);
  });

  it('defaults `now` to the real clock (today → 0)', () => {
    const t = new Date();
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T00:00:00`;
    expect(daysToAct(iso)).toBe(0);
  });
});

describe('formatDaysToAct', () => {
  it('future → "N days" (singular at 1)', () => {
    expect(formatDaysToAct(87)).toBe('87 days');
    expect(formatDaysToAct(1)).toBe('1 day');
  });
  it('0 → "due today"', () => {
    expect(formatDaysToAct(0)).toBe('due today');
  });
  it('past → visible + explicit "window closed (N days ago)", never blank or 0', () => {
    expect(formatDaysToAct(-10)).toBe('window closed (10 days ago)');
    expect(formatDaysToAct(-1)).toBe('window closed (1 day ago)');
  });
  it('null → "—" (absent reads as "none", not broken)', () => {
    expect(formatDaysToAct(null)).toBe('—');
  });
});

describe('daysUrgency', () => {
  it('bands by urgency, closed being loudest', () => {
    expect(daysUrgency(null)).toBe('none');
    expect(daysUrgency(-1)).toBe('closed');
    expect(daysUrgency(0)).toBe('urgent');
    expect(daysUrgency(30)).toBe('urgent');
    expect(daysUrgency(31)).toBe('soon');
    expect(daysUrgency(90)).toBe('soon');
    expect(daysUrgency(91)).toBe('ok');
  });
});

describe('matchesDaysBucket', () => {
  it('"Any" keeps everything, including rows with no renewal-window date', () => {
    for (const d of [null, -5, 0, 45, 500]) expect(matchesDaysBucket(d, '')).toBe(true);
  });

  it('"Past due" keeps ONLY already-closed windows', () => {
    expect(matchesDaysBucket(-1, 'past')).toBe(true);
    expect(matchesDaysBucket(-90, 'past')).toBe(true);
    expect(matchesDaysBucket(0, 'past')).toBe(false); // due today is not yet past
    expect(matchesDaysBucket(15, 'past')).toBe(false);
  });

  it('"Under N days" INCLUDES past-due and due-today (a closed window is the most urgent)', () => {
    for (const bucket of ['30', '60', '90'] as DaysBucket[]) {
      expect(matchesDaysBucket(-10, bucket)).toBe(true); // past due — must NOT be filtered out
      expect(matchesDaysBucket(0, bucket)).toBe(true); // due today
    }
  });

  it('"Under N days" respects the N boundary (exclusive)', () => {
    expect(matchesDaysBucket(29, '30')).toBe(true);
    expect(matchesDaysBucket(30, '30')).toBe(false);
    expect(matchesDaysBucket(45, '30')).toBe(false);
    expect(matchesDaysBucket(45, '60')).toBe(true);
    expect(matchesDaysBucket(75, '60')).toBe(false);
    expect(matchesDaysBucket(75, '90')).toBe(true);
    expect(matchesDaysBucket(120, '90')).toBe(false);
  });

  it('rows with no renewal-window date fall out of EVERY bucket except "Any"', () => {
    for (const bucket of ['past', '30', '60', '90'] as DaysBucket[]) {
      expect(matchesDaysBucket(null, bucket)).toBe(false);
    }
  });
});

describe('DAYS_BUCKETS', () => {
  it('offers Any (default, first) + Past due + the three under-N buckets', () => {
    expect(DAYS_BUCKETS.map((b) => b.value)).toEqual(['', 'past', '30', '60', '90']);
    expect(DAYS_BUCKETS[0].value).toBe(''); // default = Any
  });
});
