/* global beforeEach, describe, expect, jest, test */

import DruxtAuthModule from '../src'

jest.mock('axios', () => ({ post: jest.fn() }))
jest.mock('body-parser', () => ({ json: () => jest.fn() }))

let mock

/**
 * Runs the module, then replays its extendRoutes callbacks over `routes`.
 */
const run = (routes, moduleOptions = {}) => {
  const callbacks = []
  mock = {
    addModule: jest.fn(),
    addTemplate: jest.fn(),
    extendRoutes: jest.fn((fn) => callbacks.push(fn)),
    nuxt: { hook: jest.fn() },
    options: {
      buildDir: '/build',
      druxt: { baseUrl: 'https://demo-api.druxtjs.org' },
      serverMiddleware: [],
    },
  }
  DruxtAuthModule.call(mock, { clientId: 'mock-client-id', ...moduleOptions })
  callbacks.forEach((fn) => fn(routes, (...parts) => parts.join('/')))
  return routes
}

const paths = (routes) => routes.map((o) => o.path)
const login = (routes) => routes.find((o) => o.name === 'druxt-auth-login')

describe('The login route', () => {
  test('is added when nothing else claims it', () => {
    const routes = run([])
    expect(login(routes)).toBeDefined()
    expect(login(routes).path).toBe('/user/login')
  })

  test('sits before a dynamic user route that would otherwise match it', () => {
    // `pages/user/_id.vue` is `/user/:id`, which matches `/user/login`.
    // vue-router takes the first match, not the most specific one.
    const routes = run([{ path: '/user/:id', name: 'user-id' }])
    expect(paths(routes).indexOf('/user/login')).toBeLessThan(
      paths(routes).indexOf('/user/:id')
    )
  })

  test('sits before the router wildcards', () => {
    // druxt-router appends `*` and a `/{langcode}*` per language.
    const routes = run([
      { path: '/de*', name: 'druxt-router__de' },
      { path: '*', name: 'druxt-router' },
    ])
    expect(paths(routes)[0]).toBe('/user/login')
  })

  test("leaves a site's own login page alone", () => {
    const routes = run([{ path: '/user/login', name: 'user-login' }])
    expect(login(routes)).toBeUndefined()
    expect(paths(routes).filter((p) => p === '/user/login')).toHaveLength(1)
  })

  test('leaves a language prefixed login page alone', () => {
    // `pages/_langcode/user/login.vue` is `/:langcode?/user/login`, which an
    // exact compare would miss, adding a second competing route.
    const routes = run([{ path: '/:langcode?/user/login', name: 'lang' }])
    expect(login(routes)).toBeUndefined()
    expect(paths(routes)).not.toContain('/user/login')
  })

  test('can be moved', () => {
    const routes = run([], { login: '/signin' })
    expect(login(routes).path).toBe('/signin')
    expect(mock.options.auth.redirect.login).toBe('/signin')
  })

  test('can be switched off, and then nothing redirects to it', () => {
    const routes = run([], { login: false })
    expect(login(routes)).toBeUndefined()
    expect(mock.options.auth.redirect.login).toBeUndefined()
  })

  test('is where auth-next sends an unauthenticated visitor', () => {
    run([])
    expect(mock.options.auth.redirect.login).toBe('/user/login')
  })

  test("a site's own redirect wins", () => {
    const routes = []
    const callbacks = []
    mock = {
      addModule: jest.fn(),
      addTemplate: jest.fn(),
      extendRoutes: jest.fn((fn) => callbacks.push(fn)),
      nuxt: { hook: jest.fn() },
      options: {
        buildDir: '/build',
        auth: { redirect: { login: '/elsewhere' } },
        druxt: { baseUrl: 'https://demo-api.druxtjs.org' },
        serverMiddleware: [],
      },
    }
    DruxtAuthModule.call(mock, { clientId: 'mock-client-id' })
    callbacks.forEach((fn) => fn(routes, (...parts) => parts.join('/')))
    expect(mock.options.auth.redirect.login).toBe('/elsewhere')
  })

  test('the components directory is registered', () => {
    run([])
    expect(mock.nuxt.hook).toHaveBeenCalledWith(
      'components:dirs',
      expect.any(Function)
    )
  })
})
