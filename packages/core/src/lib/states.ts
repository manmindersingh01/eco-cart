/*
 * The GST state codes of India's 28 states and 8 union territories. They are
 * the first two digits of every GSTIN, and comparing the seller's code with
 * the delivery address's decides CGST plus SGST against IGST (design doc
 * 6.6), so a code that only looks right, such as 00 or 99, must never be
 * stored.
 *
 * Left out on purpose, because no seller or delivery address can have them:
 * 97 (Other Territory, for offshore areas), and the retired 25 (Daman and
 * Diu, merged into 26 in 2020) and 28 (Andhra Pradesh before 2014, now 37).
 *
 * This file imports nothing, so the browser can use it too, through
 * `@ecokart/core/states`.
 */

export interface GstState {
  /** Two digits, for example 27. */
  code: string
  /** For example Maharashtra. */
  name: string
}

/** In code order. */
export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
]

const NAMES = new Map(GST_STATES.map((state) => [state.code, state.name]))

/** Whether `code` is one of the GST state codes above. */
export const isGstStateCode = (code: string): boolean => NAMES.has(code)

/**
 * The name for a GST state code, for example Maharashtra for 27, or
 * undefined for a code that is not in the list.
 */
export const stateName = (code: string): string | undefined => NAMES.get(code)
