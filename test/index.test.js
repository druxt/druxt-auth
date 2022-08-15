import DruxtAuthModule from '../src'

let mock

jest.mock('axios', () => ({
  post: jest.fn(() => ({
    data: true
  }))
}))

jest.mock('body-parser', () => ({
  json: () => jest.fn((req, res, fn) => {
    fn(req, res)
  })
}))

describe('DruxtAuth Nuxt module', () => {
  beforeEach(() => {
    mock = {
      addModule: jest.fn(),
      addTemplate: jest.fn(),
      extendRoutes: jest.fn(fn => {
        fn([], jest.fn())
      }),
      options: {
        druxt: {
          baseUrl: 'https://demo-api.druxtjs.org'
        },
        serverMiddleware: [],
      },
      DruxtAuthModule,
    }
  })

  test('Defaults', async () => {
    try {
      DruxtAuthModule.call(mock, {})
    } catch(err) {
      expect(err.message).toBe('DruxtAuth requires a clientId to be provided.')
    }

    // Call Druxt module with module options.
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id'
    })

    // Expect the @nuxtjs/auth-next module to be correctly configured.
    expect(mock.options.auth).toMatchSnapshot()

    // Password grant middleware.
    expect(mock.options.serverMiddleware[0].path).toBe('/_auth/drupal-password/token')

    // Expect the middleware to ignore anything that isn't a POST request.
    let req = {}
    const res = {
      end: jest.fn()
    }
    const next = jest.fn()
    await mock.options.serverMiddleware[0].handler(req, res, next)
    expect(next).toHaveBeenCalled()

    // Expect username and password to be required.
    req = {
      method: 'POST',
      body: {
        grant_type: 'password'
      }
    }
    await mock.options.serverMiddleware[0].handler(req, res, next)
    expect(next).toHaveBeenCalledWith(new Error('Invalid username or password'))

    req = {
      method: 'POST',
      body: {
        grant_type: 'password',
        username: 'admin',
        password: 'password'
      }
    }
    await mock.options.serverMiddleware[0].handler(req, res, next)
    expect(res.end).toBeCalledWith('true')
  })
})
