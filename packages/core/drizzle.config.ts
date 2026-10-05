import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` compares the schema with the last migration snapshot and
// writes a new SQL migration. It never connects to a database; migrations
// are applied by `pnpm db:migrate` (src/db/migrate.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
})
