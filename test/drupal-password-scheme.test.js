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
    expect(grant).toHaveBeenCalledWith(credentials, undefined)
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

  test('a session this scheme abandoned is ended and the sign-in retried', async () => {
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
    expect(storage['drupal-password.logout_token']).toBe('logout-new')
    expect(grant).toHaveBeenCalledTimes(1)
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
