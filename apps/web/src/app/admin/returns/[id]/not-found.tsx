import { LinkButton } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
export default function NotFound() {
  return (
    <EmptyState
      title="Return not found"
      description="Check the link or choose a return from your administrator list."
      action={<LinkButton href="/admin/returns">Returns</LinkButton>}
    />
  )
}
