import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Timestamp } from 'firebase/firestore';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../lib/callables';
import { RequestCard } from '../pages/PrivacyRequestsPage';

vi.mock('../lib/firebase', () => ({ requireFirebase: () => ({ emulators: false }) }));

const request = {
  id: 'req1',
  requestId: 'req1',
  uid: 'user-abc-123',
  type: 'DELETION' as const,
  note: 'Please delete my account',
  status: 'RECEIVED' as const,
  createdAt: Timestamp.fromMillis(Date.now() - 3_600_000),
  updatedAt: Timestamp.fromMillis(Date.now() - 3_600_000),
};

describe('privacy request handling', () => {
  it('requires the exact account id before deleting', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'deleteUserData').mockResolvedValue({ status: 'COMPLETED', rides: 2, ratings: 1, supportCases: 0, verificationCases: 1, files: 3 });
    render(
      <MemoryRouter>
        <RequestCard request={request} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Delete account…' }));
    const confirm = screen.getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Type the account id to confirm'), 'user-abc-12');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Type the account id to confirm'), '3');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(spy).toHaveBeenCalledWith({ requestId: 'req1', confirmUid: 'user-abc-123' });
    expect(await screen.findByText(/Anonymised 2 rides/)).toBeInTheDocument();
  });

  it('requires a resolution note to close a request', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, 'resolveDataRequest').mockResolvedValue({ status: 'REJECTED' });
    render(
      <MemoryRouter>
        <RequestCard request={{ ...request, type: 'CORRECTION' }} />
      </MemoryRouter>,
    );
    const close = screen.getByRole('button', { name: 'Close request' });
    expect(close).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Resolution'), 'REJECTED');
    await user.type(screen.getByLabelText('Resolution note (audited)'), 'Name must match the reviewed ID.');
    await user.click(close);
    expect(spy).toHaveBeenCalledWith({ requestId: 'req1', status: 'REJECTED', resolutionNote: 'Name must match the reviewed ID.' });
  });
});
