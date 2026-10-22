import type { Decision } from '../lib/callables';

/** Reason codes offered in review forms (free-form codes are also accepted by the backend). */
export const REVIEW_REASONS: Array<{ value: string; label: string }> = [
  { value: 'PHOTO_UNCLEAR', label: 'Photo unclear or cropped' },
  { value: 'NAME_MISMATCH', label: 'Name does not match the account' },
  { value: 'DOCUMENT_EXPIRED', label: 'Document expired' },
  { value: 'WRONG_DOCUMENT', label: 'Wrong document type' },
  { value: 'INFO_MISMATCH', label: 'Entered details do not match the document' },
  { value: 'SUSPECTED_TAMPERING', label: 'Suspected tampering or forgery' },
  { value: 'OTHER', label: 'Other' },
];

export interface DecisionDraft {
  decision: Decision | '';
  reasonCode: string;
  publicMessage: string;
  internalNote: string;
}

export const EMPTY_DRAFT: DecisionDraft = { decision: '', reasonCode: '', publicMessage: '', internalNote: '' };

/**
 * Mirrors the backend rules so reviewers get immediate feedback: approvals
 * need the full checklist (when one applies); rejections and resubmission
 * requests need a reason and a message the applicant will see.
 */
export function validateDecision(d: DecisionDraft, checklistComplete: boolean | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!d.decision) errors.decision = 'Choose a decision.';
  if (d.decision === 'APPROVE' && checklistComplete === false) errors.checklist = 'Complete every checklist item before approving.';
  if (d.decision && d.decision !== 'APPROVE') {
    if (!d.reasonCode) errors.reasonCode = 'Choose a reason.';
    const msg = d.publicMessage.trim();
    if (msg.length < 5) errors.publicMessage = 'Write a message the applicant will see (at least 5 characters).';
    else if (msg.length > 500) errors.publicMessage = 'Keep the message under 500 characters.';
  }
  if (d.internalNote.length > 2000) errors.internalNote = 'Keep the internal note under 2000 characters.';
  return errors;
}

export function toDecisionFields(d: DecisionDraft) {
  const approve = d.decision === 'APPROVE';
  return {
    decision: d.decision as Decision,
    reasonCode: approve ? null : d.reasonCode || null,
    publicMessage: d.publicMessage.trim() ? d.publicMessage.trim() : null,
    internalNote: d.internalNote.trim() ? d.internalNote.trim() : null,
  };
}
