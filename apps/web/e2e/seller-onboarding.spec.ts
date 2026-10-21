import sharp from 'sharp'
import { randomInt } from 'node:crypto'
import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { z } from 'zod'
import { testPdf } from '@ecokart/core/testing'
import { signIn } from './support/auth.ts'
import {
  test,
  expect,
  fixturesFor,
  expectProtectedRedirect,
} from './support/test.ts'

const applicationResponse = z.object({
  application: z.object({ id: z.string(), status: z.string() }),
})
const documentResponse = z.object({
  document: z.object({
    status: z.string(),
    files: z.array(z.object({ id: z.string(), status: z.string() })),
  }),
})

// Separate people must not consume one shared localhost authentication limit.
const accountHeaders = () => ({
  'x-forwarded-for': `198.19.${randomInt(256)}.${randomInt(1, 255)}`,
})

async function checkReviewPage(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Review seller document', level: 1 }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      (violation) => violation.id,
    ),
  ).toEqual([])
}

test('S02 S06 S07 application rejection, correction, resubmission and cancelled request', async ({
  page,
  context,
  checkPage,
}, info) => {
  await signIn(page)
  const created = await page.request.post('/api/account/seller-application', {
    data: {
      displayName: 'Test correction business',
      legalName: 'Test Business Limited',
      gstin: '27AAACE1234F1Z5',
      pan: 'AAACE1234F',
      line1: '1 Test Road',
      city: 'Pune',
      stateCode: '27',
      pincode: '411001',
      supportEmail: 'support@example.test',
      supportPhone: '+919800000000',
    },
  })
  expect(created.status()).toBe(201)
  const { application } = applicationResponse.parse(await created.json())
  const adminContext = await context.browser()!.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: accountHeaders(),
  })
  try {
    const admin = await adminContext.newPage()
    await signIn(admin, fixturesFor(info.project.name).adminEmail)
    await admin.goto(`/admin/sellers/${application.id}`)
    await admin
      .getByLabel('Application rejection reason')
      .fill('Correct your display name.')
    await admin
      .getByRole('button', { name: 'Reject application', exact: true })
      .click()
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Reject application', exact: true })
      .click()
    await expect(admin.getByText(/is now rejected/)).toBeVisible()
    await page.goto('/account/seller-application')
    await expect(
      page.getByText('Reason: Correct your display name.'),
    ).toBeVisible()
    await page
      .getByRole('textbox', { name: 'Display name', exact: true })
      .fill('Corrected test business')
    await page
      .getByRole('button', { name: 'Save application details', exact: true })
      .click()
    await expect(
      page.getByText('Application saved. Your current status is rejected.'),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Resubmit application', exact: true })
      .click()
    await expect(
      page.getByText('Application saved. Your current status is pending.'),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('textbox', { name: 'Display name', exact: true }),
    ).toHaveValue('Corrected test business')
    await checkPage()
    const asked = await admin.request.post(
      `/api/admin/sellers/${application.id}/documents`,
      {
        data: {
          documents: [{ type: 'other', note: 'Test request to cancel' }],
        },
      },
    )
    expect(asked.status()).toBe(201)
    const { documents } = z
      .object({ documents: z.array(z.object({ id: z.string() })) })
      .parse(await asked.json())
    const id = documents[0]!.id
    expect(
      (
        await admin.request.post(`/api/admin/sellers/${application.id}/approve`)
      ).status(),
    ).toBe(409)
    await admin.goto(`/admin/seller-documents/${id}`)
    await checkReviewPage(admin)
    await admin
      .getByLabel('Decision reason')
      .fill('No longer needed for this test business.')
    await admin
      .getByRole('button', { name: 'Cancel request', exact: true })
      .click()
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel request', exact: true })
      .click()
    await expect(admin.getByText('Document decision saved.')).toBeVisible()
    expect(
      (
        await admin.request.post(`/api/admin/sellers/${application.id}/approve`)
      ).status(),
    ).toBe(200)
  } finally {
    await adminContext.close()
  }
})

test('I01 @smoke onboarding pages protect signed-out visitors', async ({
  page,
}) => {
  for (const path of [
    '/account/seller-application',
    '/seller/documents',
    '/admin/seller-documents',
  ])
    await expectProtectedRedirect(page, path)
})

