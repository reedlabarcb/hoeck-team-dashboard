/**
 * Optimistic mirror-upsert for P3.7/P3.8 creates. After a successful RealNex create, we upsert a
 * PROVISIONAL row into the read mirror so the new record appears immediately (instead of waiting for
 * the nightly sync). This copy is best-effort + partial: it carries what we know from the input + the
 * returned key; the scheduled RealNex→local sync is the source of truth and reconciles server-computed
 * fields (LXD/SF, geocoded address, object-group keys, etc.). Upsert (not insert), keyed on realnex_key,
 * so a re-run or a rare collision is locally idempotent.
 *
 * ⚠️ CASING: the input is camelCase (WRITE side: organization, address1, city). The mirror jsonb is
 *    PascalCase (READ side: Address1, City), so `toMirrorAddress` converts camelCase → PascalCase to
 *    keep the provisional row read-consistent with synced rows (and with the address-contains query
 *    filter that reads address->>'City'). This is the inverse of the create-body mapping in safe.ts.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { realnexCompanies, realnexContacts } from '@/lib/db/schema';
import { normalizeCompanyName } from '@/lib/external/realnex/normalize';
import type { CreateAddressInput, CreateCompanyInput, CreateContactInput } from '@/lib/external/realnex/types';

const s = (v?: string): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** camelCase CreateAddressInput → PascalCase mirror jsonb ({Address1, City, State, ZipCode, …}) — the
 *  shape the read side + the address-contains query filter expect. null when nothing meaningful. */
export function toMirrorAddress(a?: CreateAddressInput): Record<string, string> | null {
  if (!a) return null;
  const map: Array<[keyof CreateAddressInput, string]> = [
    ['address1', 'Address1'],
    ['address2', 'Address2'],
    ['city', 'City'],
    ['state', 'State'],
    ['zipCode', 'ZipCode'],
    ['country', 'Country'],
  ];
  const out: Record<string, string> = {};
  for (const [camel, pascal] of map) {
    const v = a[camel]?.trim();
    if (v) out[pascal] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** PURE: build the provisional realnex_companies row from the create input + new key. */
export function buildCompanyMirrorRow(key: string, input: CreateCompanyInput, actor: string) {
  const organization = input.organization.trim();
  return {
    realnexKey: key,
    companyName: organization,
    companyNameNormalized: normalizeCompanyName(organization),
    investor: input.investor === true,
    tenant: input.tenant === true,
    agent: input.agent === true,
    vendor: input.vendor === true,
    prospect: input.prospect === true,
    personal: input.personal === true,
    phone: s(input.phone),
    fax: s(input.fax),
    email: s(input.email),
    website: s(input.webSite), // read side stores the field as `website`
    address: toMirrorAddress(input.address), // PascalCase jsonb, read-consistent
    city: s(input.address?.city),
    state: s(input.address?.state),
    createdBy: actor,
    updatedBy: actor,
  };
}

/** PURE: build the provisional realnex_contacts row. `companyName` is looked up by the caller (the
 *  returned contact has no native company link); we set company_key from what we sent. */
export function buildContactMirrorRow(key: string, input: CreateContactInput, actor: string, companyName: string | null) {
  const joined = [s(input.firstName), s(input.lastName)].filter(Boolean).join(' ');
  const fullName = s(input.fullName) ?? (joined || null);
  return {
    realnexKey: key,
    fullName,
    firstName: s(input.firstName),
    lastName: s(input.lastName),
    title: s(input.title),
    companyKey: s(input.companyKey),
    companyName,
    companyNameNormalized: normalizeCompanyName(companyName),
    investor: input.investor === true,
    tenant: input.tenant === true,
    agent: input.agent === true,
    vendor: input.vendor === true,
    prospect: input.prospect === true,
    personal: input.personal === true,
    work: s(input.work),
    fax: s(input.fax),
    mobile: s(input.mobile),
    home: s(input.home),
    email: s(input.email),
    website: s(input.webSite),
    // useCompanyAddress inherits from the company → no own address row.
    address: input.useCompanyAddress ? null : toMirrorAddress(input.address),
    createdBy: actor,
    updatedBy: actor,
  };
}

/** Upsert the provisional company row (idempotent on realnex_key; only touches columns we populate). */
export async function upsertCreatedCompany(key: string, input: CreateCompanyInput, actor: string): Promise<void> {
  const row = buildCompanyMirrorRow(key, input, actor);
  await db
    .insert(realnexCompanies)
    .values(row)
    .onConflictDoUpdate({
      target: realnexCompanies.realnexKey,
      set: {
        companyName: sql`excluded.company_name`,
        companyNameNormalized: sql`excluded.company_name_normalized`,
        investor: sql`excluded.investor`,
        tenant: sql`excluded.tenant`,
        agent: sql`excluded.agent`,
        vendor: sql`excluded.vendor`,
        prospect: sql`excluded.prospect`,
        personal: sql`excluded.personal`,
        phone: sql`excluded.phone`,
        fax: sql`excluded.fax`,
        email: sql`excluded.email`,
        website: sql`excluded.website`,
        address: sql`excluded.address`,
        city: sql`excluded.city`,
        state: sql`excluded.state`,
        updatedAt: sql`NOW()`,
        updatedBy: sql`excluded.updated_by`,
      },
    });
}

/** Upsert the provisional contact row. Best-effort looks up the parent company's name (from the
 *  mirror) for the denormalized company_name; company_key is set from what we sent. */
export async function upsertCreatedContact(key: string, input: CreateContactInput, actor: string): Promise<void> {
  let companyName: string | null = null;
  const companyKey = input.companyKey?.trim();
  if (companyKey) {
    const [co] = await db
      .select({ name: realnexCompanies.companyName })
      .from(realnexCompanies)
      .where(eq(realnexCompanies.realnexKey, companyKey))
      .limit(1);
    companyName = co?.name ?? null;
  }
  const row = buildContactMirrorRow(key, input, actor, companyName);
  await db
    .insert(realnexContacts)
    .values(row)
    .onConflictDoUpdate({
      target: realnexContacts.realnexKey,
      set: {
        fullName: sql`excluded.full_name`,
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        title: sql`excluded.title`,
        companyKey: sql`excluded.company_key`,
        companyName: sql`excluded.company_name`,
        companyNameNormalized: sql`excluded.company_name_normalized`,
        investor: sql`excluded.investor`,
        tenant: sql`excluded.tenant`,
        agent: sql`excluded.agent`,
        vendor: sql`excluded.vendor`,
        prospect: sql`excluded.prospect`,
        personal: sql`excluded.personal`,
        work: sql`excluded.work`,
        fax: sql`excluded.fax`,
        mobile: sql`excluded.mobile`,
        home: sql`excluded.home`,
        email: sql`excluded.email`,
        website: sql`excluded.website`,
        address: sql`excluded.address`,
        updatedAt: sql`NOW()`,
        updatedBy: sql`excluded.updated_by`,
      },
    });
}
