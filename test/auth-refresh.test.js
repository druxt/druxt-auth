/* global afterEach, describe, expect, jest, test */

import plugin, {
  GRACE,
  LIMIT,
  RETRIED,
  shouldDropToken,
  shouldRefresh,
  targetsBackend,
} from '../templates/auth-refresh.js'

const answer = (status, config = {}) => ({ response: { status }, config })
const signedIn = { loggedIn: true, hasRefreshToken: true }
// What the token endpoint answers a refresh token it no longer accepts.
const refusedRefresh = () => answer(400, { url: 'https://cms/oauth/token' })

describe('Whether an answer is worth refreshing for', () => {
  test('a 401 with a refresh token in hand is', () => {
    expect(shouldRefresh(answer(401), signedIn)).toBe(true)
  })

  test('a 403 is not, because Drupal is saying no', () => {
    expect(shouldRefresh(answer(403), signedIn)).toBe(false)
  })

  test('a replay that failed again is not, because that is a sign out', () => {
    expect(shouldRefresh(answer(401, { [RETRIED]: true }), signedIn)).toBe(
      false
    )
  })

  test('nothing to refresh with is not', () => {
    expect(
      shouldRefresh(answer(401), { loggedIn: true, hasRefreshToken: false })
    ).toBe(false)
    expect(
      shouldRefresh(answer(401), { loggedIn: false, hasRefreshToken: true })
    ).toBe(false)
  })

  test('a failure on the refresh request itself is not', () => {
    // The refresh runs on the same instance, so it reaches this handler.
    // Refreshing for it would await the promise it is already inside.
    const session = { ...signedIn, tokenUrl: 'https://cms/oauth/token' }
    expect(
      shouldRefresh(answer(401, { url: 'https://cms/oauth/token' }), session)
    ).toBe(false)
    expect(shouldRefresh(answer(401, { url: '/jsonapi' }), session)).toBe(true)
  })

  test('a server render refreshes despite loggedIn being false there', () => {
    // auth-next has not run fetchUser yet, so loggedIn is false during the
    // render; the refresh token is what says recovery is possible.
    expect(
      shouldRefresh(answer(401), {
        loggedIn: false,
        hasRefreshToken: true,
        server: true,
      })
    ).toBe(true)
  })

  test('the client still needs loggedIn, so a stale refresh cookie does not refresh', () => {
    expect(
      shouldRefresh(answer(401), {
        loggedIn: false,
        hasRefreshToken: true,
        server: false,
      })
    ).toBe(false)
  })

  test('a failure with no answer at all is not', () => {
    expect(shouldRefresh(new Error('offline'), signedIn)).toBe(false)
    expect(shouldRefresh(undefined, signedIn)).toBe(false)
  })
})

describe('Whether a rejected token should be dropped', () => {
  const held = { hasToken: true }
  const read = { method: 'get', url: '/jsonapi' }

  test('a read refused with a 401 while holding a token is', () => {
    expect(shouldDropToken(answer(401, read), held)).toBe(true)
  })

  test('a write is not, because it must not be repeated as someone else', () => {
    expect(
      shouldDropToken(answer(401, { method: 'post', url: '/jsonapi' }), held)
    ).toBe(false)
  })

  test('a 403 is not, because the token was accepted', () => {
    expect(shouldDropToken(answer(403, read), held)).toBe(false)
  })

  test('no token is not, because there is nothing to drop', () => {
    expect(shouldDropToken(answer(401, read), { hasToken: false })).toBe(false)
  })

  test('a replay is not, so it cannot loop', () => {
    expect(
      shouldDropToken(answer(401, { ...read, [RETRIED]: true }), held)
    ).toBe(false)
  })

  test('the token request is not, because a wrong password is no bad token', () => {
    expect(
      shouldDropToken(answer(401, { method: 'get', url: '/oauth/token' }), {
        ...held,
        tokenUrl: '/oauth/token',
      })
    ).toBe(false)
  })
})

