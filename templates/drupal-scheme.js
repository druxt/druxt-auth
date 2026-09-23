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
    if (credentials) {
      await this.drupalLogin(credentials)
    }
    return super.login(options)
  }

  /**
   * Starts a Drupal session through its JSON login.
   *
   * A session that is already signed in answers 403, and is used as it is.
   *
   * @param {object} credentials - `{ name, pass }`.
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
    } catch (error) {
      const { status, data } = error.response || {}
      if (status === 403 && /anonymous users/i.test((data || {}).message || '')) {
        return
      }
      throw error
    }
  }

  /**
   * Ends the Drupal session too, when this scheme started one, then signs
   * out the way oauth2 does.
   */
  async logout () {
    const token = this.$auth.$storage.getUniversal(this.logoutTokenKey)
    if (token) {
      try {
        await this.$auth.request({
          method: 'post',
          baseURL: '',
          url: this.options.endpoints.drupalLogout,
          params: { token },
          withCredentials: true,
        })
      } catch (error) {
        // A session that has already ended is the outcome wanted.
      }
      this.$auth.$storage.removeUniversal(this.logoutTokenKey)
    }
    return super.logout()
  }

  /**
   * Asks Drupal to email a password reset link. Drupal answers the same
   * whether or not the address has an account.
   *
   * @param {string} mail - The address, or the account name.
   */
  async resetPassword (mail) {
    const body = /@/.test(mail) ? { mail } : { name: mail }
    await this.$auth.request({
      method: 'post',
      baseURL: '',
      url: this.options.endpoints.passwordReset,
      data: body,
      withCredentials: true,
    })
  }
}
