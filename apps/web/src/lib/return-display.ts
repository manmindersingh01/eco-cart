import type { ReturnStatus } from '@ecokart/core'

export const RETURN_STATUS: Record<
  ReturnStatus,
  { label: string; description: string; tone: 'neutral' | 'success' | 'danger' }
> = {
  requested: {
    label: 'Awaiting review',
    description:
      'Your return request is waiting for an administrator to review it.',
    tone: 'neutral',
  },
  approved: {
    label: 'Approved',
    description:
      'Your return has been approved. A refund has not been recorded yet.',
    tone: 'neutral',
  },
  rejected: {
    label: 'Not approved',
    description:
      'Your return request was not approved. Read the decision note below.',
    tone: 'danger',
  },
  refunded: {
    label: 'Refund recorded',
    description: 'A refund has been recorded for this return.',
    tone: 'success',
  },
}
