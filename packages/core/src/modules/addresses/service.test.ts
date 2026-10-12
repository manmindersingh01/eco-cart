import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { createDatabase } from '../../db/client.ts'
import { withContext, type RequestContext } from '../../db/context.ts'
import { createPool, type DatabasePool } from '../../db/pool.ts'
import { addresses } from '../../db/schema/index.ts'
import { requireEnv } from '../../env.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors.ts'
import { validationIssues } from '../../testing/errors.ts'
import { createTestAddress, createTestUser } from '../../testing/fixtures.ts'
import { sessionsWaitingOn, waitUntil } from '../../testing/locks.ts'
import {
  addAddress,
  deleteAddress,
  getAddress,
  getShippingAddress,
  listAddresses,
  lockAddressBook,
  MAX_ADDRESSES,
  updateAddress,
} from './service.ts'
import type { NewAddress } from './types.ts'

const pools: DatabasePool[] = []
const connect = (url: string) => {
  const pool = createPool(url, 'addresses-test')
  pools.push(pool)
  return createDatabase(pool)
}
const web = connect(requireEnv('DATABASE_URL'))
const owner = connect(requireEnv('MIGRATION_DATABASE_URL'))

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()))
})

type Buyer = Extract<RequestContext, { role: 'buyer' }>

async function newBuyer(): Promise<Buyer> {
  const user = await createTestUser(owner, 'buyer')
  return { role: 'buyer', userId: user.id }
}

const home: NewAddress = {
  fullName: 'Asha Patil',
  phone: '+919812345678',
  line1: '4 FC Road',
  line2: 'Flat 12, Sunrise Apartments',
  landmark: 'Near Goodluck Cafe',
  city: 'Pune',
  stateCode: '27',
  pincode: '411004',
}
const office: NewAddress = {
  fullName: 'Asha Patil',
  phone: '+919812345678',
  line1: '21 Residency Road',
  city: 'Bengaluru',
  stateCode: '29',
  pincode: '560025',
}

const add = (buyer: RequestContext, input: unknown) =>
  withContext(web, buyer, (tx) => addAddress(tx, buyer, input))
const update = (buyer: RequestContext, id: string, input: unknown) =>
  withContext(web, buyer, (tx) => updateAddress(tx, buyer, id, input))
const remove = (buyer: RequestContext, id: string) =>
  withContext(web, buyer, (tx) => deleteAddress(tx, buyer, id))
const list = (buyer: RequestContext) =>
  withContext(web, buyer, (tx) => listAddresses(tx, buyer))
const get = (buyer: RequestContext, id: string) =>
  withContext(web, buyer, (tx) => getAddress(tx, buyer, id))

/** Each live address as `line1: default?`, in list order. */
const book = async (buyer: Buyer) =>
  (await list(buyer)).map(
    (address) => `${address.line1}${address.isDefault ? ' (default)' : ''}`,
  )

/** Live default addresses in the database, whatever the service says. */
const defaultsIn = async (buyer: Buyer) =>
  owner
    .select({ id: addresses.id })
    .from(addresses)
    .where(
      and(
        eq(addresses.userId, buyer.userId),
        eq(addresses.isDefault, true),
        isNull(addresses.deletedAt),
      ),
    )

/** Checkout's view: the system context, which row-level security does not limit. */
const shippingAddressAsSystem = (buyerId: string, addressId: string) =>
  withContext(web, { role: 'system' }, (tx) =>
    getShippingAddress(tx, buyerId, addressId),
  )

/** Holds the buyer's address book lock until `release` is called. */
async function holdAddressBook(buyer: Buyer) {
  const released = Promise.withResolvers<void>()
  const held = Promise.withResolvers<number>()
  const finished = web.transaction(async (tx) => {
    await lockAddressBook(tx, buyer.userId)
    const result = await tx.execute<{ pid: number }>(
      sql`select pg_backend_pid() as pid`,
    )
    held.resolve(result.rows[0]!.pid)
    await released.promise
  })
  finished.catch(held.reject)
  return { pid: await held.promise, release: released.resolve, finished }
}

/** Starts `attempts` behind the lock, then lets them all go at once. */
async function race<T>(buyer: Buyer, attempts: (() => Promise<T>)[]) {
  const hold = await holdAddressBook(buyer)
  const results = attempts.map((attempt) => attempt())
  // Keep failures from being reported before they are looked at.
  for (const result of results) result.catch(() => {})
  await waitUntil(
    async () => (await sessionsWaitingOn(owner, hold.pid)) === attempts.length,
  )
  hold.release()
  await hold.finished
  return Promise.allSettled(results)
}

