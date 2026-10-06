import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { ValidationError } from '../errors.ts'
import {
  email,
  idOf,
  parseInput,
  pincode,
  strictObject,
  text,
  wholeNumber,
} from './validation.ts'

const issuesFor = (schema: z.ZodType, value: unknown): string[] => {
  try {
    parseInput(schema, value, 'Those details are not valid')
  } catch (error) {
    if (error instanceof ValidationError) return error.issues
    throw error
  }
  throw new Error('Expected the value to be refused')
}

const form = strictObject({
  name: text(50),
  pincode,
  quantity: wholeNumber(1, 10),
  gift: z.boolean(),
  tags: z.array(text(20)),
  address: strictObject({ city: text(50) }),
  kind: z.enum(['home', 'office']),
  categoryId: idOf('a category'),
  email,
})

describe('parseInput', () => {
  test('says a missing field is required, whatever its kind', () => {
    expect(issuesFor(form, {})).toEqual([
      'name is required',
      'pincode is required',
      'quantity is required',
      'gift is required',
      'tags is required',
      'address is required',
      'kind is required',
      'categoryId is required',
      'email is required',
    ])
  })

  test('names the expected kind of value in plain words', () => {
    expect(
      issuesFor(form, {
        name: 5,
        pincode: 411001,
        quantity: '3',
        gift: 'yes',
        tags: 'eco',
        address: 'Pune',
        kind: 'shop',
        categoryId: 7,
        email: 42,
        colour: 'green',
      }),
    ).toEqual([
      'name must be text',
      'pincode must be text',
      'quantity must be a number',
      'gift must be true or false',
      'tags must be a list',
      'address must be an object',
      'kind must be one of home, office',
      'categoryId must be a category id',
      'email must be an email address',
      'colour is not allowed here',
    ])
  })

  test('keeps the format messages of the shared rules', () => {
    expect(
      issuesFor(form, {
        name: ' ',
        pincode: '011001',
        quantity: 2.5,
        gift: true,
        tags: [],
        address: { city: 'Pune' },
        kind: 'home',
        categoryId: 'kitchen',
        email: 'not-an-email',
      }),
    ).toEqual([
      'name must not be empty',
      'pincode must be a six-digit PIN code',
      'quantity must be a whole number',
      'categoryId must be a category id',
      'email must be an email address',
    ])
  })
})
