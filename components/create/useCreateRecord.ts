'use client';

/**
 * useCreateRecord — the single-flight create mutation for P3.7/P3.8. POSTs to /api/realnex/{entity},
 * classifies the response, and (on success) invalidates the list query so the new provisional (mirror)
 * row shows. retry:false — the create is NON-IDEMPOTENT, so an auto-retry would mint a DUPLICATE CRM
 * record. mutationFn never throws (network errors are classified as `ambiguous`), so the caller always
 * gets a CreateOutcome to branch on.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { classifyCreateResponse, type CreateOutcome } from '@/lib/realnex/create-response';

type Entity = 'company' | 'contact';

export function useCreateRecord(entity: Entity) {
  const qc = useQueryClient();
  const listKey = entity === 'company' ? ['realnex', 'companies'] : ['realnex', 'contacts'];

  return useMutation<CreateOutcome, Error, Record<string, unknown>>({
    retry: false, // non-idempotent create — never auto-retry (a retry duplicates the record)
    mutationFn: async (input) => {
      let res: Response;
      try {
        res = await fetch(`/api/realnex/${entity}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
      } catch {
        // Network failure before a response — the create may or may not have landed. Treat as ambiguous.
        return { kind: 'ambiguous', message: 'Network error — the record may not have been created. Check RealNex before retrying.' };
      }
      const body = await res.json().catch(() => ({}));
      return classifyCreateResponse(res.status, body);
    },
    onSuccess: (outcome) => {
      if (outcome.kind === 'success') void qc.invalidateQueries({ queryKey: listKey });
    },
  });
}
