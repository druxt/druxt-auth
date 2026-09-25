import { resolve } from 'path'
import axios from 'axios'
import bodyParser from 'body-parser'
import { createProxyMiddleware } from 'http-proxy-middleware'

import { proxyEntries } from './proxy'

const isPlainObject = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Site over base, recursing through plain objects; anything else the site names wins. */
const extend = (base, over) => {
  if (!isPlainObject(base) || !isPlainObject(over)) return over
  const out = { ...base }
  for (const [key, value] of Object.entries(over))
    out[key] = extend(base[key], value)
  return out
}

/**
 * A site's entry for a built-in strategy extends it rather than replacing it.
 *
 * Spread alone replaced it, so a site naming one endpoint dropped the scheme,
 * the client id and every other endpoint, and the strategy failed silently.
 * Object-valued keys merge at every depth, so `endpoints.login.url` keeps the
 * `baseURL` beside it. Anything else the site names wins, so `logout: false`
 * still replaces. A strategy the module does not define passes through.
 */
const extendStrategies = (builtIn, site) => {
  const strategies = { ...builtIn }
  for (const [name, options] of Object.entries(site || {})) {
    strategies[name] = extend(builtIn[name], options)
  }
  return strategies
}

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
      // The password grant issues a token and no Drupal session. A site that
      // proxies Drupal's own pages needs the session too, and sets this.
      passwordSession: undefined,
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

  // Check if client ID is provided.
  if (!options.auth.clientId) {
    throw new Error('DruxtAuth requires a clientId to be provided.')
  }

  let { baseUrl } = options

  // Nuxt proxy integration.
  const proxy = (options.proxy || {}).api
  if (proxy) {
    // Registered as server middleware here, not appended to the `proxy`
    // option. @nuxtjs/proxy reads that option once, when it is installed,
    // and druxt installs it at the end of its own run, so a module that runs
    // after druxt appends entries nothing ever reads, and the sign-in fails
    // after Drupal has issued the token. This owes nothing to module order.
    for (const [context, entry] of proxyEntries(baseUrl)) {
      this.options.serverMiddleware.push({
        prefix: false,
        // The defaults @nuxtjs/proxy applied, so requests go as they did.
        handler: createProxyMiddleware(context, {
          changeOrigin: true,
          ws: true,
          ...entry,
        }),
      })
    }
  }

  // Captured first: the assignment below rebuilds `strategies`.
  const siteStrategies = (this.options.auth || {}).strategies

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
          // Relative through the proxy, like userInfo: the browser makes
          // this request, and cannot reach Drupal's origin when it is private.
          token: (!proxy ? baseUrl : '') + '/oauth/token',
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
      // A refresh scheme, plus the Drupal session a site can opt into.
      'drupal-password': {
        scheme: resolve(__dirname, '../templates/drupal-password-scheme.js'),
        session: !!(options.auth || {}).passwordSession,
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
          // Absolute: the server middleware below posts to this, not the
          // browser, so it has to name Drupal directly.
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
    },
  }
  this.options.auth.strategies = extendStrategies(
    this.options.auth.strategies,
    siteStrategies
  )

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
        // A Map, not an object: a plain object resolves inherited names like
        // `toString` or `constructor` to a truthy value, and a caller names
        // the grant.
        const grantFields = new Map([
          ['password', ['username', 'password', 'scope']],
          ['refresh_token', ['refresh_token', 'scope']],
        ])
        const fields = grantFields.get(data.grant_type)
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

  // Recover a session whose access tokens Drupal revoked. Saving a user
  // revokes that user's tokens, and nothing on the client notices, because
  // a token deleted on the server still looks unexpired.
  this.addPlugin({
    src: resolve(__dirname, '../templates/auth-refresh.js'),
    fileName: 'druxt-auth-refresh.js',
    // Universal, not client-only: a token the backend revoked is answered
    // with a 401 on the server render too, and only the interceptor recovers
    // it. Registered client-only, a page load after a revocation signs out.
    mode: 'all',
    options,
  })

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
