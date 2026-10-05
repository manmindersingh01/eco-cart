import type { Auth } from './auth.ts'

/** A sign-in account, as other modules need to see it. */
export interface Account {
  id: string
  email: string
  name: string
  phoneNumber: string | null
  role: string | null
  banned: boolean
  banReason: string | null
}

/**
 * The account operations other modules may use. They go through Better
 * Auth's internal adapter, the same calls its own createUser and banUser
 * endpoints make, so the users and sessions tables are only ever changed by
 * Better Auth (CLAUDE.md), without needing an HTTP request.
 */
export interface AccountDirectory {
  findByEmail(email: string): Promise<Account | null>
  findById(id: string): Promise<Account | null>
  /**
   * A new account with the role `seller`. Its email is marked verified for
   * the reason given in ensureAdministrator (backend spec step 2); the first
   * sign-in still needs a code sent to that mailbox.
   */
  createSellerOwner(owner: {
    email: string
    name: string
    phoneNumber: string | null
  }): Promise<Account>
  /** Only for undoing an account whose business could not be saved. */
  remove(id: string): Promise<void>
  /** Blocks sign-in and ends every session, like Better Auth's banUser. */
  ban(id: string, reason: string): Promise<void>
  unban(id: string): Promise<void>
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)

function toAccount(
  user: { id: string; email: string; name: string } & Record<string, unknown>,
): Account {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phoneNumber: text(user.phoneNumber),
    role: text(user.role),
    banned: user.banned === true,
    banReason: text(user.banReason),
  }
}

export function createAccountDirectory(auth: Auth): AccountDirectory {
  const adapter = async () => (await auth.$context).internalAdapter
  return {
    async findByEmail(email) {
      const found = await (
        await adapter()
      ).findUserByEmail(email.trim().toLowerCase())
      return found ? toAccount(found.user) : null
    },
    async findById(id) {
      const user = await (await adapter()).findUserById(id)
      return user ? toAccount(user) : null
    },
    async createSellerOwner({ email, name, phoneNumber }) {
      const user = await (
        await adapter()
      ).createUser(
        {
          email: email.trim().toLowerCase(),
          name,
          role: 'seller',
          emailVerified: true,
          ...(phoneNumber ? { phoneNumber, phoneNumberVerified: false } : {}),
        },
        // The same source Better Auth's own admin createUser endpoint uses.
        { method: 'admin' },
      )
      return toAccount(user)
    },
    async remove(id) {
      await (await adapter()).deleteUser(id)
    },
    async ban(id, reason) {
      const internal = await adapter()
      await internal.updateUser(id, {
        banned: true,
        banReason: reason,
        banExpires: null,
      })
      await internal.deleteUserSessions(id)
    },
    async unban(id) {
      await (
        await adapter()
      ).updateUser(id, {
        banned: false,
        banReason: null,
        banExpires: null,
      })
    },
  }
}
