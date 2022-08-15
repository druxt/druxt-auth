import axios from 'axios'
import bodyParser from 'body-parser'

// eslint-disable-next-line no-unused-vars
const NuxtModule = function (moduleOptions = {}) {
  const options = {
    ...this.options.druxt || {},
    auth: {
      ...(this.options.druxt || {}).auth || {},
      clientId: undefined,
      clientSecret: undefined,
      ...moduleOptions,
    }
  }

  // Check if cliend ID is provided.
  if (!options.auth.clientId) {
    throw new Error('DruxtAuth requires a clientId to be provided.')
  }

  const { baseUrl } = options

  // @nuxtjs/auth-next module settings.
  this.options.auth = {
    ...this.options.auth,

    redirect: {
      callback: '/callback',
      logout: '/',
      ...(this.options.auth || {}).redirect
    },

    strategies: {
      // OAuth 2 Authorization code grant with PKCE.
      'drupal-authorization_code': {
        scheme: 'oauth2',
        endpoints: {
          authorization: baseUrl + '/oauth/authorize',
          token: baseUrl + '/oauth/token',
          userInfo: baseUrl + '/oauth/userinfo',
        },
        clientId: (options.auth || {}).clientId || process.env.DRUXT_AUTH_CLIENT_ID,
        responseType: 'code',
        grantType: 'authorization_code',
        codeChallengeMethod: 'S256',
      },

      // Password grant with API secret.
      'drupal-password': {
        scheme: 'refresh',
        token: {
          property: 'access_token',
          type: 'Bearer',
          name: 'Authorization',
          maxAge: 60 * 60 * 24 * 365
        },
        refreshToken: {
          property: 'refresh_token',
          data: 'refresh_token',
          maxAge: 60 * 60 * 24 * 30
        },
        endpoints: {
          token: baseUrl + '/oauth/token',
          login: {
            baseURL: '',
            url: '/_auth/drupal-password/token'
          },
          logout: false,
          refresh: {
            baseURL: '',
            url: '/_auth/drupal-password/token'
          },
          user: {
            url: baseUrl + '/oauth/userinfo',
            method: 'post'
          },
        },
        user: {
          property: false
        },
        grantType: 'password'
      },

      ...(this.options.auth || {}).strategies
    },
  }

  // Add password grant server middleware.
  this.options.serverMiddleware.unshift({
    path: '/_auth/drupal-password/token',
    handler: async (req, res, next) => {
      if (req.method !== 'POST') {
        return next()
      }

      const formMiddleware = bodyParser.json()
      await formMiddleware(req, res, async () => {
        const data = req.body

        if (data.grant_type === 'password' && (!data.username || !data.password)) {
          return next(new Error('Invalid username or password'))
        }

        try {
          // Build POST data string.
          const postData = new URLSearchParams({
            client_id: (options.auth || {}).clientId || process.env.DRUXT_AUTH_CLIENT_ID,
            client_secret: (options.auth || {}).clientSecret || process.env.DRUXT_AUTH_CLIENT_SECRET,
            ...data
          }).toString()

          // Request token,
          const response = await axios.post(
            this.options.auth.strategies['drupal-password'].endpoints.token,
            postData,
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
              },
            }
          )

          // Return response data.
          res.end(JSON.stringify(response.data))
        } catch(err) {
          // Handle error.
          console.error(err)
          res.statusCode = (err.response || {}).statusCode || 500
          res.end(JSON.stringify({ ...((err.response || {}).data || {}) }))
        }
      })
    }
  })

  // Enable Vuex Store.
  this.options.store = true

  // Add required modules.
  this.addModule('@nuxtjs/auth-next')

  // Add callback route.
  this.extendRoutes((routes, resolve) => {
    // Only add the callback if there isn't an existing callback.
    if (!routes.find((o) => o.path === '/callback')) {
      this.addTemplate({
        src: resolve(__dirname, '../templates/callback.js'),
        fileName: 'components/druxt-auth-callback.js',
        options
      })

      routes.push({
        name: 'druxt-auth-callback',
        path: '/callback',
        component: resolve(this.options.buildDir, 'components/druxt-auth-callback.js'),
        chunkName: 'druxt-auth-callback'
      })
    }
  })
}

export default NuxtModule
