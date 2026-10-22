import { useState, type ReactNode } from 'react';
import { toDisplayError } from '../lib/errors';
import { Button, ErrorBanner, SelectField, TextArea } from './ui';
import { EMPTY_DRAFT, REVIEW_REASONS, toDecisionFields, validateDecision, type DecisionDraft } from './decision';

const OPTIONS = [
  { value: 'APPROVE', label: 'Approve' },
  { value: 'REQUEST_RESUBMISSION', label: 'Request resubmission' },
  { value: 'REJECT', label: 'Reject' },
] as const;

/**
 * Shared review decision form. `checklistComplete` is null when no checklist
 * applies. The parent performs the call; this component handles validation,
 * busy state and server errors.
 */
export function DecisionForm({ onSubmit, checklistComplete, extra, disabled, submitLabel = 'Submit decision' }: {
  onSubmit: (fields: ReturnType<typeof toDecisionFields>) => Promise<void>;
  checklistComplete: boolean | null;
  extra?: (decision: DecisionDraft['decision']) => ReactNode;
  disabled?: boolean;
  submitLabel?: string;
}) {
  const [draft, setDraft] = useState<DecisionDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = async () => {
    const e = validateDecision(draft, checklistComplete);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSubmit(toDecisionFields(draft));
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setServerError(toDisplayError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2" disabled={disabled || busy}>
        <legend className="mb-1 text-sm font-medium">Decision</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-line has-[:checked]:bg-brand-50 has-[:checked]:ring-brand-600">
              <input type="radio" name="decision" value={o.value} checked={draft.decision === o.value} onChange={() => setDraft({ ...draft, decision: o.value })} />
              {o.label}
            </label>
          ))}
        </div>
        {errors.decision && <p className="text-xs text-red-700">{errors.decision}</p>}
        {errors.checklist && <p className="text-xs text-red-700">{errors.checklist}</p>}
      </fieldset>

      {extra?.(draft.decision)}

      {draft.decision && draft.decision !== 'APPROVE' && (
        <>
          <SelectField
            label="Reason"
            value={draft.reasonCode}
            onChange={(e) => setDraft({ ...draft, reasonCode: e.target.value })}
            options={[{ value: '', label: 'Choose a reason…' }, ...REVIEW_REASONS]}
            error={errors.reasonCode}
            disabled={disabled || busy}
          />
          <TextArea
            label="Message to the applicant"
            hint="Shown in the app. Be specific about what to fix; never include internal details."
            value={draft.publicMessage}
            maxLength={500}
            onChange={(e) => setDraft({ ...draft, publicMessage: e.target.value })}
            error={errors.publicMessage}
            disabled={disabled || busy}
          />
        </>
      )}
      <TextArea
        label="Internal note (staff only)"
        value={draft.internalNote}
        maxLength={2000}
        onChange={(e) => setDraft({ ...draft, internalNote: e.target.value })}
        error={errors.internalNote}
        disabled={disabled || busy}
      />
      <ErrorBanner message={serverError} />
      <div>
        <Button type="submit" busy={busy} disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
