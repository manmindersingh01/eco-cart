import { formatPrice } from '@/lib/storefront-display'

/**
 * The money summary of a cart or an order, as the server worked it out.
 * The browser never adds anything up itself.
 */
export function OrderTotals({
  subtotalPaise,
  discountPaise,
  deliveryPaise,
  totalPaise,
  couponCode = null,
  totalLabel = 'Total',
}: {
  subtotalPaise: number
  discountPaise: number
  deliveryPaise: number
  totalPaise: number
  couponCode?: string | null
  totalLabel?: string
}) {
  return (
    <div className="grid gap-2 text-sm">
      <dl className="grid gap-2">
        <Row label="Items" value={formatPrice(subtotalPaise)} />
        {discountPaise > 0 ? (
          <Row
            label={couponCode ? `Coupon ${couponCode}` : 'Coupon'}
            value={`−${formatPrice(discountPaise)}`}
            valueClass="text-success"
          />
        ) : null}
        <Row
          label="Delivery"
          value={deliveryPaise > 0 ? formatPrice(deliveryPaise) : 'Free'}
        />
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-3 text-base font-semibold">
          <dt>{totalLabel}</dt>
          <dd>{formatPrice(totalPaise)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted">Prices include GST.</p>
    </div>
  )
}

function Row({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  )
}
