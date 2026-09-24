/* global describe, expect, jest, test */

import { match } from 'http-proxy-middleware/dist/context-matcher.js'
import DruxtAuthModule from '../src'
import { proxyEntries } from '../src/proxy'

jest.mock('axios', () => ({ post: jest.fn() }))
jest.mock('body-parser', () => ({ json: () => jest.fn() }))

const baseUrl = 'https://demo-api.druxtjs.org'

/** Runs the module and hands back the Nuxt it ran against. */
const run = (options = {}, nuxtOptions = {}) => {
  const mock = {
    addModule: jest.fn(),
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
  DruxtAuthModule.call(mock, { clientId: 'mock-client-id', ...options })
  return mock
}

/** The generated `drupal-authorization_code` strategy. */
const strategy = (nuxtOptions = {}) =>
  run({}, nuxtOptions).options.auth.strategies['drupal-authorization_code']

/** The proxy handlers the module registered, as opposed to its token route. */
const registered = (mock) =>
  mock.options.serverMiddleware.filter((m) => m.prefix === false)

const entries = proxyEntries(baseUrl)

/** Whether a real http-proxy-middleware would send this request to Drupal. */
const proxied = (method, url) =>
  entries.some(([context]) =>
    match(context, `http://site${url}`, { method, url })
  )

describe('The proxy entries', () => {
  test('send Drupal what the session cookie needs', () => {
    for (const path of ['/user/logout', '/user/password', '/oauth/authorize']) {
      expect(proxied('POST', path)).toBe(true)
    }
    // The authorize step is a browser redirect, so it must carry a GET too.
    expect(proxied('GET', '/oauth/authorize')).toBe(true)
    expect(proxied('GET', '/oauth/userinfo')).toBe(true)
  })

  test('carry the token exchange, which the browser makes', () => {
    // Without this the browser posts to Drupal's own origin, which it
    // cannot reach when that origin is private: the normal decoupled shape.
    expect(proxied('POST', '/oauth/token')).toBe(true)
  })

  test('take the session paths for POST only, so the pages still render', () => {
    // Drupal's JSON routes for all three are POST (user.login.http,
    // user.logout.http, user.pass.http). A GET has to reach whatever page
    // sits there: the login page this module adds, or a site's own logout
    // and password pages. Proxying the GET shows Drupal's form instead.
    for (const path of ['/user/login', '/user/logout', '/user/password']) {
      expect(proxied('POST', path)).toBe(true)
      expect(proxied('GET', path)).toBe(false)
      expect(proxied('POST', `${path}?_format=json`)).toBe(true)
      expect(proxied('GET', `${path}?_format=json`)).toBe(false)
    }
  })
})

describe('The proxy registration', () => {
  test('is server middleware, one handler per entry', () => {
    const handlers = registered(run())
    expect(handlers).toHaveLength(entries.length)
    for (const m of handlers) {
      expect(typeof m.handler).toBe('function')
    }
  })

  test('owes nothing to module order or to what the proxy option holds', () => {
    // The bug: @nuxtjs/proxy reads `options.proxy` once, when druxt installs
    // it, so entries appended afterwards were never read. Whatever that
    // option already holds, and whether it was consumed already, the same
    // handlers register here.
    const empty = registered(run())
    const afterDruxt = registered(
      run(
        {},
        { proxy: { '/jsonapi': baseUrl, '/router/translate-path': baseUrl } }
      )
    )
    const arrayForm = registered(run({}, { proxy: [`${baseUrl}/jsonapi`] }))
    expect(afterDruxt).toHaveLength(empty.length)
    expect(arrayForm).toHaveLength(empty.length)
  })

  test("leaves a site's own proxy option exactly as it found it", () => {
    const object = { '/other': 'https://elsewhere.test' }
    expect(run({}, { proxy: object }).options.proxy).toStrictEqual(object)
    const array = ['https://elsewhere.test/other']
    expect(run({}, { proxy: array }).options.proxy).toStrictEqual(array)
    expect(run().options.proxy).toBeUndefined()
  })

  test('is absent when the proxy is off', () => {
    const mock = run({}, { druxt: { baseUrl } })
    expect(registered(mock)).toHaveLength(0)
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
    expect(proxied('GET', strategy().endpoints.authorizationSameOrigin)).toBe(
      true
    )
  })
})

describe('The token endpoint', () => {
  test('is same-origin when proxied, and the proxy carries it', () => {
    const token = strategy().endpoints.token
    expect(token).toBe('/oauth/token')
    expect(proxied('POST', token)).toBe(true)
  })

  test('names Drupal directly when there is no proxy', () => {
    expect(strategy({ druxt: { baseUrl } }).endpoints.token).toBe(
      `${baseUrl}/oauth/token`
    )
  })

  test('stays absolute for the password grant, whose server route posts to it', () => {
    const password = run().options.auth.strategies['drupal-password']
    expect(password.endpoints.token).toBe(`${baseUrl}/oauth/token`)
  })
})