describe('addAddress', () => {
  test('makes the first address the default, with its state name', async () => {
    const buyer = await newBuyer()
    const address = await add(buyer, { ...home, isDefault: false })
    expect(address).toEqual({
      id: expect.any(String),
      ...home,
      stateName: 'Maharashtra',
      isDefault: true,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
  })

  test('adds later addresses without changing the default, unless asked', async () => {
    const buyer = await newBuyer()
    await add(buyer, home)
    await add(buyer, office)
    expect(await book(buyer)).toEqual([
      '4 FC Road (default)',
      '21 Residency Road',
    ])
    await add(buyer, { ...office, line1: '7 MG Road', isDefault: true })
    expect(await book(buyer)).toEqual([
      '7 MG Road (default)',
      '21 Residency Road',
      '4 FC Road',
    ])
  })

  test('trims text and stores a blank line 2 or landmark as empty', async () => {
    const buyer = await newBuyer()
    const address = await add(buyer, {
      ...home,
      fullName: '  Asha Patil ',
      line2: '   ',
      landmark: '',
    })
    expect(address).toMatchObject({
      fullName: 'Asha Patil',
      line2: null,
      landmark: null,
    })
    const leftOut = await add(buyer, office)
    expect(leftOut).toMatchObject({ line2: null, landmark: null })
  })

  test('says what is missing in plain words', async () => {
    const buyer = await newBuyer()
    expect(await validationIssues(add(buyer, {}))).toEqual([
      'fullName is required',
      'phone is required',
      'line1 is required',
      'city is required',
      'stateCode is required',
      'pincode is required',
    ])
  })

  test.each<[string, Record<string, unknown>, string]>([
    [
      'a phone from another country',
      { phone: '+14155550100' },
      'phone must be an Indian mobile number, like +919812345678',
    ],
    [
      'a landline',
      { phone: '+912012345678' },
      'phone must be an Indian mobile number, like +919812345678',
    ],
    [
      'a phone without +91',
      { phone: '9812345678' },
      'phone must be an Indian mobile number, like +919812345678',
    ],
    [
      'two digits that are not a state',
      { stateCode: '99' },
      'stateCode must be a GST state code, like 27 for Maharashtra',
    ],
    [
      'the zero state code',
      { stateCode: '00' },
      'stateCode must be a GST state code, like 27 for Maharashtra',
    ],
    [
      'Other Territory',
      { stateCode: '97' },
      'stateCode must be a GST state code, like 27 for Maharashtra',
    ],
    [
      'the retired Daman and Diu code',
      { stateCode: '25' },
      'stateCode must be a GST state code, like 27 for Maharashtra',
    ],
    [
      'the retired Andhra Pradesh code',
      { stateCode: '28' },
      'stateCode must be a GST state code, like 27 for Maharashtra',
    ],
    ['a state code as a number', { stateCode: 27 }, 'stateCode must be text'],
    [
      'a PIN code starting with 0',
      { pincode: '011004' },
      'pincode must be a six-digit PIN code',
    ],
    [
      'a five-digit PIN code',
      { pincode: '41100' },
      'pincode must be a six-digit PIN code',
    ],
    ['an empty name', { fullName: '  ' }, 'fullName must not be empty'],
    [
      'a name over 100 characters',
      { fullName: 'A'.repeat(101) },
      'fullName must be at most 100 characters',
    ],
    [
      'a first line over 200 characters',
      { line1: 'A'.repeat(201) },
      'line1 must be at most 200 characters',
    ],
    [
      'a second line over 200 characters',
      { line2: 'A'.repeat(201) },
      'line2 must be at most 200 characters',
    ],
    [
      'a landmark over 100 characters',
      { landmark: 'A'.repeat(101) },
      'landmark must be at most 100 characters',
    ],
    [
      'a city over 100 characters',
      { city: 'A'.repeat(101) },
      'city must be at most 100 characters',
    ],
    [
      'a default that is not true or false',
      { isDefault: 'yes' },
      'isDefault must be true or false',
    ],
    [
      'an address for another account',
      { userId: randomUUID() },
      'userId is not allowed here',
    ],
  ])('refuses %s', async (_case, overrides, issue) => {
    const buyer = await newBuyer()
    expect(
      await validationIssues(add(buyer, { ...home, ...overrides })),
    ).toEqual([issue])
    expect(await list(buyer)).toEqual([])
  })

  test(`keeps at most ${MAX_ADDRESSES} addresses, not counting deleted ones`, async () => {
    const buyer = await newBuyer()
    const first = await add(buyer, home)
    for (let n = 1; n < MAX_ADDRESSES; n += 1) {
      await add(buyer, { ...office, line1: `${n} MG Road` })
    }
    await expect(add(buyer, office)).rejects.toThrow(
      new ConflictError(
        `You can save up to ${MAX_ADDRESSES} addresses; delete one first`,
      ),
    )
    await remove(buyer, first.id)
    await add(buyer, office)
    expect(await list(buyer)).toHaveLength(MAX_ADDRESSES)
  })
})

describe('updateAddress', () => {
  test('changes only the fields sent', async () => {
    const buyer = await newBuyer()
    const address = await add(buyer, home)
    const changed = await update(buyer, address.id, {
      line1: '5 FC Road',
      stateCode: '29',
      line2: '',
    })
    expect(changed).toEqual({
      ...address,
      line1: '5 FC Road',
      line2: null,
      stateCode: '29',
      stateName: 'Karnataka',
      updatedAt: expect.any(Date),
    })
    expect(await get(buyer, address.id)).toEqual(changed)
  })

  test('switches the default, leaving exactly one', async () => {
    const buyer = await newBuyer()
    const first = await add(buyer, home)
    const second = await add(buyer, office)
    expect(await update(buyer, second.id, { isDefault: true })).toMatchObject({
      isDefault: true,
    })
    expect(await book(buyer)).toEqual([
      '21 Residency Road (default)',
      '4 FC Road',
    ])
    // Asking again for the default it already is changes nothing.
    await update(buyer, second.id, { isDefault: true })
    await update(buyer, first.id, { isDefault: true, city: 'Pune City' })
    expect(await book(buyer)).toEqual([
      '4 FC Road (default)',
      '21 Residency Road',
    ])
  })

  test('refuses to unset the default, an empty change, and bad values', async () => {
    const buyer = await newBuyer()
    const address = await add(buyer, home)
    expect(
      await validationIssues(update(buyer, address.id, { isDefault: false })),
    ).toEqual([
      'isDefault can only be true; make another address the default instead',
    ])
    await expect(update(buyer, address.id, {})).rejects.toThrow(
      'There is nothing to change',
    )
    expect(
      await validationIssues(
        update(buyer, address.id, { pincode: '1234', userId: randomUUID() }),
      ),
    ).toEqual([
      'pincode must be a six-digit PIN code',
      'userId is not allowed here',
    ])
    expect(await get(buyer, address.id)).toEqual(address)
  })

  test('answers 404 for a deleted address, a missing one, or a broken id', async () => {
    const buyer = await newBuyer()
    const address = await add(buyer, home)
    await remove(buyer, address.id)
    for (const id of [address.id, randomUUID(), 'not-an-id']) {
      await expect(update(buyer, id, { city: 'Mumbai' })).rejects.toThrow(
        NotFoundError,
      )
    }
  })
})

describe('deleteAddress', () => {
  test('keeps the row, and hides it from the buyer', async () => {
    const buyer = await newBuyer()
    const address = await add(buyer, home)
    await remove(buyer, address.id)
    expect(await list(buyer)).toEqual([])
    await expect(get(buyer, address.id)).rejects.toThrow(NotFoundError)
    await expect(remove(buyer, address.id)).rejects.toThrow(NotFoundError)
    const [row] = await owner
      .select()
      .from(addresses)
      .where(eq(addresses.id, address.id))
    expect(row).toMatchObject({
      line1: '4 FC Road',
      isDefault: false,
      deletedAt: expect.any(Date),
    })
  })

  test('hands the default to the newest remaining address', async () => {
    const buyer = await newBuyer()
    const first = await add(buyer, home)
    await add(buyer, { ...office, line1: '1 MG Road' })
    await add(buyer, { ...office, line1: '2 MG Road' })
    await remove(buyer, first.id)
    expect(await book(buyer)).toEqual(['2 MG Road (default)', '1 MG Road'])
  })

  test('leaves the default alone when another address goes', async () => {
    const buyer = await newBuyer()
    await add(buyer, home)
    const other = await add(buyer, office)
    await remove(buyer, other.id)
    expect(await book(buyer)).toEqual(['4 FC Road (default)'])
  })
})

describe('one buyer and another', () => {
  test("a buyer cannot read, change, or delete another buyer's address", async () => {
    const asha = await newBuyer()
    const ravi = await newBuyer()
    const ashas = await add(asha, home)
    await expect(get(ravi, ashas.id)).rejects.toThrow(NotFoundError)
    await expect(update(ravi, ashas.id, { city: 'Mumbai' })).rejects.toThrow(
      NotFoundError,
    )
    await expect(remove(ravi, ashas.id)).rejects.toThrow(NotFoundError)
    expect(await list(ravi)).toEqual([])
    expect(await get(asha, ashas.id)).toEqual(ashas)
  })

  test("adding a first address does not touch another buyer's default", async () => {
    const asha = await newBuyer()
    const ravi = await newBuyer()
    await add(asha, home)
    await add(ravi, office)
    expect(await book(asha)).toEqual(['4 FC Road (default)'])
    expect(await book(ravi)).toEqual(['21 Residency Road (default)'])
  })

  test.each<[string, RequestContext]>([
    ['a visitor', { role: 'anonymous' }],
    [
      'a seller',
      { role: 'seller', userId: randomUUID(), sellerId: randomUUID() },
    ],
    ['an administrator', { role: 'admin', userId: randomUUID() }],
    ['the system', { role: 'system' }],
  ])('refuses %s', async (_who, context) => {
    const buyer = await newBuyer()
    const address = await add(buyer, home)
    const refused = new ForbiddenError(
      'Only buyers can save delivery addresses',
    )
    await expect(list(context)).rejects.toThrow(refused)
    await expect(get(context, address.id)).rejects.toThrow(refused)
    await expect(add(context, office)).rejects.toThrow(refused)
    await expect(update(context, address.id, { city: 'X' })).rejects.toThrow(
      refused,
    )
    await expect(remove(context, address.id)).rejects.toThrow(refused)
  })
})

describe('getShippingAddress', () => {
  test("returns the buyer's address as the order snapshot", async () => {
    const buyer = await newBuyer()
    const address = await add(buyer, home)
    expect(await shippingAddressAsSystem(buyer.userId, address.id)).toEqual({
      fullName: 'Asha Patil',
      phone: '+919812345678',
      line1: '4 FC Road',
      line2: 'Flat 12, Sunrise Apartments',
      landmark: 'Near Goodluck Cafe',
      city: 'Pune',
      stateCode: '27',
      pincode: '411004',
    })
  })

  test("refuses a deleted address and another buyer's, even as the system", async () => {
    const asha = await newBuyer()
    const ravi = await newBuyer()
    const deleted = await createTestAddress(owner, {
      userId: asha.userId,
      deleted: true,
    })
    const ravis = await createTestAddress(owner, { userId: ravi.userId })
    for (const id of [deleted.id, ravis.id, randomUUID(), 'not-an-id']) {
      await expect(shippingAddressAsSystem(asha.userId, id)).rejects.toThrow(
        new NotFoundError('There is no saved address with that id'),
      )
    }
  })
})

describe('changes that arrive at the same moment', () => {
  test('two first addresses leave exactly one default', async () => {
    const buyer = await newBuyer()
    const results = await race(buyer, [
      () => add(buyer, home),
      () => add(buyer, office),
    ])
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ])
    expect(await list(buyer)).toHaveLength(2)
    expect(await defaultsIn(buyer)).toHaveLength(1)
  })

  test(`two adds at ${MAX_ADDRESSES - 1} addresses cannot make ${MAX_ADDRESSES + 1}`, async () => {
    const buyer = await newBuyer()
    for (let n = 0; n < MAX_ADDRESSES - 1; n += 1) {
      await add(buyer, { ...office, line1: `${n} MG Road` })
    }
    const results = await race(buyer, [
      () => add(buyer, home),
      () => add(buyer, home),
    ])
    expect(results.map((result) => result.status).toSorted()).toEqual([
      'fulfilled',
      'rejected',
    ])
    const refused = results.find((result) => result.status === 'rejected')
    expect(refused?.reason).toBeInstanceOf(ConflictError)
    expect(await list(buyer)).toHaveLength(MAX_ADDRESSES)
  })

  test('two default switches leave exactly one default', async () => {
    const buyer = await newBuyer()
    await add(buyer, home)
    const second = await add(buyer, office)
    const third = await add(buyer, { ...office, line1: '7 MG Road' })
    const results = await race(buyer, [
      () => update(buyer, second.id, { isDefault: true }),
      () => update(buyer, third.id, { isDefault: true }),
    ])
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ])
    expect(await defaultsIn(buyer)).toHaveLength(1)
  })

  test('deleting the default while another becomes the default leaves one', async () => {
    const buyer = await newBuyer()
    const first = await add(buyer, home)
    const second = await add(buyer, office)
    await add(buyer, { ...office, line1: '7 MG Road' })
    const results = await race<unknown>(buyer, [
      () => remove(buyer, first.id),
      () => update(buyer, second.id, { isDefault: true }),
    ])
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'fulfilled',
    ])
    expect(await defaultsIn(buyer)).toHaveLength(1)
    expect(await list(buyer)).toHaveLength(2)
  })
})
