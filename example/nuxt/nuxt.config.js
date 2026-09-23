require('dotenv').config({ path: '../.env' })
const baseUrl = process.env.BASE_URL || 'http://druxt-auth.ddev.site'

export default {
  // Global page headers: https://go.nuxtjs.dev/config-head
  head: {
    title: 'DruxtAuth example',
    htmlAttrs: {
      lang: 'en',
    },
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { hid: 'description', name: 'description', content: '' },
      { name: 'format-detection', content: 'telephone=no' },
    ],
    link: [{ rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
  },

  // Global CSS: https://go.nuxtjs.dev/config-css
  css: [],

  // Plugins to run before rendering page: https://go.nuxtjs.dev/config-plugins
  plugins: [],

  // Auto import components: https://go.nuxtjs.dev/config-components
  components: true,

  // Modules: https://go.nuxtjs.dev/config-modules
  //
  // Not buildModules. `nuxt start` does not run those, so the authentication
  // endpoints, the strategies and the proxy are all absent in production
  // while the dev server looks right.
  modules: [
    [
      'druxt-auth',
      {
        clientId: process.env.OAUTH_CLIENT_ID,
        clientSecret: 'secret',
      },
    ],
    'druxt',
  ],

  // DruxtJS: https://druxtjs.org
  druxt: {
    baseUrl,

    // Uncomment to enable API Proxy mode.
    // proxy: { api: true }
  },

  // Build Configuration: https://go.nuxtjs.dev/config-build
  build: {},
}
