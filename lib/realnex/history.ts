/**
 * RealNex object-history (notes) normalization for the P3.13 Record View. The notes are read
 * LIVE per record via the wrapper's getObjectHistory (already one of the 13 GET methods) — NOT
 * synced into the mirror. This module shapes the raw HistoryPageResponse into the UI's note list
 * and resolves each note's userKey → a display name via a CACHED listUsers.
 *
 * READ-ONLY: listUsers + getObjectHistory are both wrapper GETs. Nothing here writes.
 */
import { listUsers } from '@/lib/external/realnex/safe';

export interface HistoryNote {
  historyKey: string | null;
  eventTypeKey: number | null;
  eventTypeName: string | null;
  subject: string | null;
  notes: string | null;
  date: string | null; // startDate (ISO-naive "YYYY-MM-DDTHH:mm:ss")
  userKey: string | null;
  userName: string | null; // resolved via listUsers; null if unresolved
}

export interface HistoryPage {
  totalCount: number;
  pageNumber: number;
  pageSize: number;
  items: HistoryNote[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Shape one raw history item. On READ the event type is nested `eventType:{key,name}` (unlike the
 * flat `eventTypeKey` on the write model); we take `.name` (falling back to the key).
 */
export function normalizeHistoryItem(raw: any, userNames: Map<string, string>): HistoryNote {
  const et = raw?.eventType;
  const eventTypeKey = typeof et?.key === 'number' ? et.key : typeof et === 'number' ? et : null;
  const eventTypeName = str(et?.name) ?? (eventTypeKey != null ? String(eventTypeKey) : null);
  const userKey = str(raw?.userKey);
  const userName = userKey ? userNames.get(userKey.toLowerCase()) ?? null : null;
  return {
    historyKey: str(raw?.key),
    eventTypeKey,
    eventTypeName,
    subject: str(raw?.subject),
    notes: str(raw?.notes),
    date: str(raw?.startDate),
    userKey,
    userName,
  };
}

/**
 * Shape a HistoryPageResponse. Sorts the page newest-first by date (RealNex's cross-page order
 * isn't guaranteed; most records fit one page so this is correct in practice — the rare heavy-
 * history record's "Load older" pages are each internally newest-first).
 */
export function normalizeHistoryPage(rawPage: any, pageSize: number, userNames: Map<string, string>): HistoryPage {
  const rawItems = Array.isArray(rawPage?.items) ? rawPage.items : [];
  const items = rawItems.map((it: any) => normalizeHistoryItem(it, userNames));
  items.sort((a: HistoryNote, b: HistoryNote) => (b.date ?? '').localeCompare(a.date ?? ''));
  return {
    totalCount: typeof rawPage?.totalCount === 'number' ? rawPage.totalCount : items.length,
    pageNumber: typeof rawPage?.pageNumber === 'number' ? rawPage.pageNumber : 1,
    pageSize,
    items,
  };
}

/** Build a userKey→name map from whatever shape listUsers returns (array, {value}/{items}, or map). */
export function usersToNameMap(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.value)
      ? (raw as any).value
      : Array.isArray((raw as any)?.items)
        ? (raw as any).items
        : null;
  if (arr) {
    for (const u of arr) {
      const k = u?.key ?? u?.Key ?? u?.userId ?? u?.id ?? u?.Id;
      // RealNex /Crm/users items name the user in `userName` (not `name`); tolerate variants.
      const n = u?.userName ?? u?.UserName ?? u?.name ?? u?.Name ?? u?.loginName ?? u?.LoginName;
      if (k != null) map.set(String(k).toLowerCase(), n ? String(n) : String(k));
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = typeof v === 'string' ? v : (v as any)?.name ?? (v as any)?.Name;
      map.set(String(k).toLowerCase(), n ? String(n) : String(k));
    }
  }
  return map;
}

// Cached user-name map. CRM users rarely change; refresh every 10 min. (This is a Next route
// context — Date.now() is fine here; the injectable `now` param keeps tests deterministic.)
let usersCache: { at: number; map: Map<string, string> } | null = null;
const USERS_TTL_MS = 10 * 60_000;

export async function getUserNameMap(now: number = Date.now()): Promise<Map<string, string>> {
  if (usersCache && now - usersCache.at < USERS_TTL_MS) return usersCache.map;
  let raw: unknown = [];
  try {
    raw = await listUsers();
  } catch {
    raw = [];
  }
  const map = usersToNameMap(raw);
  usersCache = { at: now, map };
  return map;
}

/** Test hook: clear the module-level users cache. */
export function __resetUsersCacheForTest() {
  usersCache = null;
}
