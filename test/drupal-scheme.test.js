/* global beforeEach, describe, expect, jest, test */

import DrupalScheme from '../templates/drupal-scheme'

let $auth, storage

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

describe('DrupalScheme', () => {
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
  })

  const scheme = (options = {}) =>
    new DrupalScheme($auth, { name: 'drupal-authorization_code', ...options })

  describe('picks the authorize URL the session can reach', () => {
    const endpoints = () => ({
      authorization: 'https://cms.test/oauth/authorize',
      authorizationBackend: 'https://cms.test/oauth/authorize',
      authorizationSameOrigin: '/oauth/authorize',
    })

    test('credentials go same-origin, because the cookie was set here', async () => {
      const s = scheme({ endpoints: endpoints() })
      await s.login({ credentials: { name: 'editor', pass: 'secret' } })
      expect(s.options.endpoints.authorization).toBe('/oauth/authorize')
    })

    test('no credentials goes to Drupal, which is where its login form is', async () => {
      const s = scheme({ endpoints: endpoints() })
      await s.login({})
      expect(s.options.endpoints.authorization).toBe(
        'https://cms.test/oauth/authorize'
      )
    })

    test("a second login does not inherit the first one's choice", async () => {
      // The value is set per login, so a credential sign-in followed by a
      // Drupal-page one must not keep sending the browser to the proxy.
      const s = scheme({ endpoints: endpoints() })
      await s.login({ credentials: { name: 'editor', pass: 'secret' } })
      await s.login({})
      expect(s.options.endpoints.authorization).toBe(
        'https://cms.test/oauth/authorize'
      )
    })

    test('without a proxy there is only the backend URL', async () => {
      const s = scheme({
        endpoints: {
          authorization: 'https://cms.test/oauth/authorize',
          authorizationBackend: 'https://cms.test/oauth/authorize',
        },
      })
      await s.login({ credentials: { name: 'editor', pass: 'secret' } })
      expect(s.options.endpoints.authorization).toBe(
        'https://cms.test/oauth/authorize'
      )
    })
  })

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

  test('a page answering the login path is not a sign-in', async () => {
    // Without the proxy, this POST reaches the site's own routes, and Nuxt
    // renders a page for it rather than refusing the method. Read as a
    // sign-in, the authorize step would then run against whatever session
    // the browser already holds, issuing that person's token to whoever
    // typed here.
    $auth.request.mockResolvedValueOnce({
      data: '<!doctype html><html></html>',
    })

    await expect(
      scheme().login({ credentials: { name: 'editor', pass: 'wrong' } })
    ).rejects.toThrow('did not answer with a session')

    expect(storage['drupal-authorization_code.logout_token']).toBeUndefined()
    expect($auth.request).toHaveBeenCalledTimes(1)
  })

  test('a JSON answer without the account is not a sign-in', async () => {
    $auth.request.mockResolvedValueOnce({
      data: { logout_token: 'logout-123' },
    })

    await expect(
      scheme().login({ credentials: { name: 'editor', pass: 'wrong' } })
    ).rejects.toThrow('did not answer with a session')

    expect(storage['drupal-authorization_code.logout_token']).toBeUndefined()
  })

  test('a session this scheme opened is ended, then the sign in retried', async () => {
    // Two cases, one path. An authorisation the visitor abandoned leaves our
    // own session behind, and refusing it would lock them out until they
    // cleared their cookies. On a shared browser it is the previous person's
    // session: ending it signs the new one in as themselves, rather than
    // sending them off to find someone else's sign-out. The refusal is left
    // for a session started outside the frontend, which is the only one
    // whose owner we cannot establish.
    storage['drupal-authorization_code.logout_token'] = 'logout-123'
    $auth.request
      .mockRejectedValueOnce(
        httpError(403, 'This route can only be accessed by anonymous users.')
      )
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(loginResponse('logout-456'))

    expect(
      await scheme().login({ credentials: { name: 'editor', pass: 'secret' } })
    ).toStrictEqual({ oauth2: 'login', options: {} })

    const urls = $auth.request.mock.calls.map((c) => c[0].url)
    expect(urls).toEqual([
      '/user/login?_format=json',
      '/user/logout?_format=json',
      '/user/login?_format=json',
    ])
  })

  test('the refusal is flagged, so a form can tell it from a network failure', async () => {
    $auth.request.mockRejectedValueOnce(
      httpError(403, 'This route can only be accessed by anonymous users.')
    )
    await expect(
      scheme().login({ credentials: { name: 'editor', pass: 'secret' } })
    ).rejects.toMatchObject({ sessionInUse: true })
  })

  test('the session request carries the CSRF header core protection wants', async () => {
    // Without it a route protected the way core protects its writes answers
    // 403, the hook reports failure, and nothing names CSRF. A site chasing
    // that would remove the protection, leaving an endpoint that ends any
    // visitor's session.
    $auth.request
      .mockRejectedValueOnce(
        httpError(403, 'This route can only be accessed by anonymous users.')
      )
      .mockResolvedValueOnce({ data: 'csrf-abc123\n' })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(loginResponse('logout-456'))

    await scheme({ endpoints: { sessionLogout: '/site/end-session' } }).login({
      credentials: { name: 'editor', pass: 'secret' },
    })

    const [token, end] = $auth.request.mock.calls.slice(1).map((c) => c[0])
    expect(token).toMatchObject({ method: 'get', url: '/session/token' })
    expect(end.headers).toStrictEqual({ 'X-CSRF-Token': 'csrf-abc123' })
    expect(end.method).toBe('post')
  })

  test('a site whose route needs no header can turn the fetch off', async () => {
    $auth.request
      .mockRejectedValueOnce(
        httpError(403, 'This route can only be accessed by anonymous users.')
      )
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(loginResponse('logout-456'))

    await scheme({
      endpoints: { sessionLogout: '/site/end-session', csrfToken: null },
    }).login({ credentials: { name: 'editor', pass: 'secret' } })

    expect($auth.request.mock.calls.map((c) => c[0].url)).toEqual([
      '/user/login?_format=json',
      '/site/end-session',
      '/user/login?_format=json',
    ])
  })

  test('a site whose route wants another verb can name it', async () => {
    $auth.request
      .mockRejectedValueOnce(
        httpError(403, 'This route can only be accessed by anonymous users.')
      )
      .mockResolvedValueOnce({ data: 'csrf-abc123' })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(loginResponse('logout-456'))

    await scheme({
      endpoints: {
        sessionLogout: '/site/end-session',
        sessionLogoutMethod: 'delete',
      },
    }).login({ credentials: { name: 'editor', pass: 'secret' } })

    expect($auth.request.mock.calls[2][0].method).toBe('delete')
  })

  test('a site that can end a foreign session does, rather than refusing', async () => {
    // Core cannot do this, so the endpoint is unset by default and the module
    // ships nothing to serve it. A site that adds a route points here.
    $auth.request
      .mockRejectedValueOnce(
        httpError(403, 'This route can only be accessed by anonymous users.')
      )
      .mockResolvedValueOnce({ data: 'csrf-abc123' })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(loginResponse('logout-456'))

    const s = scheme({ endpoints: { sessionLogout: '/site/end-session' } })
    expect(
      await s.login({ credentials: { name: 'editor', pass: 'secret' } })
    ).toStrictEqual({ oauth2: 'login', options: {} })
    expect($auth.request.mock.calls.map((c) => c[0].url)).toEqual([
      '/user/login?_format=json',
      '/session/token',
      '/site/end-session',
      '/user/login?_format=json',
    ])
  })

  test('a route that refuses leaves the refusal in place', async () => {
    $auth.request
      .mockRejectedValueOnce(
        httpError(403, 'This route can only be accessed by anonymous users.')
      )
      .mockRejectedValueOnce(httpError(403, 'Access denied'))
    await expect(
      scheme({ endpoints: { sessionLogout: '/site/end-session' } }).login({
        credentials: { name: 'editor', pass: 'secret' },
      })
    ).rejects.toMatchObject({ sessionInUse: true })
  })

  test('a session it did not open is refused, token or no token', async () => {
    // No logout token, so this session is not ours to end.
    $auth.request.mockRejectedValueOnce(
      httpError(403, 'This route can only be accessed by anonymous users.')
    )
    await expect(
      scheme().login({ credentials: { name: 'editor', pass: 'secret' } })
    ).rejects.toThrow(/already open/i)
  })

  test('an existing Drupal session refuses the credentials rather than reusing it', async () => {
    // Drupal answers 403 when a session is already open, and that session is
    // whoever left it there. Carrying on would issue a token for them, so on
    // a shared browser the next person signs in as the last one.
    $auth.request.mockRejectedValueOnce(
      httpError(403, 'This route can only be accessed by anonymous users.')
    )
    await expect(
      scheme().login({ credentials: { name: 'editor', pass: 'secret' } })
    ).rejects.toThrow(/already open/i)
  })

  test('and the authorize step never runs, so no token is issued', async () => {
    $auth.request.mockRejectedValueOnce(
      httpError(403, 'This route can only be accessed by anonymous users.')
    )
    const s = scheme()
    const authorize = jest.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(s)),
      'login'
    )
    await s
      .login({ credentials: { name: 'editor', pass: 'secret' } })
      .catch(() => {})
    expect(authorize).not.toHaveBeenCalled()
    authorize.mockRestore()
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

  test('logout keeps the token when the request failed for an unknown reason', async () => {
    // The session may still be alive, and the token is the only way back to
    // it. Discarding it would leave a session nothing can end, which the
    // existing-session check then reads as someone else's.
    storage['drupal-authorization_code.logout_token'] = 'logout-123'
    $auth.request.mockRejectedValueOnce(new Error('offline'))
    expect(await scheme().logout()).toStrictEqual({ oauth2: 'logout' })
    expect(storage['drupal-authorization_code.logout_token']).toBe('logout-123')
  })

  test('logout discards the token once Drupal says the session is gone', async () => {
    storage['drupal-authorization_code.logout_token'] = 'logout-123'
    $auth.request.mockRejectedValueOnce(httpError(403, 'Access denied'))
    await scheme().logout()
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

  test('resetPassword looks up the field the caller names', async () => {
    await scheme().resetPassword('editor@example.com', 'name')
    expect($auth.request.mock.calls[0][0].data).toStrictEqual({
      name: 'editor@example.com',
    })
    await scheme().resetPassword('editor', 'mail')
    expect($auth.request.mock.calls[1][0].data).toStrictEqual({
      mail: 'editor',
    })
  })
})
