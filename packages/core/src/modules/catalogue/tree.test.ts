import { describe, expect, test } from 'vitest'
import { buildCategoryTree, type TreeCategory } from './tree.ts'

const category = (
  id: string,
  parentId: string | null,
  extra: Partial<TreeCategory> = {},
): TreeCategory => ({
  id,
  parentId,
  name: id,
  slug: id.toLowerCase(),
  sortOrder: 0,
  isActive: true,
  ...extra,
})

/*
 *   Home ─┬─ Kitchen ─┬─ Bottles
 *         │           └─ Cutlery
 *         └─ Storage
 *   Care ─── Soaps (inactive parent: Care)
 */
const tree = buildCategoryTree([
  category('Soaps', 'Care'),
  category('Storage', 'Home', { sortOrder: 2 }),
  category('Kitchen', 'Home', { sortOrder: 1 }),
  category('Cutlery', 'Kitchen'),
  category('Bottles', 'Kitchen'),
  category('Care', null, { isActive: false, sortOrder: 1 }),
  category('Home', null),
])
const ids = (categories: TreeCategory[]) => categories.map((c) => c.id)

describe('buildCategoryTree', () => {
  test('lists children by sort order, then by name', () => {
    expect(ids(tree.childrenOf(null))).toEqual(['Home', 'Care'])
    expect(ids(tree.childrenOf('Home'))).toEqual(['Kitchen', 'Storage'])
    expect(ids(tree.childrenOf('Kitchen'))).toEqual(['Bottles', 'Cutlery'])
    expect(tree.childrenOf('Bottles')).toEqual([])
  })

  test('ignores capital letters when ordering by name', () => {
    const mixed = buildCategoryTree([
      category('b', null, { name: 'bamboo' }),
      category('a', null, { name: 'Aloe' }),
      category('c', null, { name: 'Coir' }),
    ])
    expect(mixed.childrenOf(null).map((c) => c.name)).toEqual([
      'Aloe',
      'bamboo',
      'Coir',
    ])
  })

  test('finds a category by id and by slug', () => {
    expect(tree.byId('Kitchen')?.name).toBe('Kitchen')
    expect(tree.bySlug('bottles')?.id).toBe('Bottles')
    expect(tree.bySlug('missing')).toBeUndefined()
  })

  test('gives the path from the top for breadcrumbs', () => {
    expect(ids(tree.pathTo('Bottles'))).toEqual(['Home', 'Kitchen', 'Bottles'])
    expect(ids(tree.pathTo('Home'))).toEqual(['Home'])
    expect(tree.pathTo('missing')).toEqual([])
  })

  test('gives a category and everything below it', () => {
    expect(tree.subtreeIds('Home')).toEqual([
      'Home',
      'Kitchen',
      'Storage',
      'Bottles',
      'Cutlery',
    ])
    expect(tree.subtreeIds('Bottles')).toEqual(['Bottles'])
    expect(tree.subtreeIds('missing')).toEqual([])
  })

  test('counts the levels below a category', () => {
    expect(tree.levelsBelow('Home')).toBe(2)
    expect(tree.levelsBelow('Kitchen')).toBe(1)
    expect(tree.levelsBelow('Storage')).toBe(0)
  })

  test('a category is visible only when it and everything above it is active', () => {
    expect(tree.isVisible('Bottles')).toBe(true)
    expect(tree.isVisible('Care')).toBe(false)
    expect(tree.isVisible('Soaps')).toBe(false)
    expect(tree.isVisible('missing')).toBe(false)
  })

  test('nests the tree, leaving out a refused category and everything below it', () => {
    interface Node {
      id: string
      children: Node[]
    }
    const build = (c: TreeCategory, children: Node[]): Node => ({
      id: c.id,
      children,
    })
    expect(tree.nest(build, (c) => c.isActive)).toEqual([
      {
        id: 'Home',
        children: [
          {
            id: 'Kitchen',
            children: [
              { id: 'Bottles', children: [] },
              { id: 'Cutlery', children: [] },
            ],
          },
          { id: 'Storage', children: [] },
        ],
      },
    ])
    expect(tree.nest(build).map((node) => node.id)).toEqual(['Home', 'Care'])
  })

  test('refuses to walk a loop that only hand-edited data could contain', () => {
    const broken = buildCategoryTree([
      category('A', 'C'),
      category('B', 'A'),
      category('C', 'B'),
    ])
    expect(() => broken.pathTo('A')).toThrow(
      'The category tree above A is broken',
    )
    // Nothing in the loop hangs from the top level, so nesting stops at once.
    expect(broken.nest((c) => c.id)).toEqual([])
  })
})
