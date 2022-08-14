import axios from 'axios'
import bodyParser from 'body-parser'

// eslint-disable-next-line no-unused-vars
const NuxtModule = function (moduleOptions = {}) {
  const options = this.options.druxt || {}
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

      'drupal-password': {
        scheme: 'refresh',
        endpoints: {
          token: baseUrl + '/oauth/token',
          login: {
            baseURL: ''
          },
          refresh: {
            baseURL: ''
          },
        },
        grantType: 'password'
      },

      ...(this.options.auth || {}).strategies
    },
  }

  // Add password grant server middleware.
  this.options.serverMiddleware.unshift({
    path: 'api/auth/login',
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
          const response = await axios.post(
            this.options.auth.strategies['drupal-password'].endpoints.token,
            {
              client_id: (options.auth || {}).clientId || process.env.DRUXT_AUTH_CLIENT_ID,
              client_secret: (options.auth || {}).clientSecret || process.env.DRUXT_AUTH_CLIENT_SECRET,
              ...data
            },
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
              },
            }
          )
          console.log(response.data)
        } catch(err) {
          console.error({ ...err.response.data, debug: Object.keys(err.response) })
          res.statusCode = err.response.status
          res.end(JSON.stringify({ ...err.response.data, debug: Object.keys(err.response.request) }))
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
