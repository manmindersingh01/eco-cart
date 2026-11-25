import { LinkButton } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'

export default function NotFound() {
  return (
    <EmptyState
      title="Order not found"
      description="Check the order link or return to the order list."
      action={<LinkButton href="/admin/orders">Back to orders</LinkButton>}
    />
  )
}
