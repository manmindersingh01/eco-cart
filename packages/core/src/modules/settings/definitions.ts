import { z } from 'zod'
import {
  email,
  gstin,
  pan,
  paise,
  phoneNumber,
  pincode,
  stateCode,
  strictObject,
  text,
  wholeNumber,
} from '../../lib/validation.ts'

/*
 * Every platform setting (design doc 5.13, backend spec step 3): the shape
 * its value must have, a plain-language description for the admin console,
 * and a default only where a sensible one exists. Commercial values that
 * only the client can decide have no default, so nothing runs on a guess.
 */

interface SettingDefinition<S extends z.ZodType> {
  description: string
  schema: S
  default?: z.output<S>
}

// Keeps each default type-checked against its own schema.
const define = <S extends z.ZodType>(definition: SettingDefinition<S>) =>
  definition

const companyDetails = strictObject({
  legalName: text(200),
  displayName: text(100),
  gstin,
  pan,
  address: strictObject({
    line1: text(200),
    line2: z
      .string()
      .trim()
      .max(200, 'must be at most 200 characters')
      .nullable(),
    city: text(100),
    stateCode,
    pincode,
  }),
  supportEmail: email,
  supportPhone: phoneNumber,
  // Required for marketplaces by the Consumer Protection (E-Commerce)
  // Rules, 2020, and shown on the storefront.
  grievanceOfficer: strictObject({
    name: text(100),
    email,
    phone: phoneNumber,
  }),
})
  .refine((details) => details.gstin.slice(2, 12) === details.pan, {
    path: ['gstin'],
    message: 'must contain the PAN as its 3rd to 12th characters',
  })
  // The same rule as for sellers: a GSTIN belongs to one state.
  .refine((details) => details.gstin.startsWith(details.address.stateCode), {
    path: ['gstin'],
    message: 'must start with the state code of the address',
  })

export type CompanyDetails = z.output<typeof companyDetails>

const definitions = {
  commission_bps: define({
    description:
      'Commission EcoKart keeps from each sale, in basis points (1000 is 10%). A seller with their own rate uses that instead.',
    schema: wholeNumber(0, 10_000),
  }),
  delivery_charge_paise: define({
    description: 'Flat delivery charge per order, in paise (4900 is ₹49).',
    schema: paise,
  }),
  free_delivery_threshold_paise: define({
    description:
      'Orders whose subtotal reaches this amount, in paise, ship free.',
    schema: paise,
  }),
  cod_enabled: define({
    description: 'Whether buyers may choose cash on delivery.',
    schema: z.boolean(),
    default: true,
  }),
  payment_timeout_minutes: define({
    description:
      'Minutes an unpaid online order waits before it is cancelled and its stock released.',
    schema: wholeNumber(5, 120),
    default: 30,
  }),
  ai_daily_limit_platform: define({
    description: 'AI calls allowed per day across the whole platform.',
    schema: wholeNumber(0),
    default: 2000,
  }),
  ai_daily_limit_seller: define({
    description: 'AI calls allowed per day for each seller.',
    schema: wholeNumber(0),
    default: 100,
  }),
  prohibited_terms: define({
    description:
      'Words and phrases that flag a listing for review. Matching ignores upper and lower case.',
    schema: z
      .array(text(100))
      .max(500, 'can hold at most 500 terms')
      .transform((terms) => [
        ...new Set(terms.map((term) => term.toLowerCase())),
      ]),
    default: [],
  }),
  company_details: define({
    description:
      'EcoKart’s legal details, support contacts, and grievance officer, shown on the storefront and used on commission invoices.',
    schema: companyDetails,
  }),
}

export type SettingKey = keyof typeof definitions
export type SettingValue<K extends SettingKey> = z.output<
  (typeof definitions)[K]['schema']
>

/**
 * The same definitions, typed so that looking one up by a generic key gives
 * that key's own value type, which lets the service avoid type casts.
 */
export const settingDefinitions: {
  [K in SettingKey]: {
    description: string
    schema: z.ZodType<SettingValue<K>>
    default?: SettingValue<K>
  }
} = definitions

export const isSettingKey = (key: string): key is SettingKey =>
  Object.hasOwn(settingDefinitions, key)

export const settingKeys: SettingKey[] =
  Object.keys(settingDefinitions).filter(isSettingKey)
