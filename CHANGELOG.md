# druxt-auth

## 0.5.0

### Minor Changes

- Added recovery for a session whose access tokens Drupal revoked on a user save. ([`3909080`](https://github.com/druxt/druxt-auth/commit/3909080))
- Added credential sign-in to the authorization code strategy, so `loginWith('drupal-authorization_code', { credentials })` signs a visitor in without showing Drupal's login page, alongside `logout()` and `resetPassword()`. ([`e75fd43`](https://github.com/druxt/druxt-auth/commit/e75fd43))
- Added a login page at `/user/login` and a `DruxtAuthLogin` component, which a site overrides by dropping its own component of that name into `components/`. ([`1bbe2a3`](https://github.com/druxt/druxt-auth/commit/1bbe2a3))
- Added support for the password grant through `simple_oauth_password_grant`, and for a public Consumer, by leaving `client_secret` out when a site configures none. ([`489cad5`](https://github.com/druxt/druxt-auth/commit/489cad5))
- Added a `passwordSession` option, so the password grant also opens a Drupal session through the proxied login and `logout()` ends both, for a site that proxies Drupal's own pages and would otherwise see them anonymous. ([`77dddb8`](https://github.com/druxt/druxt-auth/commit/77dddb8))

### Patch Changes

- Fixed a sign-in proceeding on an answer that never came from Drupal, which let a page at the login path pass as valid credentials. ([`e75fd43`](https://github.com/druxt/druxt-auth/commit/e75fd43))
- Fixed ending a session this module did not open, which needs Drupal's CSRF token to reach a `sessionLogout` route protected the way core protects its writes. ([`e75fd43`](https://github.com/druxt/druxt-auth/commit/e75fd43))
- Fixed the password grant route forwarding whatever grant and Consumer a caller named, along with the confidential Consumer's secret. ([`489cad5`](https://github.com/druxt/druxt-auth/commit/489cad5))
- Fixed the password grant route answering 500 for a grant named after an inherited property, such as `toString`, rather than refusing it. ([`489cad5`](https://github.com/druxt/druxt-auth/commit/489cad5))
- Fixed the password grant route answering 500 for every failure, rather than the status Drupal gave. ([`489cad5`](https://github.com/druxt/druxt-auth/commit/489cad5))
- Fixed the authorize URL the browser is sent to, which has to be the proxied path after a credential sign-in and Drupal's own after its login form. ([`e75fd43`](https://github.com/druxt/druxt-auth/commit/e75fd43))
- Fixed the proxy entries going unregistered when another Druxt module runs first, which left the sign-in failing after Drupal had already issued the token. ([`6234154`](https://github.com/druxt/druxt-auth/commit/6234154))
- Fixed ending a foreign Drupal session failing under the proxy, because the CSRF token it fetches from `/session/token` was never proxied. ([`6234154`](https://github.com/druxt/druxt-auth/commit/6234154))
- Fixed the token exchange being sent to Drupal's own origin from the browser, which cannot reach it when that origin is private, by proxying `/oauth/token` with the other endpoints. ([`6234154`](https://github.com/druxt/druxt-auth/commit/6234154))
- Prevented a credential sign-in while another Drupal session is open in the browser, which used to issue a token for whoever left that session there. ([`e75fd43`](https://github.com/druxt/druxt-auth/commit/e75fd43))
- Fixed a site's `auth.strategies` entry for a built-in strategy replacing it outright, so naming one endpoint no longer drops the scheme, the client id and every other endpoint. ([`709dd32`](https://github.com/druxt/druxt-auth/commit/709dd32))

## [0.4.0] - 2023-07-28

### Minor Changes

- Added support for OAuth Scopes / Simple OAuth2 6.x. ([#35](https://github.com/druxt/druxt-auth/issues/35), [`b07c40b`](https://github.com/druxt/druxt-auth/commit/b07c40b))

## [0.3.0] - 2023-02-17

### Minor Changes

- Added API Proxy support to the `/oauth/userinfo` endpoint. ([#27](https://github.com/druxt/druxt-auth/issues/27), [`a537e4d`](https://github.com/druxt/druxt-auth/commit/a537e4d))

## [0.2.0] - 2022-08-15

### Minor Changes

- Added support for password grant. ([#8](https://github.com/druxt/druxt-auth/issues/8), [`3ef518e`](https://github.com/druxt/druxt-auth/commit/3ef518e))

### Patch Changes

- Enabled the Nuxt Vuex store. ([`5bab97a`](https://github.com/druxt/druxt-auth/commit/5bab97a))

## [0.1.0] - 2022-03-02

### Minor Changes

- Added support for OAuth2 Authorization Code grant with PKCE. ([`f6a7352`](https://github.com/druxt/druxt-auth/commit/f6a7352))
- Initial release.

[0.4.0]: https://github.com/druxt/druxt-auth/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/druxt/druxt-auth/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/druxt/druxt-auth/compare/v0.1.0...0.2.0
[0.1.0]: https://github.com/druxt/druxt-auth/releases/tag/v0.1.0
