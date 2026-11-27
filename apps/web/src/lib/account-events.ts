export const ACCOUNT_UPDATED = 'ecokart:account-updated'

export function announceAccountUpdate() {
  window.dispatchEvent(new Event(ACCOUNT_UPDATED))
}
