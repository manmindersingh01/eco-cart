import type { Metadata } from 'next'
import { ProductCreateForm } from '@/components/seller/product-create-form'

export const metadata: Metadata = {
  title: 'Create product draft | EcoKart',
}

export default function NewSellerProductPage() {
  return <ProductCreateForm />
}
