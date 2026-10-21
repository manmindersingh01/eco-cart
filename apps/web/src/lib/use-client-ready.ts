'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => undefined
const client = () => true
const server = () => false

/**
 * Controlled forms must not accept input before React attaches handlers.
 * Their forms opt out of disabled-state restoration with autocomplete off,
 * so Firefox reloads the server's state before hydration.
 */
export function useClientReady() {
  return useSyncExternalStore(subscribe, client, server)
}
