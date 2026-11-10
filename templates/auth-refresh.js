/**
 * Recovers a session whose access tokens Drupal revoked.
 *
 * Saving a user revokes that user's access tokens.
 * `simple_oauth_user_update()` calls `TokenExpiryTriggerHandler::handleUserUpdate()`
 * unconditionally, so an editor who edits their own profile comes back to a
 * site that believes it is signed in and is refused every request. Simple
 * Simple OAuth revokes on the save with no opt-out, so the frontend has to
 * recover rather than rely on a backend setting.
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
 * @param {object} session - `{ loggedIn, hasRefreshToken, tokenUrl }`.
 * @returns {boolean}
 */
/**
 * Whether a failed request was bound for the backend the token belongs to.
 *
 * The interceptor sits on axios instances a site may also use for other
 * hosts. Recovering a request to another origin would replay it with the
 * Drupal access token on its `Authorization` header, disclosing the token to
 * that host. A relative URL resolves against the instance's own backend base,
 * so it is safe; an absolute URL is only safe when its origin matches that
 * base.
 *
 * @param {object} config - The failed request's axios config.
 * @param {object} instance - The axios instance that made it.
 * @returns {boolean}
 */
export const targetsBackend = (config, instance) => {
  const url = (config || {}).url || ''
  const isAbsolute = (u) => /^[a-z][a-z0-9+.-]*:\/\//i.test(u)
  const sameOrigin = (a, b) => {
    try {
      return new URL(a).origin === new URL(b).origin
    } catch (error) {
      return false
    }
  }
  // The origin the token is safe on: the instance's configured backend, never
  // a per-request baseURL, which the caller could point elsewhere.
  const backend = ((instance || {}).defaults || {}).baseURL || ''

  // A protocol-relative `//host/...` names another origin while looking
  // path-like, so it is treated as absolute, not relative.
  if (/^\/\//.test(url)) return false

  if (isAbsolute(url)) {
    return isAbsolute(backend) && sameOrigin(url, backend)
  }

  // A relative URL goes to the request's baseURL when it sets one, else the
  // instance's. Either must be the backend for the token to travel with it.
  const base = (config || {}).baseURL
  if (base) {
    return isAbsolute(base) ? sameOrigin(base, backend) : base === backend
  }
  return true
}

export const shouldRefresh = (error, session = {}) => {
  const { response, config } = error || {}

  // A 403 is Drupal saying no, and asking again only hears it again.
  if (!response || response.status !== 401) return false

  // No config is a failure that cannot be replayed, and a replay that fails
  // again is a real sign-out.
  if (!config || config[RETRIED]) return false

  // The refresh itself runs on this instance, so it reaches this handler.
  // Refreshing for it would await the promise it is already inside, and the
  // site would hang rather than sign out.
  if (session.tokenUrl && config.url === session.tokenUrl) return false

  // `loggedIn` is the wrong signal on the server: auth-next sets it only
  // after `fetchUser` succeeds, and `fetchUser` is the request that 401s, so
  // on a page load it is false for the very request whose recovery would set
  // it. The refresh token is the credential that matters. On the client the
  // flag still gates, so a stale refresh cookie does not refresh on every 401.
  return Boolean((session.loggedIn || session.server) && session.hasRefreshToken)
}

/**
 * Whether a refused request should be repeated anonymously, without its token.
 *
 * Drupal answers 401 to any request carrying a token it no longer accepts, even
 * for public content. With no way to recover the token, every page then fails
 * until the visitor clears their cookies, the login page included. A read is
 * safe to repeat. A write is not: it was meant to be made as that user.
 *
 * @param {object} error - The axios error.
 * @param {object} session - What the session holds.
 * @returns {boolean}
 */
export const shouldDropToken = (error, session = {}) => {
  const { response, config } = error || {}
  if (!response || response.status !== 401) return false
  if (!config || config[RETRIED]) return false
  if (!['get', 'head'].includes(String(config.method || 'get').toLowerCase())) return false
  if (session.tokenUrl && config.url === session.tokenUrl) return false
  return Boolean(session.hasToken)
}

/**
 * Whether a failed refresh means the refresh token itself is gone.
 *
 * The token endpoint refuses a refresh token it no longer accepts with a 400 or
 * a 401, and auth-next rejects without asking when the refresh token has
 * expired. A timeout, a 5xx or the refresh limit says nothing about the token,
 * so the session is kept for those.
 *
 * @param {Error} failed - What the refresh rejected with.
 * @returns {boolean}
 */
export const refreshRefused = (failed) => {
  if ((failed || {}).name === 'ExpiredAuthSessionError') return true
  const status = ((failed || {}).response || {}).status
  return status === 400 || status === 401
}

/**
 * The headers a request had, without its `Authorization` header in any case.
 *
 * @param {object} headers - The request's headers.
 * @returns {object}
 */
const withoutAuthorization = (headers = {}) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization')
  )

