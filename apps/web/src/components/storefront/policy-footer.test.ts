import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { NotConfiguredError } from '@ecokart/core'
import { CompanyDetails } from './policy-footer'
import { readCompanyDetails } from '@/lib/storefront'

vi.mock('@/lib/storefront', () => ({
  readCompanyDetails: vi.fn<typeof readCompanyDetails>(),
}))

describe('company footer', () => {
  test('missing settings leave a readable fallback', async () => {
    vi.mocked(readCompanyDetails).mockRejectedValueOnce(
      new NotConfiguredError('Company details are missing'),
    )
    expect(renderToStaticMarkup(await CompanyDetails())).toContain(
      'Company details will be available here soon.',
    )
  })
  test('unexpected errors are not disguised as missing settings', async () => {
    vi.mocked(readCompanyDetails).mockRejectedValueOnce(
      new Error('Connection failed'),
    )
    await expect(CompanyDetails()).rejects.toThrow('Connection failed')
  })
})
