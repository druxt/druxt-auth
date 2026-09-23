/**
 * Recovers a session whose access tokens Drupal revoked.
 *
 * Saving a user revokes that user's access tokens.
 * `simple_oauth_user_update()` calls `TokenExpiryTriggerHandler::handleUserUpdate()`
 * unconditionally, so an editor who edits their own profile comes back to a
 * site that believes it is signed in and is refused every request. Simple
 * OAuth 6.1.1 has no setting for it, and drupal.org issue 2946882 has no
 * merge request targeting 6.1.x.
 *
 * Only access tokens go. The refresh token survives, so the credential to
 * recover with is already in the browser. The library refreshes a token it
 * believes has expired, and a token deleted on the server never looks
 * expired, so the answer has to be the trigger rather than the clock.
 */

/** Marks a replayed request, so one failure cannot start a loop. */
export const RETRIED = '__druxtAuthRetried'

/**
 * How long a token is taken to be fresh, in milliseconds.
 *
 * Sharing the in-flight promise is necessary and not sufficient. A burst does
 * not fail all at once: the first request is refused and refreshes, and the
 * rest are refused a few hundred milliseconds later, by which time there is
 * no refresh in flight to share. Each refresh rotates the tokens and revokes
 * what the previous one issued, so those later requests would refresh again
 * and invalidate the token the first one just took. The window that matters
 * is since a refresh last succeeded, not while one is running.
 */
export const GRACE = 5000

/**
 * Refreshes allowed inside WINDOW before the site gives up on recovering.
 *
 * A burst costs one refresh, so reaching this means refreshes keep
 * succeeding while requests keep failing, which recovery is not going to fix.
 */
export const LIMIT = 3
export const WINDOW = 30000

/**
 * Whether an answer is worth refreshing for.
 *
 * @param {Error} error - The rejected request.
 * @param {object} session - `{ loggedIn, hasRefreshToken }`.
 * @returns {boolean}
 */
export const shouldRefresh = (error, session = {}) => {
  const { response, config } = error || {}

  // A 403 is Drupal saying no, and asking again only hears it again.
  if (!response || response.status !== 401) return false

  // No config is a failure that cannot be replayed, and a replay that fails
  // again is a real sign-out.
  if (!config || config[RETRIED]) return false

  return Boolean(session.loggedIn && session.hasRefreshToken)
}

export default function (context) {
  // Read `$auth` from the context when it is needed, never from the
  // arguments. The authentication module injects it after this plugin runs,
  // so a plugin that took it as an argument would hold nothing and silently
  // never retry.
  const auth = () => context.$auth || (context.app || {}).$auth

  // One refresh for however many requests fail at once. Each refresh rotates
  // the refresh token, so three requests refreshing separately would leave
  // two of them holding a token that no longer works.
  let refreshing = null
  let refreshedAt = 0
  const refresh = () => {
    // Just refreshed, so the token in hand is the one a refresh would fetch.
    // Retry with it rather than rotating the tokens out from under whoever
    // took the last one.
    if (!refreshing && refreshedAt && Date.now() - refreshedAt < GRACE) {
      return Promise.resolve()
    }
    if (!refreshing) {
      if (!allowed()) return Promise.reject(new Error('refresh limit'))
      refreshing = auth()
        .refreshTokens()
        .then((result) => {
          refreshedAt = Date.now()
          return result
        })
        .finally(() => {
          refreshing = null
        })
    }
    return refreshing
  }

  // A backend revoking continuously would otherwise buy a refresh per
  // request forever.
  let recent = []
  const allowed = () => {
    const now = Date.now()
    recent = recent.filter((at) => now - at < WINDOW)
    if (recent.length >= LIMIT) return false
    recent.push(now)
    return true
  }

  const session = () => {
    const $auth = auth()
    const strategy = ($auth || {}).strategy
    const refreshToken = (strategy || {}).refreshToken
    return {
      loggedIn: Boolean($auth && $auth.loggedIn),
      hasRefreshToken: Boolean(refreshToken && refreshToken.get()),
    }
  }

  const attach = (instance) => {
    if (!instance || !instance.interceptors) return
    instance.interceptors.response.use(undefined, async (error) => {
      if (!shouldRefresh(error, session())) throw error

      try {
        await refresh()
      } catch (failed) {
        // The refresh token is gone too. That is the real sign-out, and the
        // original answer is what the caller should see.
        throw error
      }

      const config = { ...error.config, [RETRIED]: true }
      const strategy = auth().strategy
      // `token.get()` returns the value with its type prefix already on it.
      const token = ((strategy || {}).token || {}).get
        ? strategy.token.get()
        : undefined
      if (token) config.headers = { ...config.headers, Authorization: token }
      return instance.request(config)
    })
  }

  const { $axios, $druxt } = context
  const druxtAxios = ($druxt || {}).axios
  attach(druxtAxios)
  if ($axios && $axios !== druxtAxios) attach($axios)
}
