/**
 * HTTP-SHAPE validation for POST /api/realnex/company + /contact (P3.7/P3.8). Pure — no DB, no
 * network — so it's unit-tested without the route.
 *
 * This layer only checks the request is a well-TYPED CreateCompanyInput / CreateContactInput (right
 * types on present fields; unknown fields dropped) and returns the clean typed subset. It does NOT
 * enforce business rules (non-empty organization, name-required, useCompanyAddress+companyKey) — those
 * stay in the safe wrapper, which throws RealNexValidationError; the route maps that to 400. One
 * source of truth for the business guards.
 *
 * NOTE (casing): these are the camelCase WRITE input shapes — organization, address1, webSite — the
 * INVERSE of the PascalCase read side. See lib/external/realnex/types.ts "CASING INVERSION".
 */
import type { CreateAddressInput, CreateCompanyInput, CreateContactInput } from '@/lib/external/realnex/types';

export type CreateValidation<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

const FLAG_KEYS = ['investor', 'tenant', 'agent', 'vendor', 'prospect', 'personal'] as const;
type CreateFlag = (typeof FLAG_KEYS)[number];
const STRING_KEYS_COMPANY = ['organization', 'subsidiary', 'phone', 'fax', 'email', 'webSite'] as const;
const STRING_KEYS_CONTACT = ['fullName', 'firstName', 'lastName', 'title', 'salutation', 'greeting', 'companyKey', 'work', 'mobile', 'home', 'fax', 'email', 'webSite'] as const;
const ADDRESS_KEYS = ['address1', 'address2', 'city', 'state', 'zipCode', 'country'] as const;

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

type Pick<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

/** Optional address object: every PRESENT sub-field must be a string. */
function pickAddress(raw: unknown): Pick<CreateAddressInput | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  const o = asObject(raw);
  if (!o) return { ok: false, field: 'address', error: 'address must be an object' };
  const out: Record<string, string> = {};
  for (const k of ADDRESS_KEYS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { ok: false, field: `address.${k}`, error: `address.${k} must be a string` };
    out[k] = v;
  }
  return { ok: true, value: out as CreateAddressInput };
}

/** Pull the listed string keys, type-checking each present one. */
function pickStrings(o: Record<string, unknown>, keys: readonly string[]): Pick<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { ok: false, field: k, error: `${k} must be a string` };
    out[k] = v;
  }
  return { ok: true, value: out };
}

/** Pull the 6 boolean flags, type-checking each present one. */
function pickFlags(o: Record<string, unknown>): Pick<Partial<Record<CreateFlag, boolean>>> {
  const out: Partial<Record<CreateFlag, boolean>> = {};
  for (const k of FLAG_KEYS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'boolean') return { ok: false, field: k, error: `${k} must be a boolean` };
    out[k] = v;
  }
  return { ok: true, value: out };
}

function pickObjectGroups(raw: unknown): Pick<string[] | undefined> {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
    return { ok: false, field: 'objectGroups', error: 'objectGroups must be an array of strings' };
  }
  return { ok: true, value: raw as string[] };
}

export function validateCreateCompanyInput(raw: unknown): CreateValidation<CreateCompanyInput> {
  const o = asObject(raw);
  if (!o) return { ok: false, field: 'body', error: 'request body must be a JSON object' };
  const strings = pickStrings(o, STRING_KEYS_COMPANY);
  if (!strings.ok) return strings;
  const flags = pickFlags(o);
  if (!flags.ok) return flags;
  const address = pickAddress(o.address);
  if (!address.ok) return address;
  const groups = pickObjectGroups(o.objectGroups);
  if (!groups.ok) return groups;
  // organization required-ness (non-empty) is enforced by the wrapper; here we only pass the shape
  // through. The cast is safe: the wrapper throws RealNexValidationError if organization is blank.
  const value = {
    ...strings.value,
    ...flags.value,
    ...(address.value ? { address: address.value } : {}),
    ...(groups.value ? { objectGroups: groups.value } : {}),
  } as unknown as CreateCompanyInput;
  return { ok: true, value };
}

export function validateCreateContactInput(raw: unknown): CreateValidation<CreateContactInput> {
  const o = asObject(raw);
  if (!o) return { ok: false, field: 'body', error: 'request body must be a JSON object' };
  const strings = pickStrings(o, STRING_KEYS_CONTACT);
  if (!strings.ok) return strings;
  const flags = pickFlags(o);
  if (!flags.ok) return flags;
  if (o.useCompanyAddress !== undefined && o.useCompanyAddress !== null && typeof o.useCompanyAddress !== 'boolean') {
    return { ok: false, field: 'useCompanyAddress', error: 'useCompanyAddress must be a boolean' };
  }
  const address = pickAddress(o.address);
  if (!address.ok) return address;
  const groups = pickObjectGroups(o.objectGroups);
  if (!groups.ok) return groups;
  const value = {
    ...strings.value,
    ...flags.value,
    ...(typeof o.useCompanyAddress === 'boolean' ? { useCompanyAddress: o.useCompanyAddress } : {}),
    ...(address.value ? { address: address.value } : {}),
    ...(groups.value ? { objectGroups: groups.value } : {}),
  } as unknown as CreateContactInput;
  return { ok: true, value };
}
