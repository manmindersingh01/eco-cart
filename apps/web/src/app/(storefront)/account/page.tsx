import { redirect } from 'next/navigation'

/** The account's first section is the buyer's orders. */
export default function AccountPage() {
  redirect('/account/orders')
}
