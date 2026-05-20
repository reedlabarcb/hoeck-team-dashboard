/**
 * bcrypt wrapper.
 * Cost factor 12 — ~250 ms per hash. Slow enough to deter brute force, fast enough that login feels instant.
 */

import bcrypt from 'bcrypt';

const COST = 12;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
