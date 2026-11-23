import { LinkButton } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'

export default function OrderNotFound() {
  return (
    <EmptyState
      title="Order not found"
      description="This order does not exist or is not available to your seller account."
      action={<LinkButton href="/seller/orders">Back to orders</LinkButton>}
    />
  )
}
