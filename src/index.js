import { resolve } from 'path'
import axios from 'axios'
import bodyParser from 'body-parser'

// eslint-disable-next-line no-unused-vars
const NuxtModule = function (moduleOptions = {}) {
  const options = {
    ...(this.options.druxt || {}),
    auth: {
      ...((this.options.druxt || {}).auth || {}),
      clientId: undefined,
      clientSecret: undefined,
      scope: undefined,
      ...moduleOptions,
    },
  }

  // Check if client ID is provided.
  if (!options.auth.clientId) {
    throw new Error('DruxtAuth requires a clientId to be provided.')
  }

  let { baseUrl } = options

  // Nuxt proxy integration.
  const proxy = (options.proxy || {}).api
  if (proxy) {
    // The array form throughout, because one entry below is a function and an
    // object cannot key on one. @nuxtjs/proxy reads both and treats a bare
    // string, a [context, target] pair and a [context, options] pair alike.
    const existing = !this.options.proxy
      ? []
      : Array.isArray(this.options.proxy)
        ? this.options.proxy
        : Object.entries(this.options.proxy)

    this.options.proxy = [
      ...existing,
      ['/oauth/userinfo', { target: baseUrl }],

      // Signing in with credentials puts a Drupal session cookie in the
      // browser, and it only reaches the authorize request when Drupal
      // answers on this origin. These four are what that takes.
      //
      // `/user/login` is proxied for POST alone. Drupal's JSON login is
      // POST (user.login.http, methods: [POST]), and a GET has to reach the
      // login page this module adds rather than Drupal's own form.
      [
        (path, req) => path === '/user/login' && req.method === 'POST',
        { target: baseUrl },
      ],
      ['/user/logout', { target: baseUrl }],
      ['/user/password', { target: baseUrl }],
      ['/oauth/authorize', { target: baseUrl }],
    ]
  }

  // @nuxtjs/auth-next module settings.
  this.options.auth = {
    ...this.options.auth,

    redirect: {
      callback: '/callback',
      logout: '/',
      ...(this.options.auth || {}).redirect,
    },

    strategies: {
      // OAuth 2 Authorization code grant with PKCE. The scheme is oauth2's,
      // plus sign-in with credentials through Drupal's JSON login.
      'drupal-authorization_code': {
        scheme: resolve(__dirname, '../templates/drupal-scheme.js'),
        endpoints: {
          // Same origin when the proxy is on, because signing in with
          // credentials sets the Drupal session cookie on this origin and a
          // cookie does not travel to the backend's. Sites that sign in on
          // Drupal's own page want the opposite, and override the strategy.
          authorization: (!proxy ? baseUrl : '') + '/oauth/authorize',
          token: baseUrl + '/oauth/token',
          userInfo: (!proxy ? baseUrl : '') + '/oauth/userinfo',
        },
        clientId:
          (options.auth || {}).clientId || process.env.DRUXT_AUTH_CLIENT_ID,
        responseType: 'code',
        scope: (options.auth || {}).scope,
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
          maxAge: 60 * 60 * 24 * 365,
        },
        refreshToken: {
          property: 'refresh_token',
          data: 'refresh_token',
          maxAge: 60 * 60 * 24 * 30,
        },
        endpoints: {
          token: baseUrl + '/oauth/token',
          login: {
            baseURL: '',
            url: '/_auth/drupal-password/token',
          },
          logout: false,
          refresh: {
            baseURL: '',
            url: '/_auth/drupal-password/token',
          },
          user: {
            url: (!proxy ? baseUrl : '') + '/oauth/userinfo',
            method: 'post',
          },
        },
        user: {
          property: false,
        },
        grantType: 'password',
      },

      ...(this.options.auth || {}).strategies,
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

        if (
          data.grant_type === 'password' &&
          (!data.username || !data.password)
        ) {
          return next(new Error('Invalid username or password'))
        }

        try {
          // Build POST data string.
          const postData = new URLSearchParams({
            client_id:
              (options.auth || {}).clientId || process.env.DRUXT_AUTH_CLIENT_ID,
            client_secret:
              (options.auth || {}).clientSecret ||
              process.env.DRUXT_AUTH_CLIENT_SECRET,
            ...data,
          }).toString()

          // Request token,
          const response = await axios.post(
            this.options.auth.strategies['drupal-password'].endpoints.token,
            postData,
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
            }
          )

          // Return response data.
          res.end(JSON.stringify(response.data))
        } catch (err) {
          // Handle error.
          console.error(err)
          res.statusCode = (err.response || {}).statusCode || 500
          res.end(JSON.stringify({ ...((err.response || {}).data || {}) }))
        }
      })
    },
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
        options,
      })

      routes.push({
        name: 'druxt-auth-callback',
        path: '/callback',
        component: resolve(
          this.options.buildDir,
          'components/druxt-auth-callback.js'
        ),
        chunkName: 'druxt-auth-callback',
      })
    }
  })
}

export default NuxtModule
