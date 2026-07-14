// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EntityResult } from '@/lib/realnex/format';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Stub the typeahead — it's independently tested (RealNexEntitySearch.test.tsx). Here we only
// verify GlobalRecordSearch maps the picked entity to the right detail URL and navigates there.
vi.mock('./RealNexEntitySearch', () => ({
  RealNexEntitySearch: ({ onSelect }: { onSelect: (e: EntityResult) => void }) => (
    <div>
      <button onClick={() => onSelect({ type: 'company', key: 'CO1', displayName: 'Gensler', companyName: null, email: null })}>
        pick-company
      </button>
      <button onClick={() => onSelect({ type: 'contact', key: 'CT1', displayName: 'Britni Stone', companyName: 'Gensler', email: null })}>
        pick-contact
      </button>
    </div>
  ),
}));

import { GlobalRecordSearch } from './GlobalRecordSearch';

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe('GlobalRecordSearch', () => {
  it('navigates to the company detail page on select (not the list)', async () => {
    const user = userEvent.setup();
    render(<GlobalRecordSearch />);
    await user.click(screen.getByText('pick-company'));
    expect(push).toHaveBeenCalledWith('/companies/CO1');
  });

  it('navigates to the contact detail page on select', async () => {
    const user = userEvent.setup();
    render(<GlobalRecordSearch />);
    await user.click(screen.getByText('pick-contact'));
    expect(push).toHaveBeenCalledWith('/contacts/CT1');
  });
});
