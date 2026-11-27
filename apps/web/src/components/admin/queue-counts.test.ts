import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { QueueCounts } from './queue-counts'
import { getJobQueue } from '@/lib/queue'
import { requireAdminPageContext } from '@/lib/page-auth'

vi.mock('@/lib/queue', () => ({ getJobQueue: vi.fn<typeof getJobQueue>() }))
vi.mock('@/lib/page-auth', () => ({
  requireAdminPageContext: vi.fn<typeof requireAdminPageContext>(),
}))

test('queue startup failure leaves a safe, separate unavailable panel', async () => {
  vi.mocked(requireAdminPageContext).mockResolvedValueOnce({
    role: 'admin',
    userId: 'admin',
  })
  vi.mocked(getJobQueue).mockRejectedValueOnce(
    new Error('PRIVATE_CONNECTION_STRING'),
  )
  const html = renderToStaticMarkup(await QueueCounts())
  expect(html).toContain('Queue counts unavailable')
  expect(html).toContain('lists below are loaded separately')
  expect(html).not.toContain('PRIVATE_CONNECTION_STRING')
})
test('queue availability handling does not swallow access checks', async () => {
  vi.mocked(requireAdminPageContext).mockRejectedValueOnce(
    new Error('Access refused'),
  )
  await expect(QueueCounts()).rejects.toThrow('Access refused')
})
