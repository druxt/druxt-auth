/* global beforeEach, describe, expect, jest, test */

import DruxtAuthModule from '../src'

let mock

// The scheme is an absolute path, which differs per checkout.
const portable = (auth) =>
  JSON.parse(
    JSON.stringify(auth).replace(
      /"[^"]*\/templates\/(drupal-scheme|drupal-password-scheme)\.js"/g,
      '"<druxt-auth>/templates/$1.js"'
    )
  )

jest.mock('axios', () => ({
  post: jest.fn(() => ({
    data: true,
  })),
}))

jest.mock('body-parser', () => ({
  json: () =>
    jest.fn((req, res, fn) => {
      fn(req, res)
    }),
}))

describe('DruxtAuth Nuxt module', () => {
  beforeEach(() => {
    mock = {
      addModule: jest.fn(),
      addTemplate: jest.fn(),
      extendRoutes: jest.fn((fn) => {
        fn([], jest.fn())
      }),
      nuxt: { hook: jest.fn() },
      options: {
        druxt: {
          baseUrl: 'https://demo-api.druxtjs.org',
        },
        serverMiddleware: [],
      },
      DruxtAuthModule,
    }
  })

  test('Defaults', async () => {
    try {
      DruxtAuthModule.call(mock, {})
    } catch (err) {
      expect(err.message).toBe('DruxtAuth requires a clientId to be provided.')
    }

    // Call Druxt module with module options.
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id',
    })

    // Expect the @nuxtjs/auth-next module to be correctly configured.
    expect(portable(mock.options.auth)).toMatchSnapshot()

    // Password grant middleware.
    expect(mock.options.serverMiddleware[0].path).toBe(
      '/_auth/drupal-password/token'
    )

    // Expect the middleware to ignore anything that isn't a POST request.
    let req = {}
    const res = {
      end: jest.fn(),
    }
    const next = jest.fn()
    await mock.options.serverMiddleware[0].handler(req, res, next)
    expect(next).toHaveBeenCalled()

    // Expect username and password to be required.
    req = {
      method: 'POST',
      body: {
        grant_type: 'password',
      },
    }
    await mock.options.serverMiddleware[0].handler(req, res, next)
    expect(next).toHaveBeenCalledWith(new Error('Invalid username or password'))

    req = {
      method: 'POST',
      body: {
        grant_type: 'password',
        username: 'admin',
        password: 'password',
      },
    }
    await mock.options.serverMiddleware[0].handler(req, res, next)
    expect(res.end).toBeCalledWith('true')
  })

  test('API Proxy - default', async () => {
    mock.options.druxt.proxy = { api: true }

    // Call Druxt module with module options.
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id',
    })

    // Expect the @nuxtjs/auth-next module to be correctly configured.
    expect(portable(mock.options.auth)).toMatchSnapshot()
  })

  test('API Proxy - Object', async () => {
    mock.options.druxt.proxy = { api: true }
    mock.options.proxy = {
      '/test': 'https://api.umami.demo.druxtjs.org',
    }

    // Call Druxt module with module options.
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id',
    })

    // Expect the @nuxtjs/auth-next module to be correctly configured.
    expect(portable(mock.options.auth)).toMatchSnapshot()
  })

  test('API Proxy - Array', async () => {
    mock.options.druxt.proxy = { api: true }
    mock.options.proxy = ['https://api.umami.demo.druxtjs.org/test']

    // Call Druxt module with module options.
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id',
    })

    // Expect the @nuxtjs/auth-next module to be correctly configured.
    expect(portable(mock.options.auth)).toMatchSnapshot()
  })
})

describe('Where the options come from', () => {
  beforeEach(() => {
    mock = {
      addModule: jest.fn(),
      addPlugin: jest.fn(),
      addTemplate: jest.fn(),
      extendRoutes: jest.fn((fn) => fn([], jest.fn())),
      nuxt: { hook: jest.fn() },
      options: {
        druxt: { baseUrl: 'https://demo-api.druxtjs.org' },
        serverMiddleware: [],
      },
    }
  })

  test('a value configured under druxt.auth survives', () => {
    // These keys are declared to name the shape. Declared after the
    // configured values rather than before, each would reset one to
    // undefined, and a site that set its password Consumer through
    // druxt.auth would silently send the browser Consumer instead.
    mock.options.druxt.auth = {
      clientId: 'from-druxt',
      clientSecret: 'secret-from-druxt',
      passwordClientId: 'password-from-druxt',
      scope: 'scope-from-druxt',
    }
    DruxtAuthModule.call(mock, {})
    const strategy = mock.options.auth.strategies['drupal-authorization_code']
    expect(strategy.clientId).toBe('from-druxt')
    expect(strategy.scope).toBe('scope-from-druxt')
  })

  test('module options still win over druxt.auth', () => {
    mock.options.druxt.auth = { clientId: 'from-druxt' }
    DruxtAuthModule.call(mock, { clientId: 'from-module' })
    expect(
      mock.options.auth.strategies['drupal-authorization_code'].clientId
    ).toBe('from-module')
  })
})

