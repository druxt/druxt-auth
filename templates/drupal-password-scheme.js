import { RefreshScheme } from '~auth/runtime'
import { SESSION_ENDPOINTS, withDrupalSession } from './drupal-session'

/**
 * The password grant, with an optional Drupal session.
 *
 * The grant issues a token and nothing else: the credentials go to Drupal's
 * token endpoint through this module's server route, and no Drupal session
 * is opened. A frontend that talks to the API alone needs nothing more. One
 * that proxies Drupal's own pages does, because those pages read the session
 * cookie and nothing else, and without one every proxied screen is anonymous
 * however signed in the frontend looks.
 *
 * `session: true` opens the session too, through the proxied JSON login with
 * the same credentials, before the grant. Off by default: it needs
 * `/user/login` reaching Drupal on the site's origin, and it costs a request
 * a token-only site has no use for. Signing out ends both.
 */

const DEFAULTS = {
  name: 'drupal-password',
  session: false,
  endpoints: { ...SESSION_ENDPOINTS },
}

export default class DrupalPasswordScheme extends withDrupalSession(
  RefreshScheme
) {
  constructor ($auth, options, ...defaults) {
    super($auth, options, ...defaults, DEFAULTS)
  }

  /**
   * Signs in with the password grant, opening a Drupal session first when
   * the strategy asks for one.
   *
   * The session comes first so a refused sign-in leaves nothing behind:
   * wrong credentials fail here, and a session that belongs to someone else
   * is refused here, before Drupal is ever asked for a token.
   *
   * @param {object} endpoint - The request, with `data.username` and
   *   `data.password`, as `loginWith` passes it.
   */
  async login (endpoint = {}, options) {
    if (this.options.session) {
      const { username, password } = (endpoint || {}).data || {}
      // The grant names the fields `username` and `password`; Drupal's JSON
      // login names them `name` and `pass`. The caller sends the grant's.
      await this.openSession({ name: username, pass: password })
    }
    return super.login(endpoint, options)
  }

  /**
   * Ends the Drupal session too, when one was opened, then signs out the
   * way the refresh scheme does. Without a logout token there is nothing
   * to end and nothing is requested, so a token-only site pays nothing.
   */
  async logout (...args) {
    await this.drupalLogout()
    return super.logout(...args)
  }
}
