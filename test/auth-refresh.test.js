/* global afterEach, describe, expect, jest, test */

import plugin, {
  GRACE,
  LIMIT,
  RETRIED,
  shouldRefresh,
} from '../templates/auth-refresh.js'

const answer = (status, config = {}) => ({ response: { status }, config })
const signedIn = { loggedIn: true, hasRefreshToken: true }

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
      strategy: {
        options: { endpoints: { token: 'https://cms/oauth/token' } },
        refreshToken: { get: () => 'refresh' },
        token: { get: () => token },
      },
    }
    plugin({ $druxt: { axios: instance }, $auth })
    return { instance, $auth, reject: (e) => onRejected(e) }
  }

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
      ctx.reject(answer(401, { url: '/jsonapi' })).then(
        () => 'replayed',
        () => 'signed out'
      ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 50)),
    ])
    expect(settled).toBe('signed out')
  })

  test('a failed refresh reports the original answer, not the refresh error', async () => {
    const refreshTokens = jest.fn(() =>
      Promise.reject(new Error('refresh gone'))
    )
    const { reject } = setup({ refreshTokens })
    const original = answer(401, { url: '/jsonapi' })
    await expect(reject(original)).rejects.toBe(original)
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
      const over = answer(401, { url: '/over' })
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
