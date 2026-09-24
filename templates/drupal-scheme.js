import { Oauth2Scheme } from '~auth/runtime'

/**
 * The authorization code grant, with a sign-in form of the site's own.
 *
 * Plain `oauth2` sends the browser to Drupal's authorize page, which sends an
 * anonymous visitor on to Drupal's login form. This scheme signs in first,
 * through Drupal's JSON login, so the authorize step finds a session and a
 * consumer set to approve automatically returns straight away: the visitor
 * never sees a Drupal page.
 *
 * The session cookie has to reach the authorize request, so both must be on
 * one origin. `druxt: { proxy: { api: true } }` arranges it: the module
 * proxies `/user/login`, `/user/logout`, `/user/password` and
 * `/oauth/authorize`, and points the `authorization` endpoint at the site.
 * The login path is proxied for POST alone, so a login page at that path
 * still renders. Without credentials, `login()` is `oauth2`'s own.
 */

const DEFAULTS = {
  name: 'drupal',
  endpoints: {
    drupalLogin: '/user/login?_format=json',
    drupalLogout: '/user/logout?_format=json',
    passwordReset: '/user/password?_format=json',
    // Unset: Drupal core has no route that ends a session it did not issue a
    // logout token for. A site that adds one points this at it.
    sessionLogout: null,
    // The verb that route answers on. POST because more routes accept it.
    sessionLogoutMethod: 'post',
    // Core's own, on every Drupal. A route protected the way core protects
    // its writes needs this header, and without it answers 403 with nothing
    // naming CSRF, which invites a site to remove the protection instead.
    // A route that needs no header can set this to null.
    csrfToken: '/session/token',
  },
}

export default class DrupalScheme extends Oauth2Scheme {
  constructor ($auth, options, ...defaults) {
    super($auth, options, ...defaults, DEFAULTS)
  }

  /** The storage key for the token Drupal's JSON logout wants. */
  get logoutTokenKey () {
    return this.name + '.logout_token'
  }

  /**
   * Signs in to Drupal with credentials when given them, then starts the
   * authorization code flow.
   *
   * @param {object} [options] - oauth2's login options, plus `credentials`.
   * @param {object} [options.credentials] - `{ name, pass }`.
   */
  async login ({ credentials, ...options } = {}) {
    const endpoints = this.options.endpoints

    if (credentials) {
      // Drupal refuses a second sign-in while a session is open, and that
      // session may not be ours. One this scheme opened is an authorisation
      // the visitor abandoned, so end it and sign in properly. Any other
      // belongs to whoever left it there, and carrying on would issue them a
      // token: on a shared browser, one person signed in as another.
      if (await this.drupalLogin(credentials)) {
        const refuse = () => {
          const error = new Error(
            'A Drupal session is already open in this browser. Sign out of it before signing in with credentials.'
          )
          // Flagged rather than matched on: a sign-in form has to tell this
          // apart from a network failure, and the message is not a contract.
          error.sessionInUse = true
          throw error
        }
        if (!(await this.drupalLogout())) {
          // A site whose backend can end a session it did not open points
          // `endpoints.sessionLogout` at that route. Drupal core cannot: its
          // JSON logout wants the token issued at login, which this never
          // had. Unset, the session stands and the credentials are refused.
          if (!(await this.endForeignSession())) refuse()
        }
        if (await this.drupalLogin(credentials)) refuse()
      }
    }

    // Where the browser goes to authorize depends on where the session was
    // just created. Credentials set the cookie on this origin through the
    // proxy, so the authorize request has to come from here too. Without
    // them Drupal shows its own login form, which is on Drupal's origin.
    endpoints.authorization =
      credentials && endpoints.authorizationSameOrigin
        ? endpoints.authorizationSameOrigin
        : endpoints.authorizationBackend || endpoints.authorization

    return super.login(options)
  }

  /**
   * Starts a Drupal session through its JSON login.
   *
   * Drupal answers 403 when a session already exists, and that session
   * belongs to whoever left it there rather than to whoever just submitted
   * these credentials. Reusing it would sign the second person in as the
   * first, so this reports the reuse and lets the caller refuse it.
   *
   * @param {object} credentials - `{ name, pass }`.
   * @returns {boolean} Whether an existing session answered instead.
   */
  async drupalLogin ({ name, pass }) {
    try {
      const { data } = await this.$auth.request({
        method: 'post',
        baseURL: '',
        url: this.options.endpoints.drupalLogin,
        data: { name, pass },
        withCredentials: true,
      })
      if (data && data.logout_token) {
        this.$auth.$storage.setUniversal(this.logoutTokenKey, data.logout_token)
      }
      return false
    } catch (error) {
      const { status, data } = error.response || {}
      if (status === 403 && /anonymous users/i.test((data || {}).message || '')) {
        return true
      }
      throw error
    }
  }

  /**
   * Ends the Drupal session too, when this scheme started one, then signs
   * out the way oauth2 does.
   */
  /**
   * Ends the Drupal session this scheme opened.
   *
   * Drupal issues the logout token at login, so holding one is what makes a
   * session ours to end. The token is only discarded once the session is
   * known to be gone: a request that failed for any other reason may have
   * left it alive, and the token is the only way back to it.
   *
   * @returns {boolean} Whether the session is now ended.
   */
  async drupalLogout () {
    const token = this.$auth.$storage.getUniversal(this.logoutTokenKey)
    if (!token) return false

    try {
      await this.$auth.request({
        method: 'post',
        baseURL: '',
        url: this.options.endpoints.drupalLogout,
        params: { token },
        withCredentials: true,
      })
    } catch (error) {
      // 403 is Drupal saying the session has already ended, which is the
      // outcome wanted. Anything else leaves it possibly alive.
      if (((error || {}).response || {}).status !== 403) return false
    }

    this.$auth.$storage.removeUniversal(this.logoutTokenKey)
    return true
  }

  /**
   * Ends a Drupal session this scheme did not open.
   *
   * Only a site that provides a route for it can do this, so the endpoint is
   * unset by default and the module ships nothing to serve it.
   *
   * @returns {boolean} Whether the session is now ended.
   */
  async endForeignSession () {
    const { sessionLogout, sessionLogoutMethod, csrfToken } =
      this.options.endpoints
    if (!sessionLogout) return false

    try {
      const headers = {}

      if (csrfToken) {
        const { data } = await this.$auth.request({
          method: 'get',
          baseURL: '',
          url: csrfToken,
          withCredentials: true,
        })
        headers['X-CSRF-Token'] = String(data).trim()
      }

      await this.$auth.request({
        method: sessionLogoutMethod || 'post',
        baseURL: '',
        url: sessionLogout,
        headers,
        withCredentials: true,
      })
      return true
    } catch (error) {
      return false
    }
  }

  async logout () {
    // Signing out locally happens either way. A Drupal session this could
    // not reach is not a reason to strand the visitor signed in here.
    await this.drupalLogout()
    return super.logout()
  }

  /**
   * Asks Drupal to email a password reset link. Drupal answers the same
   * whether or not the address has an account.
   *
   * A Drupal username may contain `@`, so the guess is wrong for those
   * accounts; name the field to look up when the caller knows it.
   *
   * @param {string} value - The address, or the account name.
   * @param {string} [identifier] - The field to look up, `mail` or `name`.
   */
  async resetPassword (value, identifier = /@/.test(value) ? 'mail' : 'name') {
    const body = { [identifier]: value }
    await this.$auth.request({
      method: 'post',
      baseURL: '',
      url: this.options.endpoints.passwordReset,
      data: body,
      withCredentials: true,
    })
  }
}
