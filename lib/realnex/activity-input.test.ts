import { describe, it, expect } from 'vitest';
import { validateActivityInput, deriveSubject, ALLOWED_EVENT_TYPE_KEYS } from './activity-input';

const good = { objectKey: 'C66BA083', objectType: 'company', eventTypeKey: 18, subject: 'Lunch', notes: 'had lunch with Maria' };

describe('ALLOWED_EVENT_TYPE_KEYS', () => {
  it('is exactly the 6 note-logging types', () => {
    expect([...ALLOWED_EVENT_TYPE_KEYS].sort((a, b) => a - b)).toEqual([1, 2, 11, 15, 18, 101]);
  });
});

describe('validateActivityInput', () => {
  it('accepts a well-formed body', () => {
    const r = validateActivityInput(good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ objectKey: 'C66BA083', objectType: 'company', eventTypeKey: 18, subject: 'Lunch', notes: 'had lunch with Maria' });
  });

  it('accepts all 6 allowed eventTypeKeys (number or numeric string)', () => {
    for (const k of [18, 1, 101, 15, 2, 11]) {
      expect(validateActivityInput({ ...good, eventTypeKey: k }).ok).toBe(true);
      expect(validateActivityInput({ ...good, eventTypeKey: String(k) }).ok).toBe(true);
    }
  });

  it('rejects a non-note eventTypeKey (Follow-Up 3, unknown 999, 0, boolean, garbage)', () => {
    for (const bad of [3, 4, 999, 0, -1, true, 'abc', null, undefined]) {
      const r = validateActivityInput({ ...good, eventTypeKey: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('eventTypeKey');
    }
  });

  it('requires objectKey', () => {
    for (const bad of ['', '   ', undefined, 42]) {
      const r = validateActivityInput({ ...good, objectKey: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('objectKey');
    }
  });

  it("requires objectType contact|company", () => {
    for (const bad of ['deal', '', undefined, 'Contact']) {
      const r = validateActivityInput({ ...good, objectType: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('objectType');
    }
  });

  it('requires non-empty notes', () => {
    for (const bad of ['', '   ', undefined, 5]) {
      const r = validateActivityInput({ ...good, notes: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.field).toBe('notes');
    }
  });

  it('derives subject from notes when subject is empty', () => {
    const r = validateActivityInput({ ...good, subject: '', notes: 'Called re: renewal\nsecond line' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.subject).toBe('Called re: renewal');
  });

  it('rejects a non-object body', () => {
    expect(validateActivityInput(null).ok).toBe(false);
    expect(validateActivityInput('nope').ok).toBe(false);
  });
});

describe('deriveSubject', () => {
  it('takes the first line', () => {
    expect(deriveSubject('first\nsecond')).toBe('first');
  });
  it('caps long first lines ~80 chars with an ellipsis', () => {
    const long = 'x'.repeat(120);
    const s = deriveSubject(long);
    expect(s.length).toBe(80);
    expect(s.endsWith('…')).toBe(true);
  });
  it('falls back to "Note" for whitespace-only', () => {
    expect(deriveSubject('   \n  ')).toBe('Note');
  });
});
