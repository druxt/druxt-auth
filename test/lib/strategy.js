/* global jest */

// The scheme reads Nuxt's build-time flags at runtime; jsdom is the client.
process.client = true
process.server = false

import { Oauth2Scheme, Storage } from '@nuxtjs/auth-next/dist/runtime'

import DruxtAuthModule from '../../src'

export const baseUrl = 'https://demo-api.druxtjs.org'
export const clientId = 'mock-client-id'

/**
 * The strategy options the module hands to @nuxtjs/auth-next.
 *
 * Built by running the module itself, so the tests assert against shipped
 * configuration rather than a copy of it.
 */
export const strategyOptions = (
  name = 'drupal-authorization_code',
  moduleOptions = {}
) => {
  const mock = {
    addModule: jest.fn(),
    addTemplate: jest.fn(),
    extendRoutes: jest.fn((fn) => fn([], jest.fn())),
    options: {
      druxt: { baseUrl },
      serverMiddleware: [],
    },
  }
  DruxtAuthModule.call(mock, { clientId, ...moduleOptions })

  // What @nuxtjs/auth-next's resolveStrategies() does before the generated
  // plugin constructs the scheme: the strategy key becomes its name, and the
  // scheme reference is consumed. The name is what storage keys are built
  // from, so the tests need it.
  const strategy = { ...mock.options.auth.strategies[name], name }
  delete strategy.scheme
  return strategy
}

/** An access token that expires at the given time; Simple OAuth issues JWTs. */
export const accessToken = (expiresAt = Date.now() + 300000) => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return [
    encode({ typ: 'JWT', alg: 'RS256' }),
    encode({ exp: Math.floor(expiresAt / 1000), sub: '2', scope: ['druxt'] }),
    'signature',
  ].join('.')
}

/** Simple OAuth refresh tokens are opaque, not JWTs. */
export const refreshToken = (suffix = '0001') => `def50200${suffix}`

/** A Simple OAuth token endpoint response. */
export const tokenResponse = (overrides = {}) => ({
  data: {
    token_type: 'Bearer',
    expires_in: 300,
    access_token: accessToken(),
    refresh_token: refreshToken('0002'),
    ...overrides,
  },
})

/**
 * A scheme wired the way the Nuxt app wires it: real Oauth2Scheme, real
 * universal storage (cookies + localStorage + state), stubbed transport.
 */
export const createScheme = (moduleOptions = {}) => {
  document.cookie.split(';').forEach((c) => {
    document.cookie = `${c.split('=')[0].trim()}=; Path=/; Max-Age=0`
  })
  localStorage.clear()

  const interceptors = []
  const axios = {
    setHeader: jest.fn(),
    interceptors: {
      request: {
        use: jest.fn((fn) => interceptors.push(fn) - 1),
        eject: jest.fn(),
      },
    },
  }

  const ctx = {
    $axios: axios,
    route: { path: '/', query: {}, hash: '' },
    redirect: jest.fn(),
  }

  // Storage warns about the missing Vuex store on every construction; the
  // tests do not use Vuex state, so keep the warning out of the output.
  const warn = console.warn
  console.warn = () => {}
  const storage = new Storage(ctx, {
    cookie: { prefix: 'auth.', options: { path: '/' } },
    localStorage: { prefix: 'auth.' },
    vuex: false,
    initialState: { user: null, loggedIn: false },
  })
  console.warn = warn

  const $auth = {
    ctx,
    options: {
      redirect: { callback: '/callback', logout: '/' },
      watchLoggedIn: true,
    },
    $storage: storage,
    setUser: jest.fn(),
    request: jest.fn(),
    requestWith: jest.fn(),
    callOnError: jest.fn(),
    fetchUserOnce: jest.fn(),
    reset: jest.fn(),
  }

  const scheme = new Oauth2Scheme(
    $auth,
    strategyOptions('drupal-authorization_code', moduleOptions)
  )
  $auth.reset.mockImplementation(() => scheme.reset())

  return {
    scheme,
    $auth,
    axios,
    storage,

    /** Log in, as the code exchange leaves things. */
    signIn: ({ expiresAt } = {}) => {
      scheme.token.set(accessToken(expiresAt))
      scheme.refreshToken.set(refreshToken())
    },

    /** Run a request through the interceptor the scheme installed. */
    intercept: (config = {}) =>
      interceptors[0]({
        url: '/jsonapi/node/page',
        headers: { common: {} },
        ...config,
      }),

    /** Every auth key still present in cookies and localStorage. */
    residue: () => {
      const cookies = {}
      document.cookie
        .split(';')
        .map((c) => c.trim())
        .filter(Boolean)
        .forEach((c) => {
          const [key, value] = c.split('=')
          cookies[key] = decodeURIComponent(value || '')
        })
      const local = {}
      Object.keys(localStorage).forEach((key) => {
        local[key] = localStorage.getItem(key)
      })
      return { cookies, local }
    },
  }
}
