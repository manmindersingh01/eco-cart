import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { withContext } from '@ecokart/core'
import { AiUsageReportContent, SearchGapsReportContent } from './ai-reports'
import { getDatabase } from '@/lib/db'
import { requireAdminPageContext } from '@/lib/page-auth'

vi.mock('@ecokart/core', async (original) => ({
  ...(await original<typeof import('@ecokart/core')>()),
  withContext: vi.fn<typeof withContext>(),
}))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn<typeof getDatabase>() }))
vi.mock('@/lib/page-auth', () => ({
  requireAdminPageContext: vi.fn<typeof requireAdminPageContext>(),
}))
const props = () => ({
  params: Promise.resolve({}),
  searchParams: Promise.resolve({}),
})
test('unavailable AI usage reports keep the date controls and hide internal errors', async () => {
  vi.mocked(requireAdminPageContext).mockResolvedValueOnce({
    role: 'admin',
    userId: 'admin',
  })
  vi.mocked(withContext).mockRejectedValueOnce(
    new Error('PRIVATE_DATABASE_DETAIL'),
  )
  const html = renderToStaticMarkup(await AiUsageReportContent(props()))
  expect(html).toContain('AI usage could not be shown')
  expect(html).toContain('Apply dates')
  expect(html).not.toContain('PRIVATE_DATABASE_DETAIL')
})
test('unavailable gap reports have safe recovery text', async () => {
  vi.mocked(requireAdminPageContext).mockResolvedValueOnce({
    role: 'admin',
    userId: 'admin',
  })
  vi.mocked(withContext).mockRejectedValueOnce(
    new Error('PRIVATE_DATABASE_DETAIL'),
  )
  const html = renderToStaticMarkup(await SearchGapsReportContent(props()))
  expect(html).toContain('Search gaps could not be shown')
  expect(html).not.toContain('PRIVATE_DATABASE_DETAIL')
})
test('report error handling does not hide access failures', async () => {
  vi.mocked(requireAdminPageContext).mockRejectedValueOnce(
    new Error('Access refused'),
  )
  await expect(AiUsageReportContent(props())).rejects.toThrow('Access refused')
})
