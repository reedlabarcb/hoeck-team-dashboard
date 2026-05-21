import { describe, test, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptToken, decryptToken } from './crypto';

describe('box token crypto (AES-256-GCM)', () => {
  beforeAll(() => {
    // Set a deterministic test key (32 bytes, base64) so these tests work standalone.
    if (!process.env.BOX_TOKEN_ENCRYPTION_KEY) {
      process.env.BOX_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    }
  });

  test('round-trips a short string', () => {
    const ct = encryptToken('hello');
    expect(decryptToken(ct)).toBe('hello');
  });

  test('round-trips a typical Box JWT access token (~700 chars)', () => {
    const plaintext = 'eyJ' + 'a'.repeat(700);
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  test('produces a different ciphertext each call (fresh IV)', () => {
    const a = encryptToken('same plaintext');
    const b = encryptToken('same plaintext');
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('same plaintext');
    expect(decryptToken(b)).toBe('same plaintext');
  });

  test('tampered ciphertext fails to decrypt (authenticated encryption)', () => {
    const ct = encryptToken('important token');
    // flip a byte in the middle
    const buf = Buffer.from(ct, 'base64');
    buf[20] = buf[20] ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptToken(tampered)).toThrow();
  });

  test('rejects payloads too short to be valid', () => {
    expect(() => decryptToken('AAAA')).toThrow(/too short/);
  });
});
