/**
 * AES-256-GCM helpers for encrypting Box OAuth tokens at rest.
 *
 * Why GCM:
 *   - Authenticated encryption — tampering with the ciphertext fails on decrypt
 *   - Nonce-misuse resistance is fine since we generate a fresh random IV per encrypt
 *   - Node's native crypto supports it; no extra deps
 *
 * Why a dedicated env var (BOX_TOKEN_ENCRYPTION_KEY) instead of deriving from SESSION_PASSWORD:
 *   - Lets us rotate session encryption (logs users out of dashboard) independently from
 *     Box token encryption (which would un-encrypt every Box link and force re-OAuth).
 *
 * Format on disk: base64( IV[12] || ciphertext || authTag[16] )
 *   - 12 bytes IV → 16 chars base64 (after padding)
 *   - Ciphertext length matches plaintext (GCM is a stream cipher)
 *   - 16 bytes tag → 22 chars base64
 *   - For typical Box access_token (~700 bytes), encrypted blob is ~960 base64 chars
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.BOX_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('BOX_TOKEN_ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `BOX_TOKEN_ENCRYPTION_KEY must decode to 32 bytes; got ${key.length}. ` +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

export function decryptToken(payload: string): string {
  const key = getKey();
  const blob = Buffer.from(payload, 'base64');
  if (blob.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('encrypted payload too short to be valid');
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString('utf8');
}
