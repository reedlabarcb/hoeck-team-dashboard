// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LinkedContacts, type LinkedContactItem } from './LinkedContacts';

const contacts: LinkedContactItem[] = [
  { key: 'CK1', fullName: 'Britni Stone', firstName: 'Britni', lastName: 'Stone', title: 'VP', email: 'b@x.com' },
  { key: 'CK2', fullName: null, firstName: 'Al', lastName: 'Ng', title: null, email: null },
];

afterEach(cleanup);

describe('LinkedContacts', () => {
  it('renders each contact linking to its detail page (name via contactDisplayName)', () => {
    render(<LinkedContacts contacts={contacts} />);
    expect(screen.getByText('Contacts (2)')).toBeTruthy();
    const l1 = screen.getByRole('link', { name: 'Britni Stone' }) as HTMLAnchorElement;
    expect(l1.getAttribute('href')).toBe('/contacts/CK1');
    const l2 = screen.getByRole('link', { name: 'Al Ng' }) as HTMLAnchorElement; // first+last fallback
    expect(l2.getAttribute('href')).toBe('/contacts/CK2');
  });

  it('empty → "No linked contacts."', () => {
    render(<LinkedContacts contacts={[]} />);
    expect(screen.getByText(/No linked contacts/i)).toBeTruthy();
  });
});
