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

      ...(this.options.auth || {}).strategies
    },
  }

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
