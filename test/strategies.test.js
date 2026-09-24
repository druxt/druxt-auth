/* global describe, expect, jest, test */

import DruxtAuthModule from '../src'

jest.mock('axios', () => ({ post: jest.fn() }))
jest.mock('body-parser', () => ({ json: () => jest.fn() }))

const baseUrl = 'https://demo-api.druxtjs.org'

/** Runs the module with a site's `auth` and hands back its strategies. */
const strategies = (auth) => {
  const mock = {
    addModule: jest.fn(),
    addPlugin: jest.fn(),
    addTemplate: jest.fn(),
    extendRoutes: jest.fn((fn) => fn([], jest.fn())),
    nuxt: { hook: jest.fn() },
    options: {
      druxt: { baseUrl, proxy: { api: true } },
      serverMiddleware: [],
      ...(auth ? { auth } : {}),
    },
  }
  DruxtAuthModule.call(mock, { clientId: 'mock-client-id' })
  return mock.options.auth.strategies
}

describe("A site's strategy entry", () => {
  test('extends the built-in strategy rather than replacing it', () => {
    // Naming one endpoint used to drop everything else the module supplies,
    // so the strategy failed silently with no scheme and no client id.
    const s = strategies({
      strategies: {
        'drupal-authorization_code': {
          endpoints: { sessionLogout: '/site/end-session' },
        },
      },
    })['drupal-authorization_code']
    expect(s.endpoints.sessionLogout).toBe('/site/end-session')
    expect(s.scheme).toMatch(/drupal-scheme\.js$/)
    expect(s.clientId).toBe('mock-client-id')
    expect(s.codeChallengeMethod).toBe('S256')
    expect(s.endpoints.authorization).toBe(`${baseUrl}/oauth/authorize`)
    expect(s.endpoints.token).toBe(`${baseUrl}/oauth/token`)
  })

  test('wins on any key it names, at the top level and one level down', () => {
    const s = strategies({
      strategies: {
        'drupal-password': {
          endpoints: { logout: { url: '/site/logout' } },
          token: { maxAge: 60 },
        },
      },
    })['drupal-password']
    expect(s.endpoints.logout).toStrictEqual({ url: '/site/logout' })
    expect(s.endpoints.login.url).toBe('/_auth/drupal-password/token')
    expect(s.token.maxAge).toBe(60)
    expect(s.token.property).toBe('access_token')
  })

  test('passes a strategy the module does not define through untouched', () => {
    const own = { scheme: 'local', endpoints: { login: '/api/login' } }
    expect(strategies({ strategies: { own } }).own).toStrictEqual(own)
    expect(Object.keys(strategies({ strategies: { own } }))).toEqual([
      'drupal-authorization_code',
      'drupal-password',
      'own',
    ])
  })

  test('the readme snippet, pasted as written, yields a working strategy', () => {
    // The pair is the point: documentation that names this shape has to
    // produce a strategy that still signs anyone in.
    const s = strategies({
      strategies: {
        'drupal-authorization_code': {
          endpoints: {
            sessionLogout: '/your/route',
            sessionLogoutMethod: 'post',
            csrfToken: '/session/token',
          },
        },
      },
    })['drupal-authorization_code']
    expect(s.endpoints.sessionLogout).toBe('/your/route')
    expect(s.scheme).toBeDefined()
    expect(s.clientId).toBeDefined()
    expect(s.endpoints.authorization).toBeDefined()
  })

  test('is absent by default, leaving the built-ins exactly as built', () => {
    const s = strategies()
    expect(Object.keys(s)).toEqual([
      'drupal-authorization_code',
      'drupal-password',
    ])
    expect(s['drupal-authorization_code'].clientId).toBe('mock-client-id')
  })
})