test('S01 S02 S03 S04 S05 S06 S07 S08 I02 I03 I04 @smoke applicant documents, decisions and combined account', async ({
  page,
  context,
  checkPage,
}, info) => {
  test.setTimeout(240_000)
  await signIn(page)
  await page.goto('/account/seller-application')
  await expect(
    page.getByRole('heading', { name: 'Business application' }),
  ).toBeVisible()
  await checkPage()
  const fields = {
    'Display name': `Browser applicant ${info.project.name}`,
    'Legal name': 'Browser Test Business Limited',
    GSTIN: '27AAACE1234F1Z5',
    PAN: 'AAACE1234F',
    'Address line': '1 Test Road',
    City: 'Pune',
    'GST state code': '27',
    'PIN code': '411001',
    'Support email': 'support@example.test',
    'Support phone': '+919800000000',
  }
  for (const [label, value] of Object.entries(fields))
    await page.getByRole('textbox', { name: label, exact: true }).fill(value)
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/account/seller-application') &&
      response.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Submit application', exact: true })
    .click()
  const response = await submitted
  expect(response.status()).toBe(201)
  const { application } = applicationResponse.parse(await response.json())
  const buyerMe = await (await page.request.get('/api/me')).json()
  expect(buyerMe).toMatchObject({
    role: 'buyer',
    roles: ['buyer'],
    sellerId: null,
  })
  expect((await page.request.get('/api/seller/products')).status()).toBe(403)
  expect(
    (
      await page.request.post('/api/account/seller-application', {
        data: {
          displayName: fields['Display name'],
          legalName: fields['Legal name'],
          gstin: fields.GSTIN,
          pan: fields.PAN,
          line1: fields['Address line'],
          city: fields.City,
          stateCode: fields['GST state code'],
          pincode: fields['PIN code'],
          supportEmail: fields['Support email'],
          supportPhone: fields['Support phone'],
        },
      })
    ).status(),
  ).toBe(409)
  await page.reload()
  await expect(
    page.getByRole('textbox', { name: 'Display name', exact: true }),
  ).toHaveValue(fields['Display name'])
  await expect(page.getByText('Pending', { exact: true })).toBeVisible()

  const adminContext = await context.browser()!.newContext({
    baseURL: process.env.E2E_BASE_URL,
    extraHTTPHeaders: accountHeaders(),
  })
  const admin = await adminContext.newPage()
  try {
    await signIn(admin, fixturesFor(info.project.name).adminEmail)
    await admin.goto(`/admin/sellers/${application.id}`)
    await admin
      .getByLabel('Document request note')
      .fill('Please send a clear test certificate.')
    await admin
      .getByRole('button', { name: 'Request document', exact: true })
      .click()
    await expect(
      admin.getByRole('link', { name: 'Review request' }),
    ).toBeVisible()
    const link = await admin
      .getByRole('link', { name: 'Review request' })
      .getAttribute('href')
    expect(link).toBeTruthy()
    const requestId = link!.split('/').at(-1)!
    expect(
      (
        await admin.request.post(`/api/admin/sellers/${application.id}/approve`)
      ).status(),
    ).toBe(409)
    expect(
      (
        await page.request.post(
          `/api/admin/seller-documents/${requestId}/accept`,
        )
      ).status(),
    ).toBe(403)
    await page.getByRole('button', { name: 'Refresh documents' }).click()
    const upload = page.getByLabel('Upload Gst certificate', { exact: true })
    await expect(upload).toBeVisible()
    await upload.setInputFiles({
      name: 'empty.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(0),
    })
    await expect(
      page.getByText(
        'Choose a non-empty file of at most 10 MB (10,485,760 bytes).',
      ),
    ).toBeVisible()
    expect(
      (
        await page.request.post(`/api/seller/documents/${requestId}/uploads`, {
          data: { contentType: 'application/pdf', size: 10_485_761 },
        })
      ).status(),
    ).toBe(400)
    await upload.setInputFiles({
      name: 'test-certificate.pdf',
      mimeType: 'application/pdf',
      buffer: testPdf(),
    })
    await expect
      .poll(
        async () =>
          documentResponse.parse(
            await (
              await page.request.get(`/api/seller/documents/${requestId}`, {
                maxRetries: 2,
              })
            ).json(),
          ).document.status,
        { timeout: 60_000 },
      )
      .toBe('received')
    await expect(
      page.getByText('File 1: Received', { exact: true }),
    ).toBeVisible()
    await checkPage()
    await admin.goto(link!)
    await checkReviewPage(admin)
    await admin.screenshot({
      path: info.outputPath('document-review.png'),
      fullPage: true,
    })
    await admin
      .getByLabel('Decision reason')
      .fill('Please send a clearer test copy.')
    await admin
      .getByRole('button', { name: 'Reject file', exact: true })
      .click()
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Reject file', exact: true })
      .click()
    await expect(admin.getByText('Document decision saved.')).toBeVisible()
    await page.getByRole('button', { name: 'Refresh documents' }).click()
    await expect(
      page.getByText('Please send a clearer test copy.'),
    ).toBeVisible()
    const png = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#eee' },
    })
      .png()
      .toBuffer()
    await upload.setInputFiles({
      name: 'replacement.png',
      mimeType: 'image/png',
      buffer: png,
    })
    await expect
      .poll(
        async () =>
          documentResponse.parse(
            await (
              await page.request.get(`/api/seller/documents/${requestId}`, {
                maxRetries: 2,
              })
            ).json(),
          ).document.status,
        { timeout: 60_000 },
      )
      .toBe('received')
    await admin.reload()
    const checked = documentResponse.parse(
      await (
        await admin.request.get(`/api/admin/seller-documents/${requestId}`)
      ).json(),
    ).document
    const fileId = checked.files[0]!.id
    const downloaded = await admin.request.get(
      `/api/admin/seller-documents/${requestId}/files/${fileId}`,
    )
    expect(downloaded.status()).toBe(200)
    expect(downloaded.headers()['content-type']).toContain('image/')
    await admin
      .getByRole('button', { name: 'Accept document', exact: true })
      .click()
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Accept document', exact: true })
      .click()
    await expect(admin.getByText('Document decision saved.')).toBeVisible()
    await admin.goto(`/admin/sellers/${application.id}`)
    await admin
      .getByRole('button', { name: 'Approve seller', exact: true })
      .click()
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Approve seller', exact: true })
      .click()
    await expect(admin.getByText(/is now approved/)).toBeVisible()
    await page
      .getByRole('button', { name: 'Refresh application status' })
      .click()
    await expect(
      page.getByRole('link', { name: 'Open seller portal' }),
    ).toBeVisible()
    await expect(
      page.getByText('File 2: Accepted', { exact: true }),
    ).toBeVisible()
    await page.screenshot({
      path: info.outputPath('seller-application-approved.png'),
      fullPage: true,
    })
    expect(await (await page.request.get('/api/me')).json()).toMatchObject({
      role: 'buyer',
      roles: ['buyer', 'seller'],
      sellerId: null,
    })
    await page.getByRole('link', { name: 'Open seller portal' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect((await page.request.get('/api/seller/products')).status()).toBe(200)
    await page.goto('/')
    const sellerPortal = page.getByRole('link', {
      name: /^Seller(?: portal)?$/,
    })
    await expect(sellerPortal).toBeVisible()
    await expect(sellerPortal).toHaveAttribute('href', '/seller')
    await admin.getByLabel('Suspension reason').fill('Test business review')
    await admin
      .getByRole('button', { name: 'Suspend seller', exact: true })
      .click()
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Suspend seller', exact: true })
      .click()
    await expect(admin.getByText(/is now suspended/)).toBeVisible()
    expect((await page.request.get('/api/seller/products')).status()).toBe(403)
    expect((await page.request.get('/api/cart')).status()).toBe(200)
    await page.goto('/account/seller-application')
    await expect(page.getByText('Suspended', { exact: true })).toBeVisible()
    await checkPage()

    const other = await context.browser()!.newContext({
      baseURL: process.env.E2E_BASE_URL,
      extraHTTPHeaders: accountHeaders(),
    })
    try {
      const otherPage = await other.newPage()
      await signIn(otherPage, fixturesFor(info.project.name).sellerEmail)
      expect(
        (
          await otherPage.request.get(`/api/seller/documents/${requestId}`)
        ).status(),
      ).toBe(404)
      expect(
        (
          await otherPage.request.get(
            `/api/admin/seller-documents/${requestId}/files/${fileId}`,
            { maxRedirects: 0 },
          )
        ).status(),
      ).toBe(403)
    } finally {
      await other.close()
    }
  } finally {
    await adminContext.close()
  }
})
