export type SettingSource = 'saved' | 'default' | 'missing'

export type CompanyDetails = {
  legalName: string
  displayName: string
  gstin: string
  pan: string
  address: {
    line1: string
    line2: string | null
    city: string
    stateCode: string
    pincode: string
  }
  supportEmail: string
  supportPhone: string
  grievanceOfficer: {
    name: string
    email: string
    phone: string
  }
}

export type AdminSetting = {
  key:
    | 'commission_bps'
    | 'delivery_charge_paise'
    | 'free_delivery_threshold_paise'
    | 'cod_enabled'
    | 'payment_timeout_minutes'
    | 'ai_daily_limit_platform'
    | 'ai_daily_limit_seller'
    | 'prohibited_terms'
    | 'company_details'
  description: string
  value: unknown
  source: SettingSource
  updatedAt: string | null
  updatedBy: string | null
}

export type ParseResult =
  { ok: true; value: number } | { ok: false; error: string }

function parseScaledDecimal(
  raw: string,
  decimalPlaces: number,
  label: string,
): ParseResult {
  const value = raw.trim()
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`)
  if (!pattern.test(value)) {
    return {
      ok: false,
      error: `${label} must be a non-negative number with at most ${decimalPlaces} decimal places.`,
    }
  }

  const [whole, fraction = ''] = value.split('.')
  const scaled =
    BigInt(whole!) * 10n ** BigInt(decimalPlaces) +
    BigInt(fraction.padEnd(decimalPlaces, '0'))
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: `${label} is too large.` }
  }

  return { ok: true, value: Number(scaled) }
}

export function parseRupeesToPaise(raw: string): ParseResult {
  return parseScaledDecimal(raw, 2, 'Amount')
}

export function parsePercentToBasisPoints(raw: string): ParseResult {
  return parseScaledDecimal(raw, 2, 'Percentage')
}

export function parseWholeNumber(raw: string, label: string): ParseResult {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: `${label} must be a non-negative whole number.` }
  }
  const parsed = BigInt(value)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: `${label} is too large.` }
  }
  return { ok: true, value: Number(parsed) }
}

export function paiseToRupeeInput(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return ''
  }
  const whole = Math.floor(value / 100)
  const fraction = String(value % 100).padStart(2, '0')
  return fraction === '00' ? String(whole) : `${whole}.${fraction}`
}

export function basisPointsToPercentInput(value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return ''
  }
  const whole = Math.floor(value / 100)
  const fraction = String(value % 100).padStart(2, '0')
  return fraction === '00'
    ? String(whole)
    : `${whole}.${fraction.replace(/0$/, '')}`
}

export function sourcePresentation(source: SettingSource): {
  label: string
  explanation: string
  tone: 'neutral' | 'success' | 'warning'
} {
  if (source === 'saved') {
    return {
      label: 'Saved value',
      explanation: 'This value was saved by an administrator.',
      tone: 'success',
    }
  }
  if (source === 'default') {
    return {
      label: 'Using default',
      explanation:
        'No value is saved yet. EcoKart is using its built-in default.',
      tone: 'neutral',
    }
  }
  return {
    label: 'Setup required',
    explanation:
      'The client must provide this value before features that need it can run.',
    tone: 'warning',
  }
}

export function issuesFor(issues: readonly string[], path: string): string[] {
  return issues
    .filter((issue) => issue === path || issue.startsWith(`${path} `))
    .map((issue) => issue.slice(path.length).trim())
}
