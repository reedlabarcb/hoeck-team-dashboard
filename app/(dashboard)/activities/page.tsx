'use client';

/**
 * /activities — "Log Note" (P3.6 Step 3). The headline WRITE feature: log a History note onto an
 * existing RealNex contact or company. Flow: pick the entity (the P3.5.4 typeahead → the
 * round-trip-proven object key) → event type → verbatim note → a CONFIRM step that states exactly
 * what will be written to which record → POST /api/realnex/activity (add-only child History).
 *
 * The confirm step is the safety-critical gate: the resolver returns the right KEY, and this screen
 * lets the human verify the right PERSON (name + type + company) before anything is written.
 */

import { useEffect, useState } from 'react';
import { RealNexEntitySearch } from '@/components/RealNexEntitySearch';
import { detailPath, type EntityResult } from '@/lib/realnex/format';
import { REALNEX_EVENT_TYPE } from '@/lib/external/realnex/types';

// [['Note',18],['Phone Call',1],...] — Note first (the default). Single-sourced with the route's
// allowlist, so the dropdown can only offer the 6 note-logging types.
const EVENT_TYPES = Object.entries(REALNEX_EVENT_TYPE) as [string, number][];
const DEFAULT_EVENT_TYPE = REALNEX_EVENT_TYPE.Note; // 18

type Phase = 'compose' | 'confirm' | 'submitting' | 'done' | 'error';

function TypeBadge({ type }: { type: 'contact' | 'company' }) {
  return (
    <span
      className={`ml-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        type === 'company' ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-gray-200 bg-gray-50 text-gray-600'
      }`}
    >
      {type}
    </span>
  );
}

export default function LogNotePage() {
  const [entity, setEntity] = useState<EntityResult | null>(null);
  const [eventTypeKey, setEventTypeKey] = useState<number>(DEFAULT_EVENT_TYPE);
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<Phase>('compose');
  const [errorMsg, setErrorMsg] = useState('');

  // Pre-fill from a detail page's "Log Note" deep-link (/activities?type=&key=&name=&company=).
  // An EFFECT (not a useState initializer) so the server render matches the first client render —
  // no hydration mismatch. This ONLY pre-selects the entity, skipping the SEARCH step; it does not
  // touch the confirm gate below — a pre-filled entity is reviewed and confirmed exactly like a
  // searched one (still Review → Confirm & Log before any write).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const type = p.get('type');
    const key = p.get('key');
    const name = p.get('name');
    if ((type === 'contact' || type === 'company') && key && name) {
      setEntity({ type, key, displayName: name, companyName: p.get('company') || null, email: null });
    }
  }, []);

  const eventTypeName = EVENT_TYPES.find(([, k]) => k === eventTypeKey)?.[0] ?? 'Note';
  const trimmedNote = notes.trim();
  const canReview = !!entity && trimmedNote.length > 0;
  const busy = phase === 'submitting';
  const confirming = phase === 'confirm' || phase === 'submitting';

  async function submit() {
    if (!entity) return;
    setPhase('submitting');
    try {
      const res = await fetch('/api/realnex/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectKey: entity.key, objectType: entity.type, eventTypeKey, notes: trimmedNote }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErrorMsg(j.message || j.error || `Request failed (${res.status})`);
        setPhase('error');
        return;
      }
      setPhase('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error');
      setPhase('error');
    }
  }

  function reset() {
    setEntity(null);
    setEventTypeKey(DEFAULT_EVENT_TYPE);
    setNotes('');
    setErrorMsg('');
    setPhase('compose');
  }

  // ---- success ----
  if (phase === 'done' && entity) {
    // Back to the record's detail page — where <RecordHistory> refetches and the new note appears
    // live. Closes the loop: look up → see history → log a note → back to the record → it's there.
    const href = detailPath(entity);
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold text-gray-900">Log Note</h1>
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-5">
          <p className="text-base font-medium text-green-900">
            ✓ Logged a {eventTypeName} to {entity.displayName}
            <TypeBadge type={entity.type} />
          </p>
          <p className="mt-1 text-sm text-green-800">
            It&apos;s now in RealNex; it will appear in the dashboard after the next sync.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={reset} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
              Log another
            </button>
            <a href={href} className="text-sm text-blue-700 hover:underline">View {entity.displayName} →</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Log Note</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Log a history note onto a RealNex contact or company. Nothing is written until you confirm.
        </p>
      </div>

      {/* Compose — shown only while composing; the confirm panel restates everything before a write. */}
      {phase === 'compose' && (
        <>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Contact or company</label>
              {entity ? (
                <div className="flex items-center justify-between rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-gray-900">{entity.displayName}</span>
                    <TypeBadge type={entity.type} />
                    {entity.type === 'contact' && entity.companyName && (
                      <span className="ml-2 text-xs text-gray-500">{entity.companyName}</span>
                    )}
                  </span>
                  <button type="button" onClick={() => setEntity(null)} className="text-xs text-blue-700 hover:underline">
                    change
                  </button>
                </div>
              ) : (
                <RealNexEntitySearch
                  type="both"
                  placeholder="Search a contact or company…"
                  onSelect={(e) => setEntity(e)}
                  onClear={() => setEntity(null)}
                />
              )}
            </div>

            <div>
              <label htmlFor="eventType" className="mb-1 block text-sm font-medium text-gray-700">Event type</label>
              <select
                id="eventType"
                value={eventTypeKey}
                onChange={(e) => setEventTypeKey(Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              >
                {EVENT_TYPES.map(([name, key]) => (
                  <option key={key} value={key}>{name}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="note" className="mb-1 block text-sm font-medium text-gray-700">Note</label>
              <textarea
                id="note"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Type the note exactly as you want it logged…"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            onClick={() => setPhase('confirm')}
            disabled={!canReview}
            className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Review →
          </button>
        </>
      )}

      {/* THE CONFIRM GATE — states exactly what will be written, to which record. */}
      {confirming && entity && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-900">Confirm — this writes to RealNex</h2>
          <p className="mt-2 text-base text-gray-900">
            Log a <span className="font-semibold">{eventTypeName}</span> to{' '}
            <span className="font-semibold">{entity.displayName}</span>
            <TypeBadge type={entity.type} />?
          </p>
          {entity.type === 'contact' && entity.companyName && (
            <p className="mt-0.5 text-sm text-gray-600">Company: {entity.companyName}</p>
          )}
          <div className="mt-3">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Note</div>
            <blockquote className="mt-1 whitespace-pre-wrap rounded border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900">
              {trimmedNote}
            </blockquote>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Writes to RealNex record <code className="rounded bg-amber-100 px-1">{entity.key}</code> · attributed to Mike Hoeck.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={submit}
              disabled={busy}
              className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {busy ? 'Logging…' : 'Confirm & Log'}
            </button>
            <button
              onClick={() => setPhase('compose')}
              disabled={busy}
              className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-medium text-red-900">Note was not logged.</p>
          <p className="mt-1 text-sm text-red-800">{errorMsg}</p>
          <p className="mt-1 text-xs text-red-700">The failed attempt was recorded in the activity log.</p>
          <button
            onClick={() => setPhase('compose')}
            className="mt-3 rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}
