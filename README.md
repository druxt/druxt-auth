<!-- vale off -->
<!-- The alt text describes what the banner shows: the druxt-auth mark, name and description. The name-colon-description form trips ColonUsage. -->
<a href="https://druxtjs.org">
  <img src=".github/banner.svg" alt="druxt-auth: Authentication module for DruxtJS">
</a>
<!-- vale on -->

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

   - Grant types: enable **Authorization code**, and **Refresh token**
     too if you want sessions to renew. The refresh grant revalidates the
     scope it carries, so a scope without it fails renewal
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

  With credentials, it signs in through Drupal's JSON login first, so the
  authorize step finds a session and returns without showing a Drupal page.
  `logout()` ends that Drupal session too, and `resetPassword()` asks Drupal
  to email a reset link:

  ```js
  await this.$auth.loginWith('drupal-authorization_code', {
    credentials: { name: '', pass: '' },
  })
  await this.$auth.strategy.resetPassword('editor@example.com')
  ```

  `resetPassword()` treats a value with an `@` as an address. A Drupal
  username may contain `@`, so name the field for those accounts:

  ```js
  await this.$auth.strategy.resetPassword('editor@example.com', 'name')
  ```

  _Note:_ The session cookie must reach the authorize request, which needs
  the browser to see the login and the authorize step on one site:

  | Setup                                       | Credentials                                                                                                                                                                                                                                |
  | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Nuxt server proxying Drupal, on any servers | Works, and `druxt: { proxy: { api: true } }` sets it up. The module proxies `/user/login`, `/user/logout`, `/user/password`, `/oauth/authorize`, `/oauth/token` and `/session/token`, and points the `authorization` endpoint at the site. |
  | Subdomains of one domain, no proxy          | Point the endpoints at Drupal's absolute URLs, and allow credentials for the frontend's origin in Drupal's CORS.                                                                                                                           |
  | Different domains, no proxy                 | Not supported: the session cookie would be a third-party cookie. Call `loginWith` without credentials, which redirects to Drupal's login page as before.                                                                                   |

  `/user/login` is proxied for POST alone, which is the verb Drupal's JSON
  login answers on. A GET reaches the frontend, so a login page at that path
  still renders.

  The Consumer must approve automatically, or the authorize step shows
  Drupal's consent page.

  A Drupal session already open in the browser refuses these credentials,
  rather than signing the visitor in as whoever left it there. A session this
  module opened is ended and the sign in retried, so an abandoned
  authorisation does not lock anyone out. Any other session is refused, and
  the error has `sessionInUse` set so a form can say why.

  Drupal core cannot end a session it did not issue a logout token for. Add a
  route to the backend that can, point `sessionLogout` at it, and that session
  is ended instead of refused. Writing the route is the site's job:

  ```js
  auth: {
    strategies: {
      'drupal-authorization_code': {
        endpoints: {
          // The route, and the verb it answers on.
          sessionLogout: '/your/route',
          sessionLogoutMethod: 'post',
          // Where the CSRF token comes from. Core's own route, on every
          // Drupal. Set this to null for a route that takes no token.
          csrfToken: '/session/token',
        },
      },
    },
  }
  ```

  The module reads a token from `csrfToken` and sends it as `X-CSRF-Token`. A
  route protected the way core protects its writes requires that header, and
  answers 403 without it.

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

## Signing in

The module adds a `/user/login` page with a sign in form:

```vue
<DruxtAuthLogin />
```

Put it wherever you like instead:

```vue
<DruxtAuthLogin redirect="/account" />
```

The form matches what the strategy can do. On the `drupal-authorization_code`
strategy it asks for a username and password and signs in without sending the
visitor to Drupal. On a strategy that cannot take credentials it renders a
button that starts the redirect instead.

The credentials form needs two conditions. Drupal must be
same origin with the frontend, because the session cookie has to reach
`/oauth/authorize`, so use the API proxy above. The Consumer must also have
**Automatically authorize this client** set, or Drupal shows its own consent
page and the visitor leaves the site.

Style it with your own CSS. Give the inputs a font size of at least 16px at
coarse pointers, or iOS zooms the page when one takes focus.

The proxy and this page share the `/user/login` path and do not collide. The
module proxies that path for POST alone, which is what Drupal's JSON login
answers on, so a GET reaches this page.

A component that replaces the form receives the username and password, since
it renders the fields. Treat an override the way you would treat any code
handling a password.

### Replacing it

Add your own `pages/user/login.vue` and the module leaves the route alone,
so upgrading changes nothing for a site that already has a login page.

To theme the form rather than replace the page, add a component named after
the strategy, or `DruxtAuthLoginDefault` for all of them:

```vue
<!-- components/DruxtAuthLoginDrupalAuthorizationCode.vue -->
<template>
  <form @submit.prevent="submit">
    <p v-if="error">{{ error }}</p>
    <input v-model="credentials.name" />
    <input v-model="credentials.pass" type="password" />
    <button :disabled="busy">Sign in</button>
  </form>
</template>

<script>
export default {
  props: ['busy', 'capabilities', 'credentials', 'error', 'reset', 'submit', 'resetPassword'],
}
</script>
```

## Options

| Option         | Type               | Required | Default       | Description                                                                                                                                                                                                              |
| -------------- | ------------------ | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientId`     | `string`           | Yes      | `undefined`   | The Drupal Consumer's **Client ID** field, not its UUID                                                                                                                                                                  |
| `clientSecret` | `string`           | No       | `undefined`   | The Drupal Consumer API secret. Required for Password grant.                                                                                                                                                             |
| `login`        | `string`/`boolean` | No       | `/user/login` | Where the sign in page goes. `false` leaves it out. A page the site already has always wins.                                                                                                                             |
| `scope`        | `array`            | No       | `undefined`   | The OAuth scopes to request. When unset, no `scope` parameter is sent and Simple OAuth 6 falls back to the consumer's own **Authorization code scopes** - so either set this option or configure scopes on the consumer. |
