import { resolve } from 'path'
import axios from 'axios'
import bodyParser from 'body-parser'

// eslint-disable-next-line no-unused-vars
const NuxtModule = function (moduleOptions = {}) {
  const options = {
    ...(this.options.druxt || {}),
    auth: {
      // Declared first, so they name the shape without overwriting what a
      // site configured. Spread after the configured values, every one of
      // these would reset it to undefined.
      clientId: undefined,
      clientSecret: undefined,
      // The password grant may want its own Consumer. The browser flow needs
      // a public one, and a Consumer cannot be public and confidential at
      // once, so a site that uses both points this at the second.
      passwordClientId: undefined,
      scope: undefined,
      ...((this.options.druxt || {}).auth || {}),
      ...moduleOptions,
    },
  }

  // The login route: false to skip it, a string to move it. A site that
  // already has a login page keeps it either way, see extendRoutes below.
  const loginOption = (options.auth || {}).login
  const loginPath =
    loginOption === false
      ? false
      : typeof loginOption === 'string'
        ? loginOption
        : '/user/login'

  // Deprecated: the password grant. Simple OAuth 6 ships no Password plugin
  // (AuthorizationCode, ClientCredentials and RefreshToken only), so the
  // strategy cannot work against a current Drupal. Signing in with
  // credentials on the authorization code strategy replaces it. The strategy
  // stays until 1.0.0 for sites still on Simple OAuth 5.
  //
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
      // Proxied for POST alone. Drupal's JSON routes for all three are POST
      // (user.login.http, user.logout.http, user.pass.http), and a GET has to
      // reach whatever page sits at that path: the login page this module
      // adds, or a site's own logout and password pages. Proxying the GET
      // sends the visitor to Drupal's form and the page never renders.
      ...['/user/login', '/user/logout', '/user/password'].map((path) => [
        (candidate, req) => candidate === path && req.method === 'POST',
        { target: baseUrl },
      ]),
      ['/oauth/authorize', { target: baseUrl }],
    ]
  }

  // @nuxtjs/auth-next module settings.
  this.options.auth = {
    ...this.options.auth,

    redirect: {
      callback: '/callback',
      logout: '/',
      // Without this auth-next has nowhere to send an unauthenticated
      // visitor, so the page below would exist and nothing would reach it.
      ...(loginPath ? { login: loginPath } : {}),
      ...(this.options.auth || {}).redirect,
    },

    strategies: {
      // OAuth 2 Authorization code grant with PKCE. The scheme is oauth2's,
      // plus sign-in with credentials through Drupal's JSON login.
      'drupal-authorization_code': {
        scheme: resolve(__dirname, '../templates/drupal-scheme.js'),
        // The Drupal login endpoints are same-origin paths, which only
        // resolve where this module registered the proxy. A site that
        // fronts both on one origin can set this back to true.
        credentials: !!proxy,
        endpoints: {
          // The browser-facing URL, and the default. Without credentials the
          // visitor signs in on Drupal's own page, which lives on Drupal's
          // origin, so the authorize request has to go there.
          authorization: baseUrl + '/oauth/authorize',
          authorizationBackend: baseUrl + '/oauth/authorize',
          // The same-origin path, when the proxy gives us one. Signing in
          // with credentials sets the Drupal session cookie on this origin,
          // and a cookie does not travel to the backend's, so that flow uses
          // this instead. The scheme picks between them per login.
          ...(proxy ? { authorizationSameOrigin: '/oauth/authorize' } : {}),
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

      // Password grant. Simple OAuth 6 moved it out of core, so the backend
      // needs the simple_oauth_password_grant module for this to answer.
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

        // The grants this route exists to make, and the fields each one
        // takes. The request carries a confidential consumer's secret, so a
        // grant this does not name would have that secret attached to
        // whatever the caller asked for instead.
        const grantFields = {
          password: ['username', 'password', 'scope'],
          refresh_token: ['refresh_token', 'scope'],
        }
        const fields = grantFields[data.grant_type]
        if (!fields) {
          return next(new Error('Unsupported grant type'))
        }

        if (
          data.grant_type === 'password' &&
          (!data.username || !data.password)
        ) {
          return next(new Error('Invalid username or password'))
        }

        try {
          // Build POST data string.
          const secret =
            (options.auth || {}).clientSecret ||
            process.env.DRUXT_AUTH_CLIENT_SECRET
          const postData = new URLSearchParams({
            ...Object.fromEntries(
              fields
                .filter((field) => data[field] !== undefined)
                .map((field) => [field, data[field]])
            ),
            grant_type: data.grant_type,
            // Written last, so a caller cannot rename the consumer this
            // secret belongs to by sending a client_id of their own.
            client_id:
              (options.auth || {}).passwordClientId ||
              (options.auth || {}).clientId ||
              process.env.DRUXT_AUTH_CLIENT_ID,
            // Only a confidential consumer has one, and OAuth asks for it
            // from those alone. URLSearchParams would otherwise send the
            // string "undefined", which never validates.
            ...(secret ? { client_secret: secret } : {}),
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
          res.statusCode = (err.response || {}).status || 500
          res.end(JSON.stringify({ ...((err.response || {}).data || {}) }))
        }
      })
    },
  })

  // Enable Vuex Store.
  this.options.store = true

  // Add required modules.
  this.addModule('@nuxtjs/auth-next')

  // Register the components directory, so a site overrides a component by
  // dropping its own of the same name into `components/`.
  this.nuxt.hook('components:dirs', (dirs) => {
    dirs.push({ path: resolve(__dirname, 'components') })
  })

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

  // Add the login route.
  if (loginPath) {
    this.extendRoutes((routes, resolve) => {
      // A site's own page wins, and it may be language prefixed:
      // `pages/_langcode/user/login.vue` compiles to
      // `/:langcode?/user/login`, which an exact compare would miss.
      // Match the whole path, or the same path behind a language prefix.
      // Anything else would let an unrelated page ending in the same
      // segments suppress the route. The path comes from configuration, so
      // escape it rather than let a dot or a bracket into the pattern.
      const tail = loginPath
        .replace(/^\//, '')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // vue-router ignores case and accepts a terminal slash, so a site
      // route written either way already owns the path.
      const claimed = new RegExp(
        `^(/:[A-Za-z0-9_]+\\??)?/${tail}/?$`,
        (this.options.router || {}).caseSensitive ? '' : 'i'
      )
      if (routes.find((o) => claimed.test(o.path))) {
        return
      }

      this.addTemplate({
        src: resolve(__dirname, '../templates/login.js'),
        fileName: 'components/druxt-auth-login.js',
        options,
      })

      // Unshift, never push. druxt-router appends `*` and a `/{langcode}*`
      // per language, and a page directory can hold `user/_id.vue`, which is
      // `/user/:id`. Any of those, sitting earlier in the array, matches
      // this path first, because vue-router takes the first match rather
      // than the most specific one.
      routes.unshift({
        name: 'druxt-auth-login',
        path: loginPath,
        component: resolve(
          this.options.buildDir,
          'components/druxt-auth-login.js'
        ),
        chunkName: 'druxt-auth-login',
      })
    })
  }
}

export default NuxtModule
