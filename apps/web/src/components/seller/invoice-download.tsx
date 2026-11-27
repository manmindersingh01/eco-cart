import { PrivateFileDownload } from '@/components/ui/private-file-download'

export function InvoiceDownload({
  id,
  area = 'seller',
}: {
  id: string
  area?: 'seller' | 'admin'
}) {
  return (
    <PrivateFileDownload
      href={`/api/invoices/${id}/pdf${area === 'seller' ? '?as=seller' : ''}`}
      label="Download PDF"
      unavailableTitle="Invoice unavailable"
      help="Refresh this page and try again. If it is still unavailable, contact an administrator."
    />
  )
}
