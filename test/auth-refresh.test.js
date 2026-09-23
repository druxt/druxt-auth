/* global describe, expect, jest, test */

import plugin, {
  GRACE,
  LIMIT,
  RETRIED,
  shouldRefresh,
} from '../templates/auth-refresh.client.js'

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

  test('a failure with no answer at all is not', () => {
    expect(shouldRefresh(new Error('offline'), signedIn)).toBe(false)
    expect(shouldRefresh(undefined, signedIn)).toBe(false)
  })
})

describe('Recovering', () => {
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
    const now = jest.spyOn(Date, 'now')
    let clock = 0
    now.mockImplementation(() => clock)
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
      now.mockRestore()
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

  test('once the grace window passes, a refusal refreshes again', async () => {
    const now = jest.spyOn(Date, 'now')
    let clock = 0
    now.mockImplementation(() => clock)
    const { $auth, reject } = setup()
    await reject(answer(401, { url: '/first' }))
    clock += GRACE + 1
    await reject(answer(401, { url: '/later' }))
    expect($auth.refreshTokens).toHaveBeenCalledTimes(2)
    now.mockRestore()
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
