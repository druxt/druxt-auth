/* global beforeEach, describe, expect, jest, test */

import DrupalScheme from '../templates/drupal-scheme'

let $auth, storage

const httpError = (status, message) =>
  Object.assign(new Error(message), { response: { status, data: { message } } })

describe('DrupalScheme', () => {
  beforeEach(() => {
    storage = {}
    $auth = {
      request: jest.fn(async () => ({ data: { logout_token: 'logout-123' } })),
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
  })

  const scheme = (options = {}) =>
    new DrupalScheme($auth, { name: 'drupal-authorization_code', ...options })

  test('login without credentials is oauth2 login', async () => {
    expect(await scheme().login({ state: 'x' })).toStrictEqual({
      oauth2: 'login',
      options: { state: 'x' },
    })
    expect($auth.request).not.toHaveBeenCalled()
  })

  test('login with credentials signs in to Drupal first, then starts oauth2', async () => {
    const result = await scheme().login({
      credentials: { name: 'editor', pass: 'secret' },
    })
    expect($auth.request).toHaveBeenCalledWith({
      method: 'post',
      baseURL: '',
      url: '/user/login?_format=json',
      data: { name: 'editor', pass: 'secret' },
      withCredentials: true,
    })
    expect(storage['drupal-authorization_code.logout_token']).toBe('logout-123')
    expect(result).toStrictEqual({ oauth2: 'login', options: {} })
  })

  test('a refused sign-in stops before oauth2', async () => {
    $auth.request.mockRejectedValueOnce(
      httpError(400, 'Sorry, unrecognized username or password.')
    )
    await expect(
      scheme().login({ credentials: { name: 'editor', pass: 'wrong' } })
    ).rejects.toThrow('unrecognized')
  })

  test('an existing Drupal session carries on to oauth2', async () => {
    $auth.request.mockRejectedValueOnce(
      httpError(403, 'This route can only be accessed by anonymous users.')
    )
    expect(
      await scheme().login({ credentials: { name: 'editor', pass: 'secret' } })
    ).toStrictEqual({ oauth2: 'login', options: {} })
  })

  test('a blocked account is an error', async () => {
    $auth.request.mockRejectedValueOnce(
      httpError(403, 'The user has not been activated or is blocked.')
    )
    await expect(
      scheme().login({ credentials: { name: 'editor', pass: 'secret' } })
    ).rejects.toThrow('blocked')
  })

  test('endpoints can be overridden', async () => {
    await scheme({
      endpoints: { drupalLogin: '/api/user/login?_format=json' },
    }).login({ credentials: { name: 'a', pass: 'b' } })
    expect($auth.request.mock.calls[0][0].url).toBe(
      '/api/user/login?_format=json'
    )
  })

  test('logout ends the Drupal session it started', async () => {
    storage['drupal-authorization_code.logout_token'] = 'logout-123'
    expect(await scheme().logout()).toStrictEqual({ oauth2: 'logout' })
    expect($auth.request).toHaveBeenCalledWith({
      method: 'post',
      baseURL: '',
      url: '/user/logout?_format=json',
      params: { token: 'logout-123' },
      withCredentials: true,
    })
    expect(storage['drupal-authorization_code.logout_token']).toBeUndefined()
  })

  test('logout still signs out when Drupal refuses', async () => {
    storage['drupal-authorization_code.logout_token'] = 'logout-123'
    $auth.request.mockRejectedValueOnce(httpError(403, 'gone'))
    expect(await scheme().logout()).toStrictEqual({ oauth2: 'logout' })
    expect(storage['drupal-authorization_code.logout_token']).toBeUndefined()
  })

  test('logout without a Drupal session is oauth2 logout', async () => {
    expect(await scheme().logout()).toStrictEqual({ oauth2: 'logout' })
    expect($auth.request).not.toHaveBeenCalled()
  })

  test('resetPassword sends an address as mail and anything else as name', async () => {
    await scheme().resetPassword('editor@example.com')
    expect($auth.request.mock.calls[0][0]).toMatchObject({
      url: '/user/password?_format=json',
      data: { mail: 'editor@example.com' },
    })
    await scheme().resetPassword('editor')
    expect($auth.request.mock.calls[1][0].data).toStrictEqual({
      name: 'editor',
    })
  })
})
