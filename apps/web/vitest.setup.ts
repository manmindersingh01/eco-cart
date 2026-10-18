import { vi } from 'vitest'

vi.mock('next/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/cache')>()
  return {
    ...actual,
    unstable_cache: <Arguments extends unknown[], Result>(
      callback: (...arguments_: Arguments) => Promise<Result>,
    ) => callback,
    revalidateTag: vi.fn<typeof actual.revalidateTag>(),
  }
})
