import { humanize } from '../lib/format';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  neutral: 'bg-slate-50 text-slate-700 ring-slate-200',
};

const STATUS_TONE: Record<string, Tone> = {
  APPROVED: 'success', ACTIVE: 'success', COMPLETED: 'success', PAID: 'success', RESOLVED: 'success', ONLINE: 'success',
  SUBMITTED: 'info', UNDER_REVIEW: 'info', PENDING_REVIEW: 'info', IN_PROGRESS: 'info', SEARCHING: 'info', REQUESTED: 'info',
  ACCEPTED: 'info', DRIVER_EN_ROUTE: 'info', DRIVER_ARRIVED: 'info', OFFERED: 'info', ON_TRIP: 'info', PENDING: 'warning',
  NEEDS_RESUBMISSION: 'warning', DOCUMENTS_PENDING: 'warning', PROFILE_INCOMPLETE: 'warning', OPEN: 'warning', UNPAID: 'warning',
  DISPUTED: 'warning', EXPIRED: 'warning', HIGH: 'warning',
  REJECTED: 'danger', SUSPENDED: 'danger', FAILED: 'danger', URGENT: 'danger', CANCELLED_BY_PASSENGER: 'danger',
  CANCELLED_BY_DRIVER: 'danger', CANCELLED_BY_ADMIN: 'danger',
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  const tone = (status && STATUS_TONE[status]) || 'neutral';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${TONES[tone]}`}>
      {label ?? humanize(status)}
    </span>
  );
}
