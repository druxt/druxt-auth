// Stands in for @nuxtjs/auth-next's runtime, which only exists in a Nuxt build.
const merge = (options, defaults) =>
  [options, ...defaults].reduce(
    (all, o) => ({
      ...o,
      ...all,
      endpoints: { ...(o || {}).endpoints, ...(all || {}).endpoints },
    }),
    {}
  )

export class Oauth2Scheme {
  constructor($auth, options, ...defaults) {
    this.$auth = $auth
    this.options = merge(options, defaults)
    this.name = this.options.name
  }

  login(options) {
    return { oauth2: 'login', options }
  }

  logout() {
    return { oauth2: 'logout' }
  }
}

export class RefreshScheme {
  // The real one takes ($auth, options) and drops anything more, unlike
  // Oauth2Scheme. A mock that accepted more hid a scheme that relied on it.
  constructor($auth, options) {
    this.$auth = $auth
    this.options = merge(options, [])
    this.name = this.options.name
  }

  login(endpoint, options) {
    return { refresh: 'login', endpoint, options }
  }

  logout() {
    return { refresh: 'logout' }
  }
}
