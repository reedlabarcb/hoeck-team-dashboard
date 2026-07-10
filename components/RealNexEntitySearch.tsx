'use client';

/**
 * <RealNexEntitySearch> — debounced, keyboard-navigable typeahead over the RealNex mirror
 * (P3.5.4). The last read-scaffolding piece; P3.6 note-logging drops it in directly.
 *
 * Hits GET /api/realnex/resolve (the key-correct resolver proven in P3.5.1) — reads the local
 * mirror, so it's instant with no live RealNex call per keystroke. On select it hands the caller
 * the FULL result via onSelect; `key` is the RealNex OBJECT KEY that P3.6 appendActivity POSTs
 * history to — picking the wrong row logs to the wrong record, so this component must return
 * exactly the resolved entity, key untouched.
 *
 * Two wiring modes (both battle-tested in the list pages before P3.6 inherits it):
 *   - live filter: pass onQueryChange — the debounced raw text drives a list query as you type
 *     (the /companies + /contacts name search).
 *   - exact pick:  ignore onQueryChange, use onSelect(entity.key) + onClear — the picked entity's
 *     exact key filters, and typing never leaks into the filter (the /contacts company filter,
 *     replacing the long plain <select>).
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EntityResult } from '@/lib/realnex/format';

export interface RealNexEntitySearchProps {
  /** Which entity kinds to resolve. Passed straight to the resolver. Default 'both'. */
  type?: 'contact' | 'company' | 'both';
  placeholder?: string;
  /** Seeds the input once on mount (via effect, so no SSR/client hydration mismatch). */
  initialQuery?: string;
  /** Max results in the dropdown. Default 10. */
  limit?: number;
  /** Debounce before the resolver is hit / onQueryChange fires. Default 200ms. */
  debounceMs?: number;
  /** REQUIRED — receives the full picked entity; `entity.key` is the RealNex object key. */
  onSelect: (entity: EntityResult) => void;
  /** Optional — debounced raw text, for live list filtering. */
  onQueryChange?: (q: string) => void;
  /** Optional — fired when the input is cleared, for resetting an exact-key filter. */
  onClear?: () => void;
  autoFocus?: boolean;
  className?: string;
}

interface ResolveResponse {
  results: EntityResult[];
}

async function fetchResolve(q: string, type: string, limit: number): Promise<ResolveResponse> {
  const p = new URLSearchParams({ q, type, limit: String(limit) });
  const res = await fetch(`/api/realnex/resolve?${p.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`resolve failed: ${res.status}`);
  return res.json();
}

export function RealNexEntitySearch({
  type = 'both',
  placeholder = 'Search…',
  initialQuery,
  limit = 10,
  debounceMs = 200,
  onSelect,
  onQueryChange,
  onClear,
  autoFocus,
  className,
}: RealNexEntitySearchProps) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const seededRef = useRef(false);
  // Set before a PROGRAMMATIC text change (select/clear/seed) so the debounce effect skips it —
  // keeps a selection from leaking into onQueryChange (which would break the exact-key filter).
  const suppressRef = useRef(false);
  // Callbacks via ref so inline parent handlers don't re-run the debounce effect (timer reset).
  const cbRef = useRef({ onQueryChange, onSelect, onClear });
  useEffect(() => {
    cbRef.current = { onQueryChange, onSelect, onClear };
  });

  const listId = useId();

  // Debounce the raw text → the resolver query + onQueryChange. Skipped for programmatic edits
  // (select/clear/seed set suppressRef) and for no-ops like the initial mount (text === debounced),
  // so we never fire a spurious onQueryChange('') before the user has typed.
  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }
    if (text === debounced) return;
    const t = setTimeout(() => {
      setDebounced(text);
      cbRef.current.onQueryChange?.(text);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [text, debounced, debounceMs]);

  // Seed from initialQuery once, on mount (deep-link like /companies?q=Acme). Effect not a
  // useState initializer → the server-rendered empty input matches the first client render.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const seed = (initialQuery ?? '').trim();
    if (seed) {
      suppressRef.current = true;
      setText(initialQuery as string);
      setDebounced(initialQuery as string);
      cbRef.current.onQueryChange?.(initialQuery as string);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fresh search resets the highlight.
  useEffect(() => {
    setActiveIndex(-1);
  }, [debounced]);

  const enabled = open && debounced.trim().length > 0;
  const { data, isFetching } = useQuery({
    queryKey: ['realnex', 'resolve', type, debounced, limit],
    queryFn: () => fetchResolve(debounced, type, limit),
    enabled,
    staleTime: 30_000,
  });
  const results = data?.results ?? [];

  const selectEntity = useCallback((entity: EntityResult) => {
    suppressRef.current = true;
    setText(entity.displayName);
    setDebounced(entity.displayName);
    setOpen(false);
    setActiveIndex(-1);
    cbRef.current.onSelect(entity);
  }, []);

  const clearInput = useCallback(() => {
    suppressRef.current = true;
    setText('');
    setDebounced('');
    setActiveIndex(-1);
    setOpen(false);
    cbRef.current.onQueryChange?.('');
    cbRef.current.onClear?.();
    inputRef.current?.focus();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setText(v);
    if (!open) setOpen(true);
    if (v.trim() === '') cbRef.current.onClear?.();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (results.length) setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        selectEntity(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  // Close when focus leaves the whole widget (Tab away). Result mousedown is prevented so a
  // click selects before the input blurs.
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }

  const showDropdown = open && text.trim().length > 0;
  const searching = isFetching || text.trim() !== debounced.trim();

  return (
    <div className={`relative ${className ?? ''}`} onBlur={handleBlur}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (text.trim().length > 0) setOpen(true);
        }}
        className="w-full rounded border border-gray-300 px-3 py-2 pr-8 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
      />
      {text && (
        <button
          type="button"
          onClick={clearInput}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {searching ? (
            <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">No matches</li>
          ) : (
            results.map((r, i) => (
              <li
                key={`${r.type}:${r.key}`}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectEntity(r)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                  i === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-gray-900">{r.displayName}</span>
                  {r.type === 'contact' && r.companyName && (
                    <span className="ml-2 text-xs text-gray-500">{r.companyName}</span>
                  )}
                  {r.email && <span className="ml-2 text-xs text-gray-400">{r.email}</span>}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    r.type === 'company'
                      ? 'border-blue-200 bg-blue-50 text-blue-900'
                      : 'border-gray-200 bg-gray-50 text-gray-600'
                  }`}
                >
                  {r.type}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
