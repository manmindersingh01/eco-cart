export type AccountRole = 'admin' | 'buyer' | 'seller'

export type CurrentAccount = {
  id: string
  name: string
  email: string | null
  phoneNumber: string | null
  role: AccountRole
  sellerId: string | null
}

export function safeReturnTo(value: string | null | undefined): string | null {
  const hasControlCharacter = value
    ? Array.from(value).some((character) => {
        const code = character.charCodeAt(0)
        return code <= 31 || code === 127
      })
    : false
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    hasControlCharacter
  ) {
    return null
  }

  const url = new URL(value, 'https://ecokart.invalid')
  if (url.origin !== 'https://ecokart.invalid') return null
  return `${url.pathname}${url.search}${url.hash}`
}

export function destinationForRole(
  role: AccountRole,
  returnTo?: string | null,
): string {
  const safeDestination = safeReturnTo(returnTo)
  if (safeDestination) return safeDestination
  if (role === 'admin') return '/admin'
  if (role === 'seller') return '/seller'
  return '/'
}

export function roleCanAccess(
  role: AccountRole,
  area: 'admin' | 'seller',
): boolean {
  return role === area
}
