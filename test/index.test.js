import DruxtAuthModule from '../src'

// const options = {
//   baseUrl: 'https://demo-api.druxtjs.org',
//   endpoint: '/jsonapi',
// }

let mock

describe('DruxtAuth Nuxt module', () => {
  beforeEach(() => {
    mock = {
      addModule: jest.fn(),
      addTemplate: jest.fn(),
      extendRoutes: jest.fn(),
      options: {
        druxt: {
          baseUrl: 'https://demo-api.druxtjs.org'
        },
        serverMiddleware: [],
      },
      DruxtAuthModule,
    }
  })

  test('Defaults', () => {
    // Call Druxt module with module options.
    DruxtAuthModule.call(mock, {
      clientId: 'mock-client-id'
    })

    // Expect the @nuxtjs/auth-next module to be correctly configured.
    expect(mock.options.auth).toMatchSnapshot()
  })
})
