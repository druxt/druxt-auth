// Stands in for @nuxtjs/auth-next's runtime, which only exists in a Nuxt build.
export class Oauth2Scheme {
  constructor ($auth, options, ...defaults) {
    this.$auth = $auth
    this.options = [options, ...defaults].reduce((all, o) => ({
      ...o,
      ...all,
      endpoints: { ...(o || {}).endpoints, ...(all || {}).endpoints },
    }), {})
    this.name = this.options.name
  }

  login (options) {
    return { oauth2: 'login', options }
  }

  logout () {
    return { oauth2: 'logout' }
  }
}