/**
 * The `Authorization` header a request went out with, in any case.
 *
 * @param {object} config - The request's axios config.
 * @returns {string|undefined}
 */
const sentToken = (config) => {
  const headers = (config || {}).headers || {}
  const name = Object.keys(headers).find((key) => key.toLowerCase() === 'authorization')
  return name ? headers[name] : undefined
}

/**
 * Refreshes shared between server renders, by the session that spends them.
 *
 * Nuxt runs this plugin once per server render, so state inside it is one
 * render's. Several renders for one browser, as several tabs send, all hold
 * the same refresh token, and Simple OAuth rotates it on first use: the first
 * render's refresh succeeds and every other render's is refused. Kept here, a
 * refresh lives as long as the server process, and every render of the same
 * session takes its result, while it runs and for GRACE after it ends.
 */
const shared = new Map()

/**
 * Starts the refresh for a refresh token, or joins the one already running or
 * just finished for it.
 *
 * @param {string} key - The session spending the refresh.
 * @param {Function} start - Starts a refresh, resolving with the token response.
 * @returns {{ promise: Promise, own: boolean }} The refresh, and whether this
 *   caller started it.
 */
export const shareRefresh = (key, start) => {
  const now = Date.now()
  for (const [name, entry] of shared) {
    if (entry.settledAt && now - entry.settledAt > GRACE) shared.delete(name)
  }
  const found = shared.get(key)
  if (found) return { promise: found.promise, own: false }

  const entry = { settledAt: 0 }
  const settle = () => {
    entry.settledAt = Date.now()
  }
  entry.promise = start().then(
    (response) => {
      settle()
      return response
    },
    (error) => {
      settle()
      throw error
    }
  )
  shared.set(key, entry)
  return { promise: entry.promise, own: true }
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

  // This render's refresh, joined with any other render's for the same
  // refresh token. A render that joins takes the token response the other
  // render got, and stores it as its own, so its answer sets the new tokens on
  // the browser too.
  const refreshShared = () => {
    const $auth = auth()
    const strategy = ($auth || {}).strategy || {}
    const refreshToken = ((strategy.refreshToken || {}).get || (() => null))()
    const token = ((strategy.token || {}).get || (() => null))()
    // Only a real refresh token is shared. A scheme that needs none, such as
    // auth-next's LaravelJWT, stores `true` for every user, and sharing on
    // that would hand one user's tokens to another.
    if (
      typeof refreshToken !== 'string' ||
      refreshToken === 'true' ||
      typeof strategy.updateTokens !== 'function'
    ) {
      return $auth.refreshTokens()
    }
    // Renders of one browser send the same cookies, so they hold the same
    // strategy, refresh token and access token. Keying on all three keeps
    // anything else apart.
    const key = JSON.stringify([strategy.name, refreshToken, token])
    const { promise, own } = shareRefresh(key, () => $auth.refreshTokens())
    if (own) return promise
    return promise.then((response) => {
      // The response belongs to the session that held this refresh token. A
      // sign-in that stored another while this render waited is newer, so it
      // is kept.
      if (response && strategy.refreshToken.get() === refreshToken) {
        strategy.updateTokens(response)
      }
      return response
    })
  }

  const refresh = () => {
    // Just refreshed, so the token in hand is the one a refresh would fetch.
    // Retry with it rather than rotating the tokens out from under whoever
    // took the last one.
    if (!refreshing && refreshedAt && Date.now() - refreshedAt < GRACE) {
      return Promise.resolve()
    }
    if (!refreshing) {
      if (!allowed()) return Promise.reject(new Error('refresh limit'))
      refreshing = refreshShared()
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

  // The token the session holds now, with its type prefix, as a request sends it.
  const currentToken = () => {
    const token = (((auth() || {}).strategy || {}).token || {}).get
    return token ? auth().strategy.token.get() : undefined
  }

  const session = () => {
    const $auth = auth()
    const strategy = ($auth || {}).strategy
    const refreshToken = (strategy || {}).refreshToken
    const endpoints = ((strategy || {}).options || {}).endpoints || {}
    const token = endpoints.refresh || endpoints.token
    return {
      loggedIn: Boolean($auth && $auth.loggedIn),
      server: typeof process !== 'undefined' && Boolean(process.server),
      hasRefreshToken: Boolean(refreshToken && refreshToken.get()),
      hasToken: Boolean(strategy && strategy.token && strategy.token.get && strategy.token.get()),
      tokenUrl: typeof token === 'string' ? token : (token || {}).url,
    }
  }

  const attach = (instance) => {
    if (!instance || !instance.interceptors) return
    instance.interceptors.response.use(undefined, async (error) => {
      // Never replay another host's request, with the Drupal token or without.
      if (!targetsBackend(error.config, instance)) throw error

      // The session this read belongs to, taken before any refresh, so a
      // sign-in that completes while the refresh runs is recognised as another.
      const before = currentToken()

      const dropToken = async () => {
        // Reads refused together share one failed refresh, and the first to get
        // here resets the session. The others were still refused for a token,
        // so what they sent decides, not what the session holds by then.
        const current = session()
        const sent = sentToken(error.config)
        const eligible = { ...current, hasToken: current.hasToken || Boolean(sent) }
        if (!shouldDropToken(error, eligible)) throw error
        // Reset only the session the read was refused for: the token it sent,
        // or the session's token before the refresh when it sent none. A
        // sign-in that stored a new token meanwhile is another session.
        if (current.hasToken && (sent || before) === currentToken()) {
          await auth().reset()
        }
        const headers = withoutAuthorization(error.config.headers)
        const replay = { ...error.config, headers, [RETRIED]: true }
        // auth-next's request interceptor and axios' default headers apply
        // after this, and either can put a token back. The adapter is handed
        // the final headers, so the token comes off there.
        const adapter = error.config.adapter || ((instance || {}).defaults || {}).adapter
        if (typeof adapter === 'function') {
          replay.adapter = (config) =>
            adapter({ ...config, headers: withoutAuthorization(config.headers) })
        }
        try {
          return await instance.request(replay)
        } catch (failed) {
          throw error
        }
      }

      if (!shouldRefresh(error, session())) return dropToken()

      try {
        await refresh()
      } catch (failed) {
        // A refresh that failed for another reason, such as a timeout, leaves
        // the session alone, and the caller sees the original answer.
        if (!refreshRefused(failed)) throw error
        // The refresh token is gone too. That is the real sign-out. The visitor
        // can still read what's public, and sign in again.
        return dropToken()
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

  const setup = () => {
    const { $axios, $druxt } = context
    const druxtAxios = ($druxt || {}).axios
    attach(druxtAxios)
    if ($axios && $axios !== druxtAxios) attach($axios)
  }

  // Attach once every plugin has injected. A site that registers druxt after
  // this plugin would otherwise reach here with `context.$druxt` still
  // undefined, and `attach(undefined)` is a silent no-op, so druxt's axios
  // would never be intercepted. `onNuxtReady` is the client signal that all
  // plugins have mounted, and requests come after it. Without it, in a test
  // or SSR, attach at once.
  if (typeof window !== 'undefined' && window.onNuxtReady) {
    window.onNuxtReady(setup)
  } else {
    setup()
  }
}