describe('The password grant token request', () => {
  const axios = require('axios')

  /** The form body the middleware posts to Drupal. */
  const postedBody = async (moduleOptions, body) => {
    axios.post.mockClear()
    DruxtAuthModule.call(mock, { clientId: 'mock-client-id', ...moduleOptions })
    const req = {
      method: 'POST',
      body: body || { grant_type: 'password', username: 'u', password: 'p' },
    }
    await mock.options.serverMiddleware[0].handler(
      req,
      { end: jest.fn() },
      jest.fn()
    )
    return new URLSearchParams(axios.post.mock.calls[0][1])
  }

  /** The `next` a refused request is handed. */
  const refusalFor = async (body) => {
    axios.post.mockClear()
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id',
      clientSecret: 's',
    })
    const next = jest.fn()
    await mock.options.serverMiddleware[0].handler(
      { method: 'POST', body },
      { end: jest.fn() },
      next
    )
    return { next, posted: axios.post.mock.calls.length }
  }

  test('a caller cannot rename the consumer the secret belongs to', async () => {
    // The secret is attached by this server, so a client_id of the caller's
    // would send it to a consumer the site never configured.
    const body = await postedBody(
      { clientSecret: 'shh' },
      {
        grant_type: 'password',
        username: 'u',
        password: 'p',
        client_id: 'attacker-client',
        client_secret: 'attacker-secret',
      }
    )
    expect(body.get('client_id')).toBe('mock-client-id')
    expect(body.get('client_secret')).toBe('shh')
  })

  test('a grant this route does not make is refused, not forwarded', async () => {
    // Forwarding it would attach the confidential consumer's secret to a
    // grant the site never intended, with no credentials asked for.
    const { next, posted } = await refusalFor({
      grant_type: 'client_credentials',
    })
    expect(next).toHaveBeenCalledWith(expect.any(Error))
    expect(next.mock.calls[0][0].message).toMatch(/grant type/i)
    expect(posted).toBe(0)
  })

  test.each(['toString', 'constructor', '__proto__', 'hasOwnProperty'])(
    'an inherited property name is refused like any other grant: %s',
    async (grant) => {
      // A plain object would resolve these to a truthy value from its
      // prototype, passing the refusal and failing later as a bare 500.
      const { next, posted } = await refusalFor({ grant_type: grant })
      expect(next).toHaveBeenCalledWith(expect.any(Error))
      expect(next.mock.calls[0][0].message).toMatch(/grant type/i)
      expect(posted).toBe(0)
    }
  )

  test('fields the named grant does not take are dropped', async () => {
    const body = await postedBody(
      { clientSecret: 'shh' },
      { grant_type: 'password', username: 'u', password: 'p', code: 'stolen' }
    )
    expect(body.has('code')).toBe(false)
    expect(body.get('username')).toBe('u')
  })

  test('the refresh grant still carries its token', async () => {
    const body = await postedBody(
      { clientSecret: 'shh' },
      { grant_type: 'refresh_token', refresh_token: 'r1' }
    )
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('r1')
    expect(body.get('client_id')).toBe('mock-client-id')
  })

  test('carries the secret a confidential consumer needs', async () => {
    const body = await postedBody({ clientSecret: 'shh' })
    expect(body.get('client_id')).toBe('mock-client-id')
    expect(body.get('client_secret')).toBe('shh')
    expect(body.get('grant_type')).toBe('password')
  })

  test('leaves the secret out when there is none, rather than sending "undefined"', async () => {
    // A public consumer has no secret, and OAuth asks for one from
    // confidential clients alone. `client_secret=undefined` is a string that
    // fails validation, so the grant never works for a public consumer.
    const body = await postedBody({})
    expect(body.has('client_secret')).toBe(false)
    expect(body.get('client_id')).toBe('mock-client-id')
  })

  test('uses its own consumer when a site names one', async () => {
    // The browser flow needs a public Consumer and the password grant a
    // confidential one, and a Consumer cannot be both. A site that runs both
    // points passwordClientId at the second.
    const body = await postedBody({
      passwordClientId: 'password-client',
      clientSecret: 'shh',
    })
    expect(body.get('client_id')).toBe('password-client')
    expect(body.get('client_secret')).toBe('shh')
  })

  test('falls back to the one clientId when a site runs a single consumer', async () => {
    const body = await postedBody({ clientSecret: 'shh' })
    expect(body.get('client_id')).toBe('mock-client-id')
  })

  test('says nothing about deprecation, because the grant is supported', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id',
      clientSecret: 'shh',
    })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
