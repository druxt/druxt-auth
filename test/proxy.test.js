/* global describe, expect, jest, test */

import { match } from 'http-proxy-middleware/dist/context-matcher.js'
import DruxtAuthModule from '../src'

jest.mock('axios', () => ({ post: jest.fn() }))
jest.mock('body-parser', () => ({ json: () => jest.fn() }))

const baseUrl = 'https://demo-api.druxtjs.org'

const run = (options = {}, nuxtOptions = {}) => {
  const mock = {
    addModule: jest.fn(),
    addTemplate: jest.fn(),
    extendRoutes: jest.fn((fn) => fn([], jest.fn())),
    nuxt: { hook: jest.fn() },
    options: {
      druxt: { baseUrl, proxy: { api: true } },
      serverMiddleware: [],
      ...nuxtOptions,
    },
  }
  DruxtAuthModule.call(mock, { clientId: 'mock-client-id', ...options })
  return mock.options.proxy
}

/** The generated `drupal-authorization_code` strategy. */
const strategy = (nuxtOptions = {}) => {
  const mock = {
    addModule: jest.fn(),
    // Every hook the module may reach for, so a later branch adding one does
    // not fail here as a missing function rather than as a real change.
    addPlugin: jest.fn(),
    addTemplate: jest.fn(),
    extendRoutes: jest.fn((fn) => fn([], jest.fn())),
    nuxt: { hook: jest.fn() },
    options: {
      druxt: { baseUrl, proxy: { api: true } },
      serverMiddleware: [],
      ...nuxtOptions,
    },
  }
  DruxtAuthModule.call(mock, { clientId: 'mock-client-id' })
  return mock.options.auth.strategies['drupal-authorization_code']
}

/** The context of an entry, which is a bare string or a [context, options] pair. */
const contextOf = (entry) => (Array.isArray(entry) ? entry[0] : entry)

/** Whether a real http-proxy-middleware would send this request to Drupal. */
const proxied = (entries, method, url) =>
  entries.some((entry) =>
    match(contextOf(entry), `http://site${url}`, { method, url })
  )

describe('The proxy entries', () => {
  test('send Drupal what the session cookie needs', () => {
    const entries = run()
    for (const path of ['/user/logout', '/user/password', '/oauth/authorize']) {
      expect(proxied(entries, 'POST', path)).toBe(true)
    }
    // The authorize step is a browser redirect, so it must carry a GET too.
    expect(proxied(entries, 'GET', '/oauth/authorize')).toBe(true)
    expect(proxied(entries, 'GET', '/oauth/userinfo')).toBe(true)
  })

  test('take the session paths for POST only, so the pages still render', () => {
    // Drupal's JSON routes for all three are POST (user.login.http,
    // user.logout.http, user.pass.http). A GET has to reach whatever page
    // sits there: the login page this module adds, or a site's own logout
    // and password pages. Proxying the GET shows Drupal's form instead.
    const entries = run()
    for (const path of ['/user/login', '/user/logout', '/user/password']) {
      expect(proxied(entries, 'POST', path)).toBe(true)
      expect(proxied(entries, 'GET', path)).toBe(false)
      expect(proxied(entries, 'POST', `${path}?_format=json`)).toBe(true)
      expect(proxied(entries, 'GET', `${path}?_format=json`)).toBe(false)
    }
  })

  test("keep a site's own entries, whichever form they were written in", () => {
    const fromObject = run(
      {},
      { proxy: { '/other': 'https://elsewhere.test' } }
    )
    expect(proxied(fromObject, 'GET', '/other')).toBe(true)
    expect(proxied(fromObject, 'POST', '/user/login')).toBe(true)

    // A bare string entry is carried through untouched, whatever it means.
    const fromArray = run({}, { proxy: ['https://elsewhere.test/other'] })
    expect(fromArray).toContain('https://elsewhere.test/other')
    expect(proxied(fromArray, 'POST', '/user/login')).toBe(true)
  })

  test('are not added when the proxy is off', () => {
    const mock = {
      addModule: jest.fn(),
      addTemplate: jest.fn(),
      extendRoutes: jest.fn((fn) => fn([], jest.fn())),
      nuxt: { hook: jest.fn() },
      options: { druxt: { baseUrl }, serverMiddleware: [] },
    }
    DruxtAuthModule.call(mock, { clientId: 'mock-client-id' })
    expect(mock.options.proxy).toBeUndefined()
  })
})

describe('The authorize endpoint', () => {
  test('defaults to the backend, which is where Drupal shows its login form', () => {
    // Without credentials the visitor signs in on Drupal's own page. That
    // page is on Drupal's origin, so the authorize request has to go there.
    expect(strategy().endpoints.authorization).toBe(
      `${baseUrl}/oauth/authorize`
    )
    expect(strategy().endpoints.authorizationBackend).toBe(
      `${baseUrl}/oauth/authorize`
    )
  })

  test('offers a same-origin path when the proxy provides one', () => {
    // Credentials set the Drupal session cookie on this origin, and a cookie
    // does not travel to the backend's.
    expect(strategy().endpoints.authorizationSameOrigin).toBe(
      '/oauth/authorize'
    )
  })

  test('offers none when there is no proxy to carry it', () => {
    const endpoints = strategy({ druxt: { baseUrl } }).endpoints
    expect(endpoints.authorizationSameOrigin).toBeUndefined()
    expect(endpoints.authorization).toBe(`${baseUrl}/oauth/authorize`)
  })

  test('names a path the proxy actually carries', () => {
    // The pair is the point: a proxy entry nothing points at, or an endpoint
    // no entry carries, both read as a working same-origin setup.
    const sameOrigin = strategy().endpoints.authorizationSameOrigin
    expect(proxied(run(), 'GET', sameOrigin)).toBe(true)
  })
})
