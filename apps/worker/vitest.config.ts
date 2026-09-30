import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      // CI provides its own database; locally this is the compose.yaml one.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgres://ecokart:ecokart@localhost:5434/ecokart',
    },
  },
})
