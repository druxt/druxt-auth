/* global afterEach, beforeEach, describe, expect, jest, test */

import { RefreshScheme } from '~auth/runtime'
import DrupalPasswordScheme from '../templates/drupal-password-scheme'

let $auth, storage, grant

const httpError = (status, message) =>
  Object.assign(new Error(message), { response: { status, data: { message } } })

// What Drupal's JSON login answers with. The scheme reads this shape as proof
// the request reached Drupal, so a mock that omits it is not a sign-in.
const loginResponse = (logoutToken = 'logout-123') => ({
  data: {
    current_user: { uid: '2', name: 'tester' },
    csrf_token: 'csrf-abc123',
    logout_token: logoutToken,
  },
})

const scheme = (options = {}) =>
  new DrupalPasswordScheme($auth, { name: 'drupal-password', ...options })

/** What `loginWith('drupal-password', …)` hands the scheme. */
const credentials = { data: { username: 'editor', password: 'secret' } }

describe('DrupalPasswordScheme', () => {
  beforeEach(() => {
    storage = {}
    $auth = {
      request: jest.fn(async () => loginResponse()),
      $storage: {
        setUniversal: jest.fn((key, value) => {
          storage[key] = value
        }),
        getUniversal: jest.fn((key) => storage[key]),
        removeUniversal: jest.fn((key) => {
          delete storage[key]
        }),
      },
    }
    // The grant itself is the refresh scheme's. Spied, so a test can tell
    // whether a sign-in reached it or was refused before it.
    grant = jest.spyOn(RefreshScheme.prototype, 'login')
  })

  afterEach(() => grant.mockRestore())

  test('carries the session endpoints, with the session off', () => {
    const s = scheme()
    expect(s.options.session).toBe(false)
    expect(s.options.endpoints.drupalLogin).toBe('/user/login?_format=json')
    expect(s.options.endpoints.drupalLogout).toBe('/user/logout?_format=json')
    expect(s.options.endpoints.csrfToken).toBe('/session/token')
    expect(s.logoutTokenKey).toBe('drupal-password.logout_token')
  })

  test('keeps the session endpoints under the endpoints the module configures', () => {
    // The module hands the strategy its own endpoints object. RefreshScheme
    // drops any defaults its callers pass, so unless these are merged first
    // the session step has no URL and posts to the site's root.
    const s = scheme({
      endpoints: {
        token: 'https://drupal.test/oauth/token',
        login: { baseURL: '', url: '/_auth/drupal-password/token' },
        logout: false,
        refresh: { baseURL: '', url: '/_auth/drupal-password/token' },
        user: { url: '/oauth/userinfo', method: 'post' },
      },
    })
    expect(s.options.endpoints.login.url).toBe('/_auth/drupal-password/token')
    expect(s.options.endpoints.drupalLogin).toBe('/user/login?_format=json')
    expect(s.options.endpoints.drupalLogout).toBe('/user/logout?_format=json')
  })

  test('a missing login endpoint fails naming it, rather than posting to the root', async () => {
    await expect(
      scheme({ session: true, endpoints: { drupalLogin: null } }).login(
        credentials
      )
    ).rejects.toThrow('drupalLogin endpoint is not set')
    expect($auth.request).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
  })

  test('without a session, the grant is the refresh scheme and nothing else', async () => {
    const result = await scheme().login(credentials)
    expect($auth.request).not.toHaveBeenCalled()
    expect(grant).toHaveBeenCalledTimes(1)
    expect(grant).toHaveBeenCalledWith(credentials, undefined)
    expect(result).toStrictEqual({
      refresh: 'login',
      endpoint: credentials,
      options: undefined,
    })
    expect(storage['drupal-password.logout_token']).toBeUndefined()
  })

  test('with a session, Drupal is signed in first, with the fields it names', async () => {
    await scheme({ session: true }).login(credentials)
    // The grant says username and password; Drupal's login says name and pass.
    expect($auth.request).toHaveBeenCalledWith({
      method: 'post',
      baseURL: '',
      url: '/user/login?_format=json',
      data: { name: 'editor', pass: 'secret' },
      withCredentials: true,
    })
    expect(storage['drupal-password.logout_token']).toBe('logout-123')
    expect(grant).toHaveBeenCalledTimes(1)
    expect(grant).toHaveBeenCalledWith(credentials, { reset: false })
  })

  test('wrong credentials fail at the session, so the grant is never asked', async () => {
    $auth.request.mockRejectedValueOnce(
      httpError(400, 'Sorry, unrecognized username or password.')
    )
    await expect(scheme({ session: true }).login(credentials)).rejects.toThrow(
      'unrecognized'
    )
    expect(grant).not.toHaveBeenCalled()
  })

  test('a page answering the login path is refused, not read as a session', async () => {
    // Without the login path reaching Drupal, the site's own page answers 200.
    // Read as a sign-in, the grant would issue a token to a person Drupal has
    // never heard of, and every proxied Drupal screen stays anonymous.
    $auth.request.mockResolvedValueOnce({
      data: '<!doctype html><html></html>',
    })
    await expect(scheme({ session: true }).login(credentials)).rejects.toThrow(
      'did not answer with a session'
    )
    expect(grant).not.toHaveBeenCalled()
    expect(storage['drupal-password.logout_token']).toBeUndefined()
  })

  test('a session that is not ours is refused before the grant, and flagged', async () => {
    $auth.request.mockRejectedValueOnce(
      httpError(403, 'This route can only be accessed by anonymous users.')
    )
    await expect(
      scheme({ session: true }).login(credentials)
    ).rejects.toMatchObject({ sessionInUse: true })
    expect(grant).not.toHaveBeenCalled()
  })

  test('a stale session still valid is ended by openSession before the new one', async () => {
    // A previous sign-in left a session and its token. Drupal answers the new
    // sign-in with 403, openSession ends the old session with the kept token,
    // then signs in, and the new token replaces the old. All awaited, in one
    // sequence, so nothing races the token it stores.
    storage['drupal-password.logout_token'] = 'logout-old'
    $auth.request
      .mockRejectedValueOnce(
        httpError(403, 'This route can only be accessed by anonymous users.')
      )
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(loginResponse('logout-new'))

    await scheme({ session: true }).login(credentials)

    expect($auth.request.mock.calls.map((c) => c[0].url)).toEqual([
      '/user/login?_format=json',
      '/user/logout?_format=json',
      '/user/login?_format=json',
    ])
    expect($auth.request.mock.calls[1][0].params).toStrictEqual({
      token: 'logout-old',
    })
    expect(storage['drupal-password.logout_token']).toBe('logout-new')
    expect(grant).toHaveBeenCalledWith(credentials, { reset: false })
  })

  test('a stale token whose server session has gone is simply overwritten', async () => {
    // The server session expired, so the new sign-in succeeds outright and
    // its token replaces the stale one, with no logout request.
    storage['drupal-password.logout_token'] = 'logout-old'
    $auth.request.mockResolvedValueOnce(loginResponse('logout-new'))

    await scheme({ session: true }).login(credentials)

    expect($auth.request.mock.calls.map((c) => c[0].url)).toEqual([
      '/user/login?_format=json',
    ])
    expect(storage['drupal-password.logout_token']).toBe('logout-new')
  })

  test('a late reset logout does not delete a token a newer sign-in stored', async () => {
    // reset() ends a session without awaiting. If its logout lands after a
    // fresh sign-in has stored a new token, it must not delete that token, or
    // the new session is stranded with none to end it.
    storage['drupal-password.logout_token'] = 'logout-old'
    let releaseLogout
    $auth.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseLogout = () => resolve({ data: {} })
        })
    )

    const s = scheme({ session: true })
    s.reset() // fires drupalLogout('logout-old'), not awaited
    storage['drupal-password.logout_token'] = 'logout-new' // a sign-in stored this
    releaseLogout()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(storage['drupal-password.logout_token']).toBe('logout-new')
  })

  test('a grant refused after the session opened ends the session again', async () => {
    // Otherwise the session outlives a sign-in the frontend reports as
    // failed, and the next person at this browser is signed into Drupal's
    // pages as this one.
    grant.mockImplementationOnce(() => {
      throw new Error('invalid_grant')
    })
    $auth.request
      .mockResolvedValueOnce(loginResponse('logout-123'))
      .mockResolvedValueOnce({ data: {} })

    await expect(scheme({ session: true }).login(credentials)).rejects.toThrow(
      'invalid_grant'
    )
    expect($auth.request.mock.calls.map((c) => c[0].url)).toEqual([
      '/user/login?_format=json',
      '/user/logout?_format=json',
    ])
    expect($auth.request.mock.calls[1][0].params).toStrictEqual({
      token: 'logout-123',
    })
    expect(storage['drupal-password.logout_token']).toBeUndefined()
  })

  test('with the session off, the reset is left to the refresh scheme', async () => {
    const s = scheme()
    await s.login(credentials)
    expect(s.resets).toBeUndefined()
    expect(grant).toHaveBeenCalledWith(credentials, undefined)
  })

  test('resetting the strategy ends the Drupal session it opened', async () => {
    // Refresh expiry and a strategy switch reset without calling logout().
    storage['drupal-password.logout_token'] = 'logout-123'
    $auth.request.mockResolvedValueOnce({ data: {} })
    scheme({ session: true }).reset()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect($auth.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/user/logout?_format=json',
        params: { token: 'logout-123' },
      })
    )
    expect(storage['drupal-password.logout_token']).toBeUndefined()
  })

  test('an unset logout endpoint fails naming it, when there is a session to end', async () => {
    storage['drupal-password.logout_token'] = 'logout-123'
    await expect(
      scheme({ session: true, endpoints: { drupalLogout: null } }).logout()
    ).rejects.toThrow('drupalLogout endpoint is not set')
    expect($auth.request).not.toHaveBeenCalled()
  })

  test('with no session held, an unset logout endpoint is never reached', async () => {
    await scheme({ endpoints: { drupalLogout: null } }).logout()
    expect($auth.request).not.toHaveBeenCalled()
  })

  test('signing out ends the Drupal session this scheme opened, then the grant', async () => {
    storage['drupal-password.logout_token'] = 'logout-123'
    $auth.request.mockResolvedValueOnce({ data: {} })

    const result = await scheme({ session: true }).logout()

    expect($auth.request).toHaveBeenCalledWith({
      method: 'post',
      baseURL: '',
      url: '/user/logout?_format=json',
      params: { token: 'logout-123' },
      withCredentials: true,
    })
    expect(storage['drupal-password.logout_token']).toBeUndefined()
    expect(result).toStrictEqual({ refresh: 'logout' })
  })

  test('signing out with no session held asks Drupal nothing', async () => {
    const result = await scheme().logout()
    expect($auth.request).not.toHaveBeenCalled()
    expect(result).toStrictEqual({ refresh: 'logout' })
  })

  test('a password reset is available to this strategy too', async () => {
    await scheme().resetPassword('editor@example.com')
    expect($auth.request).toHaveBeenCalledWith({
      method: 'post',
      baseURL: '',
      url: '/user/password?_format=json',
      data: { mail: 'editor@example.com' },
      withCredentials: true,
    })
  })
})
