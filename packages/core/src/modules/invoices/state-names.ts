/*
 * GST state codes and the names invoices print next to them (GST Rule 46
 * asks for the state's name and code). Step 10 adds the platform's own list
 * of state codes for addresses; until that is merged, the invoices module
 * keeps this one, and the two are made into one at the merge.
 *
 * Codes 25 (Daman and Diu, merged into 26 in 2020) and 28 (Andhra Pradesh
 * before 2014) are kept, because older GSTINs still start with them.
 */
const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
}

/** The state's name for a GST state code, or null for an unknown code. */
export const gstStateName = (code: string): string | null =>
  Object.hasOwn(GST_STATE_NAMES, code) ? GST_STATE_NAMES[code]! : null
