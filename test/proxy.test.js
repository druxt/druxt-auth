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
    options: {
      druxt: { baseUrl, proxy: { api: true } },
      serverMiddleware: [],
      ...nuxtOptions,
    },
  }
  DruxtAuthModule.call(mock, { clientId: 'mock-client-id', ...options })
  return mock.options.proxy
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
    expect(proxied(entries, 'GET', '/oauth/userinfo')).toBe(true)
  })

  test('take the login path for POST only, so the page still renders', () => {
    // Drupal's JSON login is POST (user.login.http, methods: [POST]), and the
    // module adds a page at the same path, which is a GET.
    const entries = run()
    expect(proxied(entries, 'POST', '/user/login')).toBe(true)
    expect(proxied(entries, 'GET', '/user/login')).toBe(false)
    expect(proxied(entries, 'POST', '/user/login?_format=json')).toBe(true)
    expect(proxied(entries, 'GET', '/user/login?_format=json')).toBe(false)
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
      options: { druxt: { baseUrl }, serverMiddleware: [] },
    }
    DruxtAuthModule.call(mock, { clientId: 'mock-client-id' })
    expect(mock.options.proxy).toBeUndefined()
  })
})
