'use client';

/**
 * "Add Contact" (P3.8) — flag-gated button + two-step create dialog. Renders NOTHING when
 * REALNEX_CREATE_ENABLED is off. Company is chosen via the existing RealNexEntitySearch typeahead
 * (reads the mirror — no new RealNex call), storing the companyKey (GUID). useCompanyAddress mirrors
 * the wrapper guard client-side: disabled until a company is selected; when checked, the address
 * section is hidden/cleared (inherited). POST fires only on Confirm, via useCreateRecord (retry:false).
 */
import { useState } from 'react';
import { useFeatureFlags } from '@/components/FeatureFlags';
import { CreateModalShell } from '@/components/create/CreateModalShell';
import { useCreateRecord } from '@/components/create/useCreateRecord';
import { RealNexEntitySearch } from '@/components/RealNexEntitySearch';
import { retryMayDuplicate } from '@/lib/realnex/create-response';
import type { CreateContactInput } from '@/lib/external/realnex/types';

const INPUT = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-500 focus:outline-none';
const LABEL = 'mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500';
const FLAGS: ReadonlyArray<readonly [keyof CreateContactInput, string]> = [
  ['tenant', 'Tenant'],
  ['prospect', 'Prospect'],
  ['investor', 'Investor'],
  ['agent', 'Agent'],
  ['vendor', 'Vendor'],
  ['personal', 'Personal'],
];

export function AddContact() {
  const { realnexCreateEnabled } = useFeatureFlags();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ name: string; warnings: string[] } | null>(null);

  if (!realnexCreateEnabled) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setCreated(null);
          setOpen(true);
        }}
        className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
      >
        + Add Contact
      </button>
      {created && (
        <div className="rounded border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-900">
          ✓ Created {created.name}
          {created.warnings.length > 0 && <span className="text-amber-800"> · {created.warnings[0]}</span>}
          <button type="button" onClick={() => setCreated(null)} className="ml-2 text-green-700 hover:underline">
            dismiss
          </button>
        </div>
      )}
      {open && (
        <AddContactDialog
          onClose={() => setOpen(false)}
          onCreated={(o) => {
            setOpen(false);
            setCreated(o);
          }}
        />
      )}
    </div>
  );
}

function AddContactDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (o: { name: string; warnings: string[] }) => void }) {
  const [step, setStep] = useState<'fill' | 'confirm'>('fill');
  const [showOptional, setShowOptional] = useState(false);
  const [f, setF] = useState<CreateContactInput>({});
  const [companyName, setCompanyName] = useState(''); // display only; companyKey is the link
  const mutation = useCreateRecord('contact');
  const outcome = mutation.data;

  const set = (patch: Partial<CreateContactInput>) => setF((p) => ({ ...p, ...patch }));
  const setAddr = (patch: Partial<NonNullable<CreateContactInput['address']>>) => setF((p) => ({ ...p, address: { ...p.address, ...patch } }));
  const displayName = [f.firstName?.trim(), f.lastName?.trim()].filter(Boolean).join(' ') || f.fullName?.trim() || '';
  const nameValid = displayName.length > 0;
  const canContinue = nameValid && (!f.useCompanyAddress || !!f.companyKey);
  const ambiguous = outcome ? retryMayDuplicate(outcome) : false;

  function pickCompany(key: string, name: string) {
    set({ companyKey: key });
    setCompanyName(name);
  }
  function clearCompany() {
    // Can't inherit an address from a company that's no longer linked.
    setF((p) => ({ ...p, companyKey: undefined, useCompanyAddress: p.useCompanyAddress ? undefined : p.useCompanyAddress }));
    setCompanyName('');
  }

  function submit() {
    if (mutation.isPending) return;
    mutation.mutate(f as unknown as Record<string, unknown>, {
      onSuccess: (o) => {
        if (o.kind === 'success') onCreated({ name: displayName, warnings: o.warnings });
        else if (o.kind === 'validation') setStep('fill');
      },
    });
  }

  const footer =
    step === 'fill' ? (
      <>
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button type="button" disabled={!canContinue} onClick={() => setStep('confirm')} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40">
          Continue →
        </button>
      </>
    ) : ambiguous ? (
      <button type="button" onClick={onClose} className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800">
        Close &amp; verify in RealNex
      </button>
    ) : (
      <>
        <button type="button" disabled={mutation.isPending} onClick={() => setStep('fill')} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40">
          ← Back
        </button>
        <button type="button" disabled={mutation.isPending} onClick={submit} className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50">
          {mutation.isPending ? 'Creating…' : 'Create contact'}
        </button>
      </>
    );

  return (
    <CreateModalShell onClose={onClose} title="Add Contact" footer={footer}>
      {outcome && outcome.kind !== 'success' && (
        <div className={`mb-3 rounded border px-3 py-2 text-sm ${ambiguous ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-800'}`} role="alert">
          {outcome.message}
        </div>
      )}

      {step === 'fill' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={LABEL}>First name</label>
              <input autoFocus className={INPUT} value={f.firstName ?? ''} onChange={(e) => set({ firstName: e.target.value })} />
            </div>
            <div>
              <label className={LABEL}>Last name</label>
              <input className={INPUT} value={f.lastName ?? ''} onChange={(e) => set({ lastName: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Company</label>
            {f.companyKey ? (
              <div className="flex items-center justify-between rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm">
                <span className="text-gray-900">{companyName || f.companyKey}</span>
                <button type="button" onClick={clearCompany} className="text-xs text-blue-700 hover:underline">
                  change
                </button>
              </div>
            ) : (
              <RealNexEntitySearch type="company" placeholder="Search a company…" onSelect={(e) => pickCompany(e.key, e.displayName)} onClear={clearCompany} />
            )}
          </div>
          <div>
            <label className={`flex items-center gap-1.5 text-sm ${f.companyKey ? 'text-gray-700' : 'text-gray-400'}`}>
              <input type="checkbox" disabled={!f.companyKey} checked={f.useCompanyAddress === true} onChange={(e) => set({ useCompanyAddress: e.target.checked || undefined })} />
              Use the company&apos;s address (inherit — no separate address)
            </label>
          </div>
          <div>
            <label className={LABEL}>Type</label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {FLAGS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5 text-sm text-gray-700">
                  <input type="checkbox" checked={f[k] === true} onChange={(e) => set({ [k]: e.target.checked } as Partial<CreateContactInput>)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => setShowOptional((s) => !s)} className="text-xs text-blue-700 hover:underline">
            {showOptional ? '− Hide' : '+ Add'} title, contact info{f.useCompanyAddress ? '' : ' & address'} (optional)
          </button>
          {showOptional && (
            <div className="space-y-3 rounded border border-gray-100 bg-gray-50 p-3">
              <div className="grid grid-cols-2 gap-2">
                <div><label className={LABEL}>Title</label><input className={INPUT} value={f.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></div>
                <div><label className={LABEL}>Email</label><input className={INPUT} value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} /></div>
                <div><label className={LABEL}>Work</label><input className={INPUT} value={f.work ?? ''} onChange={(e) => set({ work: e.target.value })} /></div>
                <div><label className={LABEL}>Mobile</label><input className={INPUT} value={f.mobile ?? ''} onChange={(e) => set({ mobile: e.target.value })} /></div>
                <div><label className={LABEL}>Home</label><input className={INPUT} value={f.home ?? ''} onChange={(e) => set({ home: e.target.value })} /></div>
                <div><label className={LABEL}>Website</label><input className={INPUT} value={f.webSite ?? ''} onChange={(e) => set({ webSite: e.target.value })} /></div>
              </div>
              {!f.useCompanyAddress && (
                <div>
                  <label className={LABEL}>Address</label>
                  <input className={INPUT} placeholder="Street" value={f.address?.address1 ?? ''} onChange={(e) => setAddr({ address1: e.target.value })} />
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    <input className={INPUT} placeholder="City" value={f.address?.city ?? ''} onChange={(e) => setAddr({ city: e.target.value })} />
                    <input className={INPUT} placeholder="State" value={f.address?.state ?? ''} onChange={(e) => setAddr({ state: e.target.value })} />
                    <input className={INPUT} placeholder="Zip" value={f.address?.zipCode ?? ''} onChange={(e) => setAddr({ zipCode: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-sm text-gray-800">
          <p className="text-gray-600">This creates a NEW contact in RealNex. It can&apos;t be undone from here.</p>
          <dl className="rounded border border-gray-200 divide-y divide-gray-100">
            <Row label="Contact">{displayName}</Row>
            {f.title && <Row label="Title">{f.title}</Row>}
            <Row label="Company">{f.companyKey ? companyName || f.companyKey : '— (no company)'}</Row>
            <Row label="Address">{f.useCompanyAddress ? "Inherited from the company" : [f.address?.address1, f.address?.city, f.address?.state].filter(Boolean).join(', ') || '—'}</Row>
            <Row label="Type">{FLAGS.filter(([k]) => f[k] === true).map(([, l]) => l).join(', ') || '—'}</Row>
          </dl>
        </div>
      )}
    </CreateModalShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-3 py-1.5">
      <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-gray-900">{children}</dd>
    </div>
  );
}
