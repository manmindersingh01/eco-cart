import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'EcoKart',
    template: '%s | EcoKart',
  },
  description: 'Shop from independent sellers across India with EcoKart.',
  applicationName: 'EcoKart',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7faf7' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1712' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // data-scroll-behavior: Next.js turns the smooth scrolling in
    // globals.css off during page changes, so a new page starts at the top.
    <html
      lang="en-IN"
      className="h-full antialiased"
      data-scroll-behavior="smooth"
    >
      <body className="flex min-h-full flex-col">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}
