import { describe, it, expect } from 'vitest';
import { classifyCreateResponse, retryMayDuplicate } from './create-response';

describe('classifyCreateResponse', () => {
  it('200 → success (with or without warnings)', () => {
    expect(classifyCreateResponse(200, { key: 'K1', warnings: [] })).toEqual({ kind: 'success', key: 'K1', warnings: [] });
    const w = classifyCreateResponse(200, { key: 'K1', warnings: ['address will sync shortly'] });
    expect(w).toMatchObject({ kind: 'success', key: 'K1', warnings: ['address will sync shortly'] });
  });
  it('400 → validation with field', () => {
    expect(classifyCreateResponse(400, { error: 'invalid_input', field: 'organization', message: 'organization is required' })).toMatchObject({ kind: 'validation', field: 'organization' });
  });
  it('401 → auth (safe to retry after re-auth)', () => {
    expect(classifyCreateResponse(401, {}).kind).toBe('auth');
  });
  it('404 → unavailable (feature dark)', () => {
    expect(classifyCreateResponse(404, {}).kind).toBe('unavailable');
  });
  it('503 → not_configured', () => {
    expect(classifyCreateResponse(503, {}).kind).toBe('not_configured');
  });
  it('502 → AMBIGUOUS (verify before retry) surfacing problem detail', () => {
    const o = classifyCreateResponse(502, { error: 'realnex_write_failed', status: 500, problem: { detail: 'upstream boom' } });
    if (o.kind !== 'ambiguous') throw new Error(`expected ambiguous, got ${o.kind}`);
    expect(o.message).toMatch(/upstream boom/);
    expect(o.message).toMatch(/MAY have been created/);
    expect(retryMayDuplicate(o)).toBe(true);
  });
  it('other 4xx (RealNex passthrough) → realnex_error (create did NOT happen; retry safe)', () => {
    const o = classifyCreateResponse(409, { error: 'realnex_write_failed', status: 409, problem: { title: 'Conflict' } });
    if (o.kind !== 'realnex_error') throw new Error(`expected realnex_error, got ${o.kind}`);
    expect(o.message).toMatch(/Conflict/);
    expect(retryMayDuplicate(o)).toBe(false);
  });
  it('retryMayDuplicate is true ONLY for ambiguous', () => {
    expect(retryMayDuplicate({ kind: 'success', key: 'k', warnings: [] })).toBe(false);
    expect(retryMayDuplicate({ kind: 'realnex_error', message: 'x' })).toBe(false);
    expect(retryMayDuplicate({ kind: 'ambiguous', message: 'x' })).toBe(true);
  });
});
