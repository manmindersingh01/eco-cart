import { describe, expect, test } from 'vitest'
import {
  brandApiPath,
  brandListHref,
  categoryParentOptions,
  flattenCategoryTree,
  formatGstRate,
  replaceAbortController,
  serialiseCategory,
  type CategoryNode,
} from './admin-catalogue'

const date = '2026-10-09T00:00:00.000Z'
const node = (
  id: string,
  name: string,
  depth: number,
  children: CategoryNode[] = [],
): CategoryNode => ({
  id,
  parentId: depth === 0 ? null : `parent-${depth}`,
  name,
  slug: name.toLowerCase(),
  depth,
  gstRateBps: 500,
  defaultHsnCode: null,
  sortOrder: 0,
  isActive: true,
  createdAt: date,
  updatedAt: date,
  children,
})

const tree = [
  node('home', 'Home', 0, [
    node('kitchen', 'Kitchen', 1, [node('bottles', 'Bottles', 2)]),
    node('decor', 'Decor', 1),
  ]),
  node('fashion', 'Fashion', 0),
]

describe('admin category tree', () => {
  test('flattens in stable tree order with paths and subtree depth', () => {
    expect(
      flattenCategoryTree(tree).map(({ id, path, levelsBelow }) => ({
        id,
        path,
        levelsBelow,
      })),
    ).toEqual([
      { id: 'home', path: ['Home'], levelsBelow: 2 },
      { id: 'kitchen', path: ['Home', 'Kitchen'], levelsBelow: 1 },
      {
        id: 'bottles',
        path: ['Home', 'Kitchen', 'Bottles'],
        levelsBelow: 0,
      },
      { id: 'decor', path: ['Home', 'Decor'], levelsBelow: 0 },
      { id: 'fashion', path: ['Fashion'], levelsBelow: 0 },
    ])
  })

  test('excludes self, descendants, and parents that make a fourth level', () => {
    expect(categoryParentOptions(tree, 'kitchen').map(({ id }) => id)).toEqual([
      'home',
      'fashion',
    ])
    expect(categoryParentOptions(tree).map(({ id }) => id)).toEqual([
      'home',
      'kitchen',
      'decor',
      'fashion',
    ])
  })

  test('converts GST display and category fields to backend types', () => {
    expect(formatGstRate(25)).toBe('0.25%')
    expect(
      serialiseCategory(
        {
          name: 'Bottles',
          slug: '',
          parentId: 'kitchen',
          gstPercent: '5',
          defaultHsnCode: '',
          sortOrder: '20',
          isActive: false,
        },
        'create',
      ),
    ).toEqual({
      ok: true,
      value: {
        name: 'Bottles',
        parentId: 'kitchen',
        gstRateBps: 500,
        defaultHsnCode: null,
        sortOrder: 20,
        isActive: false,
      },
    })
  })
})

describe('admin brand URLs', () => {
  test('keeps search text with opaque cursor pagination', () => {
    expect(brandListHref('bamboo & home', 'opaque/+value=')).toBe(
      '/admin/brands?q=bamboo+%26+home&cursor=opaque%2F%2Bvalue%3D',
    )
    expect(brandApiPath('bamboo', 'next/value')).toBe(
      '/api/admin/brands?limit=20&q=bamboo&cursor=next%2Fvalue',
    )
  })

  test('cancels the previous search before starting another', () => {
    const first = replaceAbortController()
    const second = replaceAbortController(first)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })
})
