import { useState, type ReactNode } from 'react';
import { toDisplayError } from '../lib/errors';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorBanner, SelectField, TextArea } from './ui';

export interface ReasonResult {
  reasonCode: string;
  publicMessage: string;
  internalNote: string | null;
}

/**
 * Confirmation that collects an audited reason, a message the affected user
 * sees, and an optional internal note. Closes only after the action succeeds.
 */
export function ReasonDialog({ open, title, confirmLabel, danger, reasons, messageLabel = 'Message to the user', requireMessage = true, children, onSubmit, onClose }: {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  reasons: Array<{ value: string; label: string }>;
  messageLabel?: string;
  requireMessage?: boolean;
  children?: ReactNode;
  onSubmit: (r: ReasonResult) => Promise<void>;
  onClose: () => void;
}) {
  const [reasonCode, setReasonCode] = useState('');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = reasonCode !== '' && (!requireMessage || message.trim().length >= 5);
  const reset = () => {
    setReasonCode('');
    setMessage('');
    setNote('');
    setError(null);
  };

  return (
    <ConfirmDialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      danger={danger}
      busy={busy}
      confirmDisabled={!valid}
      onCancel={() => {
        reset();
        onClose();
      }}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          await onSubmit({ reasonCode, publicMessage: message.trim(), internalNote: note.trim() || null });
          reset();
          onClose();
        } catch (err) {
          setError(toDisplayError(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <SelectField label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...reasons]} />
      <TextArea
        label={messageLabel}
        hint={requireMessage ? 'At least 5 characters. Never include internal details.' : 'Optional.'}
        value={message}
        maxLength={500}
        onChange={(e) => setMessage(e.target.value)}
      />
      <TextArea label="Internal note (staff only)" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      <ErrorBanner message={error} />
    </ConfirmDialog>
  );
}
