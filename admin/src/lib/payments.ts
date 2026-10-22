/** Admin payment transitions (mirror of the backend payment state machine). */
export function paymentTargets(status: string): Array<'PAID' | 'REFUNDED' | 'FAILED'> {
  switch (status) {
    case 'UNPAID': return ['PAID', 'FAILED'];
    case 'PENDING': return ['PAID', 'FAILED'];
    case 'DISPUTED': return ['PAID', 'REFUNDED'];
    case 'PAID': return ['REFUNDED'];
    default: return [];
  }
}
