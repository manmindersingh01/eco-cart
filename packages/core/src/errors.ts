/*
 * Errors that services throw for the expected kinds of failure. The web app
 * turns each into the same HTTP answer everywhere (apps/web/src/lib/api.ts),
 * so a route never has to decide status codes itself.
 */

/** 401: the request needs a signed-in account. */
export class NotSignedInError extends Error {
  override name = 'NotSignedInError'
  constructor(message = 'Not signed in') {
    super(message)
  }
}

/** 403: signed in, but not allowed to do this. */
export class ForbiddenError extends Error {
  override name = 'ForbiddenError'
}

/** 404: the thing asked for does not exist (or is not visible). */
export class NotFoundError extends Error {
  override name = 'NotFoundError'
}

/** 400: the input breaks a rule; `issues` says which, in plain words. */
export class ValidationError extends Error {
  override name = 'ValidationError'
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(message)
    this.issues = issues
  }
}

/**
 * 503: the platform is missing something an administrator must set first,
 * for example the delivery charge before any checkout. The visitor cannot
 * fix it, so it is reported as the service not being available yet.
 */
export class NotConfiguredError extends Error {
  override name = 'NotConfiguredError'
}
