export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-14 text-brand"
        fill="currentColor"
      >
        <path d="M20 4c-9 0-15 4.5-15 11.5 0 1.6.4 3 1 4.2C8 14 12 10.5 16 8.5c-3.5 2.5-6.6 6-8.4 11.2 1.1.5 2.3.8 3.6.8C18 20.5 20 13 20 4z" />
      </svg>
      <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
        EcoKart
      </h1>
      <p className="mt-4 max-w-md text-lg text-balance text-muted">
        A multi-vendor marketplace for India, coming soon.
      </p>
    </main>
  )
}
