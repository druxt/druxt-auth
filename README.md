# DruxtAuth

[![npm](https://badgen.net/npm/v/druxt-auth)](https://www.npmjs.com/package/druxt-auth)
[![CI](https://github.com/druxt/druxt-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/druxt/druxt-auth/actions/workflows/ci.yml)
[![Known Vulnerabilities](https://snyk.io/test/github/druxt/druxt-auth/badge.svg?targetFile=package.json)](https://snyk.io/test/github/druxt/druxt-auth?targetFile=package.json)
[![codecov](https://codecov.io/gh/druxt/druxt-auth/branch/develop/graph/badge.svg)](https://codecov.io/gh/druxt/druxt-auth)

> Druxt Authentication with Drupal Simple OAuth2 and nuxt/auth.

## Links

- DruxtJS: https://druxtjs.org
- Community Discord server: https://discord.druxtjs.org

## Install

`$ npm install druxt-auth`

### Nuxt.js

Add module to `nuxt.config.js`

```js
module.exports = {
  modules: [
    'druxt',
    [
      'druxt-auth',
      {
        clientId: '[DRUPAL_CONSUMER_CLIENT_ID]',
        clientSecret: '[DRUPAL_CONSUMER_SECRET]',
      },
    ],
  ],
  druxt: {
    baseUrl: 'https://demo-api.druxtjs.org',
  },
}
```

_Note:_ Use `modules`, not `buildModules`: this module registers the
authentication endpoints and proxy at runtime, and `buildModules` are not
loaded by `nuxt start`, so authentication would silently stop working in
production while the dev server looks fine.

_Note:_ replace `[DRUPAL_CONSUMER_CLIENT_ID]` and `[DRUPAL_CONSUMER_SECRET]` with the details from the consumer created in the following step. With Simple OAuth 6 this is the consumer's **Client ID** field, not its UUID.

### Drupal

1. Download, install and setup the [Simple OAuth module](https://www.drupal.org/project/simple_oauth).

2. **Simple OAuth 6.x only:** create an OAuth2 scope
   (`/admin/config/people/simple_oauth/oauth2_scope/dynamic`). Simple OAuth 6
   has no scopes configured, and it rejects every authorization request -
   with or without a `scope` parameter - until one exists that the request
   can resolve:

   - Grant types: enable at least **Authorization code**
   - Granularity: e.g. **Role** with the `authenticated` role

3. Create a Consumer depending on your desired authorization strategy:

   - **Authorization Code** grant:

     - Client ID: _a unique ID of your choosing - this is the `clientId`
       the frontend sends (Simple OAuth 6 looks consumers up by this
       field, not by UUID)_
     - New Secret: _leave this empty_
     - Is Confidential: _unchecked_
     - Use PKCE?: _checked_
     - Grant types: _enable **Authorization code** (and **Refresh token**
       for session renewal)_
     - Authorization code scopes: _the scope from the previous step. This
       is the default when the frontend does not send a scope of its own, which
       is what DruxtAuth does unless the `scope` option is set_
     - Redirect URI: `[FRONTEND_URL]/callback` (e.g., `http://localhost:3000/callback`)

   - **Password** grant:
     - New Secret: _provide a secure secret_
     - Is Confidential: _checked_
     - Redirect URI: `[FRONTEND_URL]/callback` (e.g., `http://localhost:3000/callback`)

4. **Authorization Code grant only:** give the role your users hold the
   **Grant OAuth2 codes** permission (`grant simple_oauth codes`). Without it
   the consent screen returns to itself with
   `The 'grant simple_oauth codes' permission is required.` and no login
   completes. User 1 bypasses permission checks, so test with a normal
   account.

## Usage

The DruxtAuth module installs and configures the **nuxt/auth** module for your Druxt site.

It adds two auth strategies that can be used via the `$auth` plugin:

- `drupal-authorization_code`

  ```js
  this.$nuxt.$auth.loginWith('drupal-authorization_code')
  ```

- `drupal-password`

  ```js
  this.$nuxt.$auth.loginWith('drupal-password', {
    data: {
      username: '',
      password: '',
    },
  })
  ```

  _Note:_ nuxt must be running in SSR mode for password grant, and client secret must be set.

- See the **nuxt/auth** documentation form more details: https://auth.nuxtjs.org/api/auth

## Sessions

Sessions renew on their own, with no application code. Both strategies store
a refresh token when the backend issues one, and **nuxt/auth** puts an
interceptor on the shared `$axios` instance: a request made with an expired
access token triggers a `refresh_token` grant first, then goes out with the
new token. That covers DruxtClient requests too, because Druxt shares the
same instance.

| Situation                                   | What happens                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Access token expires while the page is open | The next request refreshes it, silently                                                   |
| Page reloaded with an expired access token  | The tokens are in cookies, so the server render refreshes and the page hydrates logged in |
| Refresh token expired or rejected           | The session resets and the request is aborted with `ExpiredAuthSessionError`              |
| No refresh token stored                     | The request goes out with the expired token, and the backend refuses it                   |

Both of the following apply:

- The backend must issue refresh tokens: enable the **Refresh token** grant
  on both the consumer and the scope.
- **nuxt/auth** assumes a refresh token lives 30 days, because Simple OAuth's
  refresh tokens are opaque and carry no expiry to read. A consumer with a
  shorter lifetime (14 days is the usual default) rejects the refresh
  in between, which ends the session mid-request. Match the two, or expect
  a login prompt at the consumer's lifetime rather than at 30 days.
- Setting `druxt.axios` gives the DruxtClient its own axios instance, which
  the interceptor never sees. Attach the token yourself in that case.

## Logging out

`$auth.logout()` ends the frontend session and nothing else. Simple OAuth
does not serve a revocation endpoint, so the tokens it issued stay valid until they
expire, and the refresh token can still mint new access tokens for its whole
lifetime. Spending them at logout needs a revocation route on the Drupal side
([issue 2945273](https://www.drupal.org/project/simple_oauth/issues/2945273)
carries a patch), called through the Nuxt proxy so it shares the frontend
origin.

It also leaves its own storage keys behind, in both cookies and localStorage,
holding the string `"false"`. The keys are named for the strategy, so
`auth._token.drupal-authorization_code`, not `auth._token.druxt`.

`example/nuxt/pages/user/logout.vue` is a logout page that clears them and
forces a full page load, which is also what empties the DruxtStore of content
fetched while logged in.

## Options

| Option         | Type     | Required | Default     | Description                                                                                                                                                                                                                    |
| -------------- | -------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientId`     | `string` | Yes      | `undefined` | The Drupal Consumer UUID                                                                                                                                                                                                       |
| `clientSecret` | `string` | No       | `undefined` | The Drupal Consumer API secret. Required for Password grant.                                                                                                                                                                   |
| `scope`        | `array`  | No       | `undefined` | The OAuth scopes to request. When unset, the request sends an empty `scope` and Simple OAuth 6 falls back to the consumer's own **Authorization code scopes** - so either set this option or configure scopes on the consumer. |
