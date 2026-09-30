/**
 * Reads a required environment variable and fails fast with a clear message,
 * so a missing secret stops the process at startup instead of at first use.
 */
export function requireEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}
