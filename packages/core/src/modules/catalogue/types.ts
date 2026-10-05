import { z } from 'zod'
import {
  gstRateBps,
  hsnCode,
  idOf,
  slug,
  strictObject,
  text,
  wholeNumber,
} from '../../lib/validation.ts'

const isActive = z.boolean({ error: 'must be true or false' })
const sortOrder = wholeNumber(0, 10_000)
const parentId = idOf('a category').nullable()

/** What an administrator sends to create a category. */
export const newCategory = strictObject({
  name: text(80),
  /** Null or left out: a top-level category. */
  parentId: parentId.optional(),
  gstRateBps,
  defaultHsnCode: hsnCode.nullable().optional(),
  sortOrder: sortOrder.optional(),
  /** Left out: made from the name. */
  slug: slug.optional(),
  isActive: isActive.optional(),
})
export type NewCategory = z.input<typeof newCategory>

/** The fields an administrator may change; a new parentId moves the category. */
export const categoryUpdate = strictObject({
  name: text(80).optional(),
  slug: slug.optional(),
  parentId: parentId.optional(),
  gstRateBps: gstRateBps.optional(),
  defaultHsnCode: hsnCode.nullable().optional(),
  sortOrder: sortOrder.optional(),
  isActive: isActive.optional(),
})

export interface CategoryView {
  id: string
  parentId: string | null
  name: string
  slug: string
  /** 0 for the top level, 1 and 2 below it. */
  depth: number
  gstRateBps: number
  defaultHsnCode: string | null
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** A category with its subcategories, as administrators see the tree. */
export interface CategoryNode extends CategoryView {
  children: CategoryNode[]
}

/** A category in the public tree, which holds only visible categories. */
export interface PublicCategory {
  id: string
  name: string
  slug: string
  gstRateBps: number
  defaultHsnCode: string | null
  children: PublicCategory[]
}

/** What an administrator sends to create a brand. */
export const newBrand = strictObject({
  name: text(80),
  /** Left out: made from the name. */
  slug: slug.optional(),
  isActive: isActive.optional(),
})
export type NewBrand = z.input<typeof newBrand>

export const brandUpdate = strictObject({
  name: text(80).optional(),
  slug: slug.optional(),
  isActive: isActive.optional(),
})

export interface BrandView {
  id: string
  name: string
  slug: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** A brand in the public list, which holds only active brands. */
export interface PublicBrand {
  id: string
  name: string
  slug: string
}

export interface BrandListOptions {
  /** Only brands whose name contains this text, ignoring capital letters. */
  q?: string
  cursor?: string
  limit?: number
}
