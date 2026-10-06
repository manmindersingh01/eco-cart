import { parseArgs } from 'node:util'
import {
  ConflictError,
  createAppAuth,
  createDatabase,
  createPool,
  ensureAdministrator,
  loadAuthConfig,
  requireEnv,
} from '@ecokart/core'

/*
 * Creates the first administrator, or promotes an existing account:
 *   pnpm admin:create --email meera@ecokart.in --name "Meera Iyer"
 * The person then signs in with a code sent to that email.
 */

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string', default: '' },
  },
})
if (!values.email) {
  console.error('Usage: pnpm admin:create --email <email> [--name <name>]')
  process.exit(1)
}

const pool = createPool(requireEnv('DATABASE_URL'), 'ecokart-admin-create')
try {
  const db = createDatabase(pool)
  const auth = createAppAuth({
    db,
    getQueue: async () => {
      throw new Error('Creating an administrator sends no messages')
    },
    config: loadAuthConfig(),
  })
  const result = await ensureAdministrator(auth, db, {
    email: values.email,
    name: values.name,
  })
  const messages = {
    created: 'Created the administrator account',
    promoted: 'Made the existing account an administrator',
    unchanged: 'That account is already an administrator',
  }
  console.info(`${messages[result]}: ${values.email}`)
} catch (error) {
  // An expected refusal needs only its reason; anything else is a bug.
  if (error instanceof ConflictError) {
    console.error(`Could not create the administrator: ${error.message}`)
  } else {
    console.error('Could not create the administrator', error)
  }
  process.exitCode = 1
} finally {
  await pool.end()
}
