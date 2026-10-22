import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../auth/authContext';
import { AuthStateProvider } from '../auth/AuthProvider';
import { RequirePermission, RequireStaff } from '../auth/RequireStaff';
import { validateDecision, EMPTY_DRAFT } from '../components/decision';
import { DecisionForm } from '../components/DecisionForm';
import { Layout } from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import { can, type StaffRole } from '../lib/permissions';

vi.mock('../lib/firebase', () => ({ requireFirebase: () => ({ emulators: false }) }));

function auth(role: StaffRole | null, signedIn = true): AuthState {
  return {
    user: signedIn ? ({ uid: 'me', email: 'staff@example.ph' } as AuthState['user']) : null,
    role,
    notStaff: signedIn && role == null,
    loading: false,
    can: (p) => can(role, p),
    signOut: vi.fn(async () => undefined),
  };
}

function renderAt(path: string, state: AuthState) {
  return render(
    <AuthStateProvider value={state}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route
            element={
              <RequireStaff>
                <Layout />
              </RequireStaff>
            }
          >
            <Route index element={<p>home</p>} />
            <Route path="config" element={<RequirePermission permission="config.manage"><p>config page</p></RequirePermission>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthStateProvider>,
  );
}

describe('route protection', () => {
  it('sends signed-out visitors to the login page', () => {
    renderAt('/', auth(null, false));
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('blocks signed-in accounts without a staff role', () => {
    renderAt('/', auth(null));
    expect(screen.getByRole('heading', { name: 'No staff access' })).toBeInTheDocument();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('shows only the sections a role may use', () => {
    renderAt('/', auth('reviewer'));
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Passenger IDs');
    expect(nav).toHaveTextContent('Driver accreditation');
    expect(nav).not.toHaveTextContent('Configuration');
    expect(nav).not.toHaveTextContent('Staff');
    expect(nav).not.toHaveTextContent('Support');
  });

  it('refuses a page the role cannot use even via a direct URL', () => {
    renderAt('/config', auth('support'));
    expect(screen.getByText('Not available for your role')).toBeInTheDocument();
    expect(screen.queryByText('config page')).not.toBeInTheDocument();
  });

  it('lets superadmins see staff management', () => {
    renderAt('/', auth('superadmin'));
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveTextContent('Staff');
  });
});

describe('review decisions', () => {
  it('validates like the backend', () => {
    expect(validateDecision(EMPTY_DRAFT, null).decision).toBeDefined();
    expect(validateDecision({ ...EMPTY_DRAFT, decision: 'APPROVE' }, false).checklist).toBeDefined();
    expect(validateDecision({ ...EMPTY_DRAFT, decision: 'APPROVE' }, true)).toEqual({});
    const reject = validateDecision({ ...EMPTY_DRAFT, decision: 'REJECT', publicMessage: 'no' }, null);
    expect(reject.reasonCode).toBeDefined();
    expect(reject.publicMessage).toBeDefined();
  });

  it('does not submit an incomplete rejection, then submits normalized fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<DecisionForm checklistComplete={null} onSubmit={onSubmit} />);
    await user.click(screen.getByLabelText('Reject'));
    await user.click(screen.getByRole('button', { name: 'Submit decision' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a reason.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Reason'), 'PHOTO_UNCLEAR');
    await user.type(screen.getByLabelText('Message to the applicant'), '  Please retake the front photo in good light.  ');
    await user.click(screen.getByRole('button', { name: 'Submit decision' }));
    expect(onSubmit).toHaveBeenCalledWith({
      decision: 'REJECT',
      reasonCode: 'PHOTO_UNCLEAR',
      publicMessage: 'Please retake the front photo in good light.',
      internalNote: null,
    });
  });

  it('blocks approval until the checklist is complete', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<DecisionForm checklistComplete={false} onSubmit={onSubmit} />);
    await user.click(screen.getByLabelText('Approve'));
    await user.click(screen.getByRole('button', { name: 'Submit decision' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Complete every checklist item/)).toBeInTheDocument();
  });

  it('shows the server error and keeps the draft when the call fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new Error('This record changed in the meantime.');
    });
    render(<DecisionForm checklistComplete={true} onSubmit={onSubmit} />);
    await user.click(screen.getByLabelText('Approve'));
    await user.click(screen.getByRole('button', { name: 'Submit decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This record changed in the meantime.');
    expect(screen.getByLabelText('Approve')).toBeChecked();
  });
});

describe('status badge', () => {
  it('renders a readable label', () => {
    render(<StatusBadge status="NEEDS_RESUBMISSION" />);
    expect(screen.getByText('Needs resubmission')).toBeInTheDocument();
  });
});
