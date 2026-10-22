import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/authContext';
import { DecisionForm } from '../components/DecisionForm';
import { DocumentViewer } from '../components/DocumentViewer';
import { StatusBadge } from '../components/StatusBadge';
import { Button, CachedHint, Card, ErrorBanner, KeyValue, Loading, Notice, PageHeader } from '../components/ui';
import { api, VERIFICATION_CHECKLIST, type ChecklistKey } from '../lib/callables';
import { toDisplayError } from '../lib/errors';
import { formatCalendarDate, formatDateTime, maskPhone } from '../lib/format';
import type { UserRecord, VerificationCase } from '../lib/models';
import { useDocument } from '../lib/useFirestore';

const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  nameMatchesProfile: 'Name on the ID matches the account name',
  photoClear: 'Photos are clear, uncropped and readable',
  documentUnexpired: 'The ID is not expired (check the printed date)',
  appearsAuthentic: 'The ID appears genuine and unaltered',
};

export function VerificationCasePage() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const c = useDocument<VerificationCase>(`verificationCases/${caseId}`);
  const applicant = useDocument<UserRecord>(c.data ? `users/${c.data.uid}` : null);
  const [checklist, setChecklist] = useState<Partial<Record<ChecklistKey, boolean>>>({});
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  if (c.loading) return <Loading />;
  if (c.error) return <ErrorBanner message={c.error.message} />;
  if (!c.data) return <Notice tone="warning">This case does not exist.</Notice>;

  const v = c.data;
  const open = v.status === 'SUBMITTED' || v.status === 'UNDER_REVIEW';
  const mine = v.claimedBy === user?.uid;
  const othersClaim = v.claimedBy != null && !mine;
  const ownAccount = v.uid === user?.uid;
  const complete = VERIFICATION_CHECKLIST.every((k) => checklist[k] === true);
  const sides = (v.files ?? []).map((f) => f.side).filter((s): s is 'FRONT' | 'BACK' => s === 'FRONT' || s === 'BACK');

  const claim = async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      await api.claimVerificationCase(v.caseId ?? caseId);
    } catch (err) {
      setClaimError(toDisplayError(err).message);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <>
      <PageHeader
        title={v.applicantName}
        subtitle={<>Case {caseId} · attempt #{v.attempt} · submitted {formatDateTime(v.submittedAt)}</>}
        actions={<Link to="/verifications" className="text-sm text-brand-700 underline">Back to queue</Link>}
      />
      <CachedHint show={c.fromCache} />
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-6">
          <Card title="Submitted details" actions={<StatusBadge status={v.status} />}>
            <KeyValue
              items={[
                ['ID type', v.idTypeLabel],
                ['Name on ID (typed by applicant)', v.nameOnId],
                ['Account name', applicant.data?.displayName ?? '—'],
                ['Expiry (typed by applicant)', v.idExpiry ? formatCalendarDate(v.idExpiry) : 'No expiry for this ID type'],
                ['Phone', maskPhone(applicant.data?.phoneNumber) ?? v.applicantPhoneMasked],
                ['Account created', formatDateTime(applicant.data?.createdAt)],
              ]}
            />
          </Card>
          {can('documents.view') && (
            <Card title="Documents">
              <div className="grid gap-6 md:grid-cols-2">
                {sides.map((side) => (
                  <DocumentViewer key={side} label={side === 'FRONT' ? 'Front' : 'Back'} request={{ kind: 'PASSENGER_CASE', caseId, side }} />
                ))}
              </div>
            </Card>
          )}
          {v.decision && (
            <Card title="Decision">
              <KeyValue
                items={[
                  ['Decision', v.decision.decision],
                  ['Reason', v.decision.reasonCode ?? '—'],
                  ['Message to passenger', v.decision.publicMessage ?? '—'],
                  ['Internal note', v.decision.internalNote ?? '—'],
                  ['Decided', formatDateTime(v.decision.decidedAt)],
                ]}
              />
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {open && ownAccount && <Notice tone="warning">You cannot review your own account.</Notice>}
          {open && !ownAccount && can('review.decide') && (
            <Card title="Review">
              {!mine && (
                <div className="mb-4 flex flex-col gap-2">
                  {othersClaim ? (
                    <Notice tone="warning">Another reviewer has claimed this case.</Notice>
                  ) : (
                    <Notice>Claim the case before deciding so no one else works on it at the same time.</Notice>
                  )}
                  {!othersClaim && (
                    <Button onClick={() => void claim()} busy={claiming}>
                      Claim case
                    </Button>
                  )}
                  <ErrorBanner message={claimError} />
                </div>
              )}
              {mine && (
                <>
                  <fieldset className="mb-4 flex flex-col gap-2">
                    <legend className="mb-1 text-sm font-medium">Checklist (required to approve)</legend>
                    {VERIFICATION_CHECKLIST.map((k) => (
                      <label key={k} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-0.5" checked={checklist[k] === true} onChange={(e) => setChecklist({ ...checklist, [k]: e.target.checked })} />
                        {CHECKLIST_LABELS[k]}
                      </label>
                    ))}
                  </fieldset>
                  <DecisionForm
                    checklistComplete={complete}
                    onSubmit={async (fields) => {
                      await api.decidePassengerVerification({ ...fields, caseId, checklist });
                      navigate('/verifications');
                    }}
                  />
                </>
              )}
            </Card>
          )}
          {!open && <Notice>This case is closed. Changes to an approved passenger are made from the user page.</Notice>}
          {applicant.data && (
            <Link className="text-sm text-brand-700 underline" to={`/users/${v.uid}`}>
              Open user record
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
