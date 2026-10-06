import { sql, type SQL } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'

/**
 * Rebuilds the summary fields of the products matching `which` (a condition
 * on the `products` table), so listing and search pages read one table
 * (design doc 5.1, CLAUDE.md):
 *
 * - lowest and highest price, lowest MRP, and total stock of the active variants
 * - the main photo: the first ready one in the seller's order
 * - the search text: title, brand, category names from the top, and highlights
 *
 * Call it in the transaction of every change that affects them. The rows are
 * locked in id order first, so two rebuilds of overlapping products wait for
 * each other instead of deadlocking.
 */
export async function refreshProducts(
  tx: Transaction,
  which: SQL,
): Promise<void> {
  await tx.execute(sql`
    update products p set
      (min_price_paise, max_price_paise, min_mrp_paise, total_stock) = (
        select min(v.price_paise), max(v.price_paise), min(v.mrp_paise),
               coalesce(sum(v.stock), 0)
        from product_variants v
        where v.product_id = p.id and v.is_active
      ),
      primary_image_id = (
        select i.id from product_images i
        where i.product_id = p.id and i.status = 'ready'
        order by i.sort_order, i.created_at, i.id
        limit 1
      ),
      search_text = concat_ws(' ',
        p.title,
        (select b.name from brands b where b.id = p.brand_id),
        (select concat_ws(' ', c2.name, c1.name, c0.name)
         from categories c0
         left join categories c1 on c1.id = c0.parent_id
         left join categories c2 on c2.id = c1.parent_id
         where c0.id = p.category_id),
        (select string_agg(h.value, ' ')
         from jsonb_array_elements_text(p.highlights) as h(value))
      )
    where p.id in (
      select id from products where ${which} order by id for update
    )
  `)
}
