/**
 * The paths a site's origin has to answer for Drupal, and where they go.
 *
 * Signing in with credentials puts a Drupal session cookie in the browser,
 * and it only reaches the requests that need it when Drupal answers on this
 * origin. The authorize step reads the cookie, the browser exchanges the
 * code for a token, and both strategies read the account from userinfo.
 *
 * @param {string} baseUrl - Drupal's own origin.
 * @returns {Array} `[context, options]` pairs, as http-proxy-middleware takes.
 */
export const proxyEntries = (baseUrl) => [
  ['/oauth/userinfo', { target: baseUrl }],
  // Proxied for POST alone. Drupal's JSON routes for all three are POST
  // (user.login.http, user.logout.http, user.pass.http), and a GET has to
  // reach whatever page sits at that path: the login page this module adds,
  // or a site's own logout and password pages. Proxying the GET sends the
  // visitor to Drupal's form and the page never renders.
  ...['/user/login', '/user/logout', '/user/password'].map((path) => [
    (candidate, req) => candidate === path && req.method === 'POST',
    { target: baseUrl },
  ]),
  // A browser redirect, so it carries a GET as well as the cookie.
  ['/oauth/authorize', { target: baseUrl }],
  // The browser exchanges the code for a token, so this has to answer on
  // the site's origin too. Drupal's is usually private.
  ['/oauth/token', { target: baseUrl }],
]
