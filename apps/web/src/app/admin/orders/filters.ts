export type OrderFilters = {
  status?: string
  orderNumber?: string
  needsRefund?: string
  cursor?: string
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export function orderFilters(
  query: Record<string, string | string[] | undefined>,
): OrderFilters {
  return Object.fromEntries(
    ['status', 'orderNumber', 'needsRefund', 'cursor'].flatMap((key) => {
      const value = first(query[key])
      return value ? [[key, value]] : []
    }),
  )
}

export function ordersHref(filters: OrderFilters) {
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  )
  return `/admin/orders?${query}` as const
}