describe('Whether a request was bound for the backend', () => {
  const on = (baseURL) => ({ defaults: { baseURL } })

  test('a relative URL is, it resolves against the backend base', () => {
    expect(
      targetsBackend({ url: '/jsonapi/node/page' }, on('https://cms'))
    ).toBe(true)
  })

  test('an absolute URL to the backend origin is', () => {
    expect(
      targetsBackend({ url: 'https://cms/oauth/userinfo' }, on('https://cms'))
    ).toBe(true)
  })

  test('an absolute URL to another origin is not, so the token is not disclosed', () => {
    expect(
      targetsBackend({ url: 'https://evil.test/collect' }, on('https://cms'))
    ).toBe(false)
  })

  test('a protocol-relative URL is refused, it names another origin', () => {
    expect(
      targetsBackend({ url: '//evil.test/collect' }, on('https://cms'))
    ).toBe(false)
  })

  test('a per-request baseURL to another origin does not make it the backend', () => {
    // The instance's backend is the trusted origin; a request cannot redirect
    // the token elsewhere by setting its own baseURL.
    expect(
      targetsBackend(
        { url: '/x', baseURL: 'https://evil.test' },
        on('https://cms')
      )
    ).toBe(false)
  })

  test('a per-request baseURL that is the backend is fine', () => {
    expect(
      targetsBackend({ url: '/x', baseURL: 'https://cms' }, on('https://cms'))
    ).toBe(true)
  })

  test('an absolute URL is refused when the proxy leaves the base relative', () => {
    // Proxied: the instance base is '' and everything is same-origin by path.
    // An absolute URL has no base to match, so it is refused rather than
    // guessed.
    expect(targetsBackend({ url: 'https://cms/x', baseURL: '' }, on(''))).toBe(
      false
    )
  })
})

