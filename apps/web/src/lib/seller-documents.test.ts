import { expect, test } from 'vitest'
import { documentUploadError } from './seller-documents'

test.each([10_485_759, 10_485_760])(
  'B01 client allows inclusive policy size %i',
  (size) => {
    expect(documentUploadError({ size, type: 'application/pdf' })).toBeNull()
  },
)
test.each([0, 10_485_761])('B01 client refuses invalid size %i', (size) => {
  expect(documentUploadError({ size, type: 'image/png' })).toContain('10 MB')
})
test('B02 client rejects unsupported content type', () => {
  expect(documentUploadError({ size: 100, type: 'text/plain' })).toContain(
    'PDF, JPEG or PNG',
  )
})
