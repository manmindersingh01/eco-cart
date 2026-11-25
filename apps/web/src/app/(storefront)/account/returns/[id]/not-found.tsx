import { LinkButton } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
export default function NotFound() {
  return (
    <EmptyState
      title="Return not found"
      description="Check the link or open a return from your account."
      action={<LinkButton href="/account/returns">Your returns</LinkButton>}
    />
  )
}
