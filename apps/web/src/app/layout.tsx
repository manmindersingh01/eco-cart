import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EcoKart',
  description: 'A multi-vendor marketplace for India.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-IN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
