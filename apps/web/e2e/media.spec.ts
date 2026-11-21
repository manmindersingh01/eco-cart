import sharp from 'sharp'
import { createTestVideo } from '../../../packages/core/src/testing/videos.ts'
import { test, expect, fixturesFor } from './support/test.ts'
import { signIn } from './support/auth.ts'
import {
  createCatalogueProduct,
  ownProduct,
  confirmAction,
} from './support/catalogue.ts'
import { z } from 'zod'

test('C03 C04 photos, cover ordering and failed video replacement', async ({
  page,
  checkPage,
}, info) => {
  test.setTimeout(180000)
  const { sellerEmail, categoryId } = fixturesFor(info.project.name)
  await signIn(page, sellerEmail)
  const product = await createCatalogueProduct(page, categoryId)
  await page.goto(`/seller/products/${product.id}`)
  // Direct file injection bypasses the React-driven file chooser.
  await expect(
    page.getByRole('button', { name: 'Save minimum quantity', exact: true }),
  ).toBeEnabled()
  const buffer = await sharp({
    create: { width: 800, height: 800, channels: 3, background: '#276e55' },
  })
    .png()
    .toBuffer()
  await expect(
    page.locator('input[type="file"][aria-label="Product photos"]'),
  ).toBeEnabled()
  await page
    .locator('input[type="file"][aria-label="Product photos"]')
    .setInputFiles(
      [0, 1, 2, 3].map((index) => ({
        name: `photo-${index}.png`,
        mimeType: 'image/png',
        buffer,
      })),
    )
  await expect
    .poll(
      async () =>
        (await ownProduct(page, product.id)).images.filter(
          (image) => image.status === 'ready',
        ).length,
      { timeout: 60000 },
    )
    .toBe(4)
  await expect(page.getByRole('img', { name: /^Catalogue bowl/ })).toHaveCount(
    4,
  )
  await expect(
    page.getByRole('button', { name: 'Choose photos', exact: true }),
  ).toBeDisabled()
  const before = await ownProduct(page, product.id)
  await page.reload()
  await page
    .getByRole('button', { name: 'Move earlier', exact: true })
    .nth(1)
    .click()
  await expect
    .poll(async () => (await ownProduct(page, product.id)).images[0]?.id)
    .toBe(before.images[1]!.id)
  const listed = z
    .object({
      items: z.array(
        z.object({ id: z.string(), thumbnailUrl: z.string().nullable() }),
      ),
    })
    .parse(await (await page.request.get('/api/seller/products')).json())
  expect(
    listed.items.find((item) => item.id === product.id)?.thumbnailUrl,
  ).toBe(before.images[1]!.urls!.thumb)
  await expect(page.getByText('Cover photo', { exact: true })).toBeVisible()
  const fifth = await page.request.post(
    `/api/seller/products/${product.id}/images/uploads`,
    { data: { contentType: 'image/png', size: buffer.length } },
  )
  expect(fifth.status()).toBe(409)
  await page.getByLabel('Upload product video').setInputFiles({
    name: 'broken.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('not a video'),
  })
  await expect(page.getByText('Video: failed', { exact: true })).toBeVisible({
    timeout: 60000,
  })
  await confirmAction(page, 'Remove video', 'Remove product video?')
  await expect(page.getByLabel('Upload product video')).toBeEnabled()
  const video = await createTestVideo({ width: 640, height: 360, seconds: 1 })
  const registration = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname ===
        `/api/seller/products/${product.id}/video`,
  )
  await page
    .getByLabel('Upload product video')
    .setInputFiles({ name: 'bowl.mp4', mimeType: 'video/mp4', buffer: video })
  const key = z
    .object({ uploadKey: z.string() })
    .parse((await registration).postDataJSON()).uploadKey
  await expect(page.getByText('Video: ready', { exact: true })).toBeVisible({
    timeout: 60000,
  })
  const saved = await ownProduct(page, product.id)
  expect(saved.video?.urls?.video).toContain('/videos/')
  await expect(page.getByLabel('Converted product video')).toHaveAttribute(
    'src',
    saved.video!.urls!.video,
  )
  expect(
    (
      await page.request.post(`/api/seller/products/${product.id}/video`, {
        data: { uploadKey: key },
      })
    ).status(),
  ).toBe(409)
  await page.reload()
  await expect(page.getByText('Video: ready', { exact: true })).toBeVisible()
  await checkPage()
  await page.screenshot({
    path: info.outputPath('photos-and-converted-video.png'),
    fullPage: true,
  })
  await info.attach('media-proof.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      productId: product.id,
      imageIds: saved.images.map((image) => image.id),
      videoId: saved.video?.id,
      videoStatus: saved.video?.status,
    }),
  })
})