describe('Recovering', () => {
  // Restored here rather than at the end of each test: a restore after the
  // assertions only runs when they all pass, and a failure would otherwise
  // leave Date.now mocked for everything after it.
  afterEach(() => jest.restoreAllMocks())

  const setup = ({ refreshTokens, token = 'Bearer new' } = {}) => {
    let onRejected
    const instance = {
      interceptors: {
        response: {
          use: (_, rejected) => {
            onRejected = rejected
          },
        },
      },
      request: jest.fn(() => Promise.resolve('ok')),
    }
    const $auth = {
      loggedIn: true,
      refreshTokens: refreshTokens || jest.fn(() => Promise.resolve()),
      reset: jest.fn(() => Promise.resolve()),
      strategy: {
        options: { endpoints: { token: 'https://cms/oauth/token' } },
        refreshToken: { get: () => 'refresh' },
        token: { get: () => token },
      },
    }
    plugin({ $druxt: { axios: instance }, $auth })
    return { instance, $auth, reject: (e) => onRejected(e) }
  }

  test('does not recover a 401 from another origin, so the token is not disclosed', async () => {
    // The instance has no backend base here, so an absolute URL cannot be
    // matched to it and recovery is refused rather than replayed with the
    // Drupal token attached.
    const { $auth, reject } = setup()
    await expect(
      reject(answer(401, { url: 'https://evil.test/collect' }))
    ).rejects.toBeDefined()
    expect($auth.refreshTokens).not.toHaveBeenCalled()
  })

  test('refreshes, then replays the request with the new token', async () => {
    const { instance, $auth, reject } = setup()
    await expect(reject(answer(401, { url: '/jsonapi' }))).resolves.toBe('ok')
    expect($auth.refreshTokens).toHaveBeenCalledTimes(1)
    const [config] = instance.request.mock.calls[0]
    expect(config[RETRIED]).toBe(true)
    expect(config.headers.Authorization).toBe('Bearer new')
  })

  test('concurrent failures share one refresh', async () => {
    // Each refresh rotates the refresh token, so three refreshes would leave
    // two requests holding one that no longer works.
    let release
    const refreshTokens = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const { $auth, reject } = setup({ refreshTokens })
    const all = [
      reject(answer(401, { url: '/a' })),
      reject(answer(401, { url: '/b' })),
      reject(answer(401, { url: '/c' })),
    ]
    release()
    await Promise.all(all)
    expect($auth.refreshTokens).toHaveBeenCalledTimes(1)
  })

  test('a refresh refused with a 401 signs out rather than hanging', async () => {
    // The refresh POST runs on this instance, so its own 401 reaches the
    // handler. Treating it as refreshable awaits the in-flight refresh,
    // which is the request that just failed, and nothing ever settles.
    let reject
    const refused = answer(401, { url: 'https://cms/oauth/token' })
    // A real refresh answers a tick later, by which time the shared promise
    // is in place and a second refresh would wait on it.
    const refreshTokens = jest.fn(() =>
      Promise.resolve().then(() => reject(refused))
    )
    const ctx = setup({ refreshTokens })
    reject = ctx.reject

    const settled = await Promise.race([
      ctx.reject(answer(401, { method: 'post', url: '/jsonapi' })).then(
        () => 'replayed',
        () => 'signed out'
      ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 50)),
    ])
    expect(settled).toBe('signed out')
  })

  test('a failed refresh of a write reports the original answer, not the refresh error', async () => {
    const refreshTokens = jest.fn(() => Promise.reject(refusedRefresh()))
    const { reject, $auth, instance } = setup({ refreshTokens })
    const original = answer(401, { method: 'post', url: '/jsonapi' })
    await expect(reject(original)).rejects.toBe(original)
    expect($auth.reset).not.toHaveBeenCalled()
    expect(instance.request).not.toHaveBeenCalled()
  })

  test('a failed refresh of a read ends the session and repeats it anonymously', async () => {
    const refreshTokens = jest.fn(() => Promise.reject(refusedRefresh()))
    // A refused refresh leaves the session holding the token the read sent.
    const { reject, $auth, instance } = setup({
      refreshTokens,
      token: 'Bearer old',
    })
    const refused = answer(401, {
      url: '/jsonapi',
      headers: { Authorization: 'Bearer old', Accept: 'application/json' },
    })
    await expect(reject(refused)).resolves.toBe('ok')
    expect($auth.reset).toHaveBeenCalledTimes(1)
    const [config] = instance.request.mock.calls[0]
    expect(config.headers).toEqual({ Accept: 'application/json' })
    expect(config[RETRIED]).toBe(true)
  })

  test('a read still refused anonymously reports the original answer', async () => {
    const refreshTokens = jest.fn(() => Promise.reject(refusedRefresh()))
    const { reject, instance } = setup({ refreshTokens })
    instance.request.mockRejectedValueOnce(answer(401))
    const original = answer(401, { url: '/jsonapi' })
    await expect(reject(original)).rejects.toBe(original)
  })

  test('a refresh that fails for another reason keeps the session', async () => {
    // A timeout, a 5xx or the refresh limit says nothing about the refresh
    // token, so the visitor stays signed in and sees the original answer.
    const failures = [
      new Error('timeout of 10000ms exceeded'),
      answer(503, { url: 'https://cms/oauth/token' }),
    ]
    for (const failure of failures) {
      const refreshTokens = jest.fn(() => Promise.reject(failure))
      const { reject, $auth, instance } = setup({ refreshTokens })
      const original = answer(401, { url: '/jsonapi' })
      await expect(reject(original)).rejects.toBe(original)
      expect($auth.reset).not.toHaveBeenCalled()
      expect(instance.request).not.toHaveBeenCalled()
    }
  })

  test('a refresh token auth-next finds expired ends the session too', async () => {
    const expired = Object.assign(
      new Error('Both token and refresh token have expired.'),
      {
        name: 'ExpiredAuthSessionError',
      }
    )
    const refreshTokens = jest.fn(() => Promise.reject(expired))
    const { reject, $auth } = setup({ refreshTokens })
    await expect(reject(answer(401, { url: '/jsonapi' }))).resolves.toBe('ok')
    expect($auth.reset).toHaveBeenCalledTimes(1)
  })

  test('concurrent reads sharing a refused refresh are all repeated anonymously', async () => {
    // The first to finish resets the session, so the session no longer holds
    // the token the others were refused for.
    let release
    const refreshTokens = jest.fn(
      () =>
        new Promise((resolve, reject) => {
          release = () => reject(refusedRefresh())
        })
    )
    const { reject, $auth, instance } = setup({ refreshTokens })
    let token = 'Bearer old'
    $auth.strategy.token.get = () => token
    $auth.reset.mockImplementation(() => {
      token = null
      return Promise.resolve()
    })
    const reads = ['/a', '/b', '/c'].map((url) =>
      reject(answer(401, { url, headers: { Authorization: 'Bearer old' } }))
    )
    release()
    await expect(Promise.all(reads)).resolves.toEqual(['ok', 'ok', 'ok'])
    expect(instance.request).toHaveBeenCalledTimes(3)
    expect($auth.reset).toHaveBeenCalledTimes(1)
  })

  test('the repeated read drops the token whatever the case of its header', async () => {
    const refreshTokens = jest.fn(() => Promise.reject(refusedRefresh()))
    const { reject, instance } = setup({ refreshTokens })
    const refused = answer(401, {
      url: '/jsonapi',
      headers: { authorization: 'Bearer old', Accept: 'application/json' },
    })
    await expect(reject(refused)).resolves.toBe('ok')
    const [config] = instance.request.mock.calls[0]
    expect(config.headers).toEqual({ Accept: 'application/json' })
  })

  test('a session signed in again while a refresh was pending is kept', async () => {
    // The refused read and its refresh belong to the old token. A sign-in
    // that stored a new one meanwhile is a session of its own.
    let release
    const refreshTokens = jest.fn(
      () =>
        new Promise((resolve, reject) => {
          release = () => reject(refusedRefresh())
        })
    )
    const { reject, $auth, instance } = setup({
      refreshTokens,
      token: 'Bearer old',
    })
    let token = 'Bearer old'
    $auth.strategy.token.get = () => token
    const read = reject(
      answer(401, { url: '/jsonapi', headers: { Authorization: 'Bearer old' } })
    )
    token = 'Bearer new'
    release()
    await expect(read).resolves.toBe('ok')
    expect($auth.reset).not.toHaveBeenCalled()
    expect(instance.request.mock.calls[0][0].headers).toEqual({})
  })

  test('a refused read sent without a header still ends the session', async () => {
    const refreshTokens = jest.fn(() => Promise.reject(refusedRefresh()))
    const { reject, $auth } = setup({ refreshTokens, token: 'Bearer old' })
    await expect(reject(answer(401, { url: '/jsonapi' }))).resolves.toBe('ok')
    expect($auth.reset).toHaveBeenCalledTimes(1)
  })

  test('another origin is not repeated, with the token or without', async () => {
    const { reject, $auth, instance } = setup()
    instance.defaults = { baseURL: 'https://cms' }
    const original = answer(401, { url: 'https://elsewhere/x' })
    await expect(reject(original)).rejects.toBe(original)
    expect($auth.reset).not.toHaveBeenCalled()
  })

  test('gives up once a backend revokes continuously', () => {
    // Each burst costs one refresh, so reaching the cap means refreshes keep
    // working while requests keep failing.
    let clock = 1000000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    const { $auth, reject } = setup()

    const burst = async () => {
      clock += GRACE + 1
      return reject(answer(401, { url: `/${clock}` }))
    }

    return (async () => {
      for (let i = 0; i < LIMIT; i += 1) await burst()
      clock += GRACE + 1
      const over = answer(401, { method: 'post', url: '/over' })
      await expect(reject(over)).rejects.toBe(over)
      expect($auth.refreshTokens).toHaveBeenCalledTimes(LIMIT)
    })()
  })

  test('a refusal just after a refresh reuses that token, it does not rotate again', async () => {
    // The shape a held-promise test cannot see. A burst fails over a few
    // hundred milliseconds, so by the time the later requests are refused
    // there is no refresh in flight to share. Refreshing again would revoke
    // the token the first request just took.
    const { $auth, reject } = setup()
    await reject(answer(401, { url: '/first' }))
    expect($auth.refreshTokens).toHaveBeenCalledTimes(1)
    await reject(answer(401, { url: '/second' }))
    await reject(answer(401, { url: '/third' }))
    expect($auth.refreshTokens).toHaveBeenCalledTimes(1)
  })

  test('the grace window holds, and a refusal past it refreshes again', async () => {
    // The clock starts past zero on purpose. At zero the first refresh sets
    // refreshedAt to 0, which the guard reads as "never refreshed", so the
    // second refusal refreshes whatever GRACE says and the window is never
    // actually under test.
    let clock = 1000000
    jest.spyOn(Date, 'now').mockImplementation(() => clock)
    const { $auth, reject } = setup()

    await reject(answer(401, { url: '/first' }))
    expect($auth.refreshTokens).toHaveBeenCalledTimes(1)

    // Inside the window: the token in hand is the one a refresh would fetch.
    clock += GRACE - 1
    await reject(answer(401, { url: '/inside' }))
    expect($auth.refreshTokens).toHaveBeenCalledTimes(1)

    // Past it: the token may have expired, so this one does refresh.
    clock += 2
    await reject(answer(401, { url: '/past' }))
    expect($auth.refreshTokens).toHaveBeenCalledTimes(2)
  })

  test('reads $auth when it is needed, not when it is attached', async () => {
    // The authentication module injects it after this plugin runs.
    let onRejected
    const instance = {
      interceptors: {
        response: {
          use: (_, r) => {
            onRejected = r
          },
        },
      },
      request: jest.fn(() => Promise.resolve('ok')),
    }
    const context = { $druxt: { axios: instance } }
    plugin(context)
    context.$auth = {
      loggedIn: true,
      refreshTokens: jest.fn(() => Promise.resolve()),
      strategy: {
        refreshToken: { get: () => 'r' },
        token: { get: () => 'Bearer t' },
      },
    }
    await expect(onRejected(answer(401, { url: '/late' }))).resolves.toBe('ok')
    expect(context.$auth.refreshTokens).toHaveBeenCalled()
  })
})

describe('Attaching the interceptor', () => {
  afterEach(() => {
    delete window.onNuxtReady
  })

  const spy = () => ({
    interceptors: { response: { use: jest.fn() } },
    request: jest.fn(),
  })

  test('waits for onNuxtReady, so a druxt injected after this plugin is still intercepted', () => {
    // The failure this guards: a site whose plugin order puts druxt after
    // druxt-auth. Attaching eagerly would find no `$druxt` and no-op silently.
    let ready
    window.onNuxtReady = (cb) => {
      ready = cb
    }
    const druxtAxios = spy()
    const context = {}
    plugin(context)
    expect(druxtAxios.interceptors.response.use).not.toHaveBeenCalled()

    context.$druxt = { axios: druxtAxios } // druxt injects late
    ready()
    expect(druxtAxios.interceptors.response.use).toHaveBeenCalledTimes(1)
  })

  test('attaches at once when there is no onNuxtReady, as under test or SSR', () => {
    const druxtAxios = spy()
    plugin({ $druxt: { axios: druxtAxios } })
    expect(druxtAxios.interceptors.response.use).toHaveBeenCalledTimes(1)
  })
})
