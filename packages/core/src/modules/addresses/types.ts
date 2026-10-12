import { z } from 'zod'
import {
  indianMobile,
  pincode,
  stateCode,
  strictObject,
  text,
} from '../../lib/validation.ts'

/**
 * A line the buyer may leave out. A form sends a blank field as "", so blank
 * is stored as null, the same as leaving it out.
 */
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const fullName = text(100)
// Couriers call or text the person receiving the parcel.
const phone = indianMobile
const line1 = text(200)
const line2 = optionalLine(200)
const landmark = optionalLine(100)
const city = text(100)

/** What a buyer sends to save an address. */
export const newAddress = strictObject({
  fullName,
  phone,
  line1,
  line2: line2.default(null),
  landmark: landmark.default(null),
  city,
  stateCode,
  pincode,
  /** The buyer's first address becomes the default whatever this says. */
  isDefault: z.boolean().optional(),
})
export type NewAddress = z.input<typeof newAddress>

/** The fields a buyer may change; `isDefault: true` makes it the default. */
export const addressUpdate = strictObject({
  fullName: fullName.optional(),
  phone: phone.optional(),
  line1: line1.optional(),
  line2: line2.optional(),
  landmark: landmark.optional(),
  city: city.optional(),
  stateCode: stateCode.optional(),
  pincode: pincode.optional(),
  // A buyer with addresses always has exactly one default.
  isDefault: z
    .literal(true, {
      error: 'can only be true; make another address the default instead',
    })
    .optional(),
})
export type AddressUpdate = z.input<typeof addressUpdate>

export interface AddressView {
  id: string
  fullName: string
  phone: string
  line1: string
  line2: string | null
  landmark: string | null
  city: string
  stateCode: string
  /** For example Maharashtra for 27. */
  stateName: string
  pincode: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}
