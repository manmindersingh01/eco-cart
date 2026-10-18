import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Transaction } from '../../db/client.ts'
import { products, productVariants } from '../../db/schema/index.ts'
import { getSellerLabels } from '../sellers/service.ts'
import { refreshProducts } from './summary.ts'

/*
 * What the cart and checkout need from the catalogue (backend spec steps 11
 * and 12): each variant as a buyer can buy it, read fresh every time, so a
 * cart never shows a stale price or stock.
 */

/** A variant as the cart shows it and checkout copies it onto an order. */
export interface PurchasableVariant {
  variantId: string
  productId: string
  sellerId: string
  sellerName: string
  title: string
  productSlug: string
  sku: string
  /** For example { Size: 'M' }. */
  options: Record<string, string>
  pricePaise: number
  mrpPaise: number
  stock: number
  /** The fewest a buyer may order in one line. */
  minOrderQuantity: number
  /** Set at approval, so present whenever `forSale` is true. */
  gstRateBps: number | null
  hsnCode: string | null
  /** The photo's storage key (images/{id}); its sizes are public. */
  imageKey: string | null
  /**
   * The product is approved and not deleted, the variant is active, and the
   * seller is approved. Checked here rather than left to row-level security,
   * because checkout reads as `system`, which sees every row.
   */
  forSale: boolean
}

/**
 * The variants in `variantIds` that the caller can see, by id. A variant
 * missing from the answer does not exist or is hidden from the caller, and
 * the cart treats it like one that is no longer for sale.
 */
export async function readPurchasableVariants(
  tx: Transaction,
  variantIds: string[],
): Promise<Map<string, PurchasableVariant>> {
  if (variantIds.length === 0) return new Map()
  const rows = await tx
    .select({
      variantId: productVariants.id,
      productId: products.id,
      sellerId: products.sellerId,
      title: products.title,
      productSlug: products.slug,
      sku: productVariants.sku,
      options: productVariants.options,
      pricePaise: productVariants.pricePaise,
      mrpPaise: productVariants.mrpPaise,
      stock: productVariants.stock,
      minOrderQuantity: products.minOrderQuantity,
      variantActive: productVariants.isActive,
      status: products.status,
      deletedAt: products.deletedAt,
      gstRateBps: products.gstRateBps,
      hsnCode: products.hsnCode,
      // The variant's own photo (the green one), else the product's main one.
      imageKey: sql<string | null>`coalesce(
        (select i.storage_key from product_images i
         where i.variant_id = ${productVariants.id} and i.status = 'ready'
         order by i.sort_order, i.created_at, i.id limit 1),
        (select i.storage_key from product_images i
         where i.id = ${products.primaryImageId} and i.status = 'ready'))`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, [...new Set(variantIds)]))

  const sellers = await getSellerLabels(
    tx,
    rows.map((row) => row.sellerId),
  )
  return new Map(
    rows.map((row) => {
      const seller = sellers.get(row.sellerId)
      const variant: PurchasableVariant = {
        variantId: row.variantId,
        productId: row.productId,
        sellerId: row.sellerId,
        sellerName: seller?.displayName ?? '',
        title: row.title,
        productSlug: row.productSlug,
        sku: row.sku,
        options: row.options,
        pricePaise: row.pricePaise,
        mrpPaise: row.mrpPaise,
        stock: row.stock,
        minOrderQuantity: row.minOrderQuantity,
        gstRateBps: row.gstRateBps,
        hsnCode: row.hsnCode,
        imageKey: row.imageKey,
        forSale:
          row.status === 'approved' &&
          row.deletedAt === null &&
          row.variantActive &&
          seller?.status === 'approved' &&
          row.gstRateBps !== null &&
          row.hsnCode !== null,
      }
      return [row.variantId, variant]
    }),
  )
}

/** One line of stock to take or give back. */
export interface StockLine {
  productId: string
  variantId: string
  quantity: number
}

/**
 * Locks the products of `variantIds` in id order, then the variants in id
 * order, the same order every change to a product takes (backend spec step
 * 6), so checkout never deadlocks with a seller's edit or another checkout.
 * Read the variants after this, so the prices and stock are the ones that
 * will be sold.
 */
export async function lockStock(
  tx: Transaction,
  variantIds: string[],
): Promise<void> {
  if (variantIds.length === 0) return
  const ids = [...new Set(variantIds)]
  const owners = await tx
    .selectDistinct({ productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, ids))
  const productIds = owners.map((row) => row.productId)
  if (productIds.length > 0) {
    await tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, productIds))
      .orderBy(asc(products.id))
      .for('update')
  }
  await tx
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(inArray(productVariants.id, ids))
    .orderBy(asc(productVariants.id))
    .for('update')
}

/**
 * Takes `lines` out of stock, each with one conditional statement, so a
 * variant can never go below zero even if a caller forgot to lock it
 * (design doc 6.3). Returns the variant ids that did not have enough stock;
 * the caller rolls back when any did. Rebuilds the products' summary fields.
 */
export async function takeStock(
  tx: Transaction,
  lines: StockLine[],
): Promise<string[]> {
  const short: string[] = []
  for (const line of lines.toSorted((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    const taken = await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} - ${line.quantity}` })
      .where(
        sql`${productVariants.id} = ${line.variantId} and ${productVariants.stock} >= ${line.quantity}`,
      )
      .returning({ id: productVariants.id })
    if (taken.length === 0) short.push(line.variantId)
  }
  await refreshLines(tx, lines)
  return short
}

/**
 * Puts `lines` back in stock, for an order that was cancelled or never paid.
 * Call `lockStock` first.
 */
export async function giveBackStock(
  tx: Transaction,
  lines: StockLine[],
): Promise<void> {
  for (const line of lines.toSorted((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    await tx
      .update(productVariants)
      .set({ stock: sql`${productVariants.stock} + ${line.quantity}` })
      .where(eq(productVariants.id, line.variantId))
  }
  await refreshLines(tx, lines)
}

async function refreshLines(tx: Transaction, lines: StockLine[]) {
  const productIds = [...new Set(lines.map((line) => line.productId))]
  if (productIds.length > 0) {
    await refreshProducts(tx, inArray(products.id, productIds))
  }
}
