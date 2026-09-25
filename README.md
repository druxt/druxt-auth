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
        // Only for the password grant, and only a confidential Consumer.
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

   - **Password** grant (needs the `simple_oauth_password_grant` module):
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

The module installs and configures **nuxt/auth**, and adds two strategies.

### Authorization code

```js
this.$nuxt.$auth.loginWith('drupal-authorization_code')
```

That sends the visitor to Drupal to sign in. To keep them on the site, pass
credentials, which signs in through Drupal's JSON login first:

```js
await this.$auth.loginWith('drupal-authorization_code', {
  credentials: { name: '', pass: '' },
})
```

That call sends the browser to the authorize step, so nothing after it runs on
success. Resetting a password is its own action:

```js
await this.$auth.strategy.resetPassword('editor@example.com')
```

`resetPassword()` reads a value containing `@` as an address. Pass `'name'` as
a second argument for a username that contains one.

Credentials need Drupal on the same origin as the frontend, because the
session cookie has to reach the authorize request:

| Setup                    | Credentials                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Nuxt proxying Drupal     | Works. Set `druxt: { proxy: { api: true } }` and the module proxies the session paths for you.                  |
| Subdomains of one domain | Point the endpoints at Drupal's absolute URLs, and allow credentials for the frontend in Drupal's CORS.         |
| Different domains        | The session cookie would be third party, so call `loginWith` without credentials and let it redirect to Drupal. |

A Drupal session already open in the browser refuses these credentials, rather
than signing the visitor in as whoever left it there. A session this module
opened is ended and the sign in retried, so an abandoned authorisation does not
lock anyone out. The error has `sessionInUse` set, so a form can say why.

Drupal core cannot end a session it did not issue a logout token for. Add a
route to the backend that can, point `sessionLogout` at it, and that session is
ended instead of refused. Writing the route is the site's job:

```js
auth: {
  strategies: {
    'drupal-authorization_code': {
      endpoints: {
        // The route, and the verb it answers on.
        sessionLogout: '/your/route',
        sessionLogoutMethod: 'post',
        // Where the CSRF token comes from. Core's own route, on every Drupal.
        // Set this to null for a route that takes no token.
        csrfToken: '/session/token',
      },
    },
  },
}
```

The module reads a token from `csrfToken` and sends it as `X-CSRF-Token`. A
route protected the way core protects its writes requires that header, and
answers 403 without it.

The Consumer must also approve automatically, or Drupal shows its consent
page and the visitor leaves the site.

### Password

Simple OAuth 6 moved the password grant out of core. Install
[simple_oauth_password_grant](https://www.drupal.org/project/simple_oauth_password_grant)
and enable **Password** on the Consumer's grant types.

```js
this.$nuxt.$auth.loginWith('drupal-password', {
  data: { username: '', password: '' },
})
```

The credentials reach Drupal through this module's own server route, so the
site must run in SSR mode. Set `clientSecret` for a confidential Consumer. A
public one needs none.

A Consumer cannot be public and confidential at once, so a site running both
this and the browser flow needs two. Point `passwordClientId` at the second.

## The login page

The module adds a `/user/login` page with a sign in form:

```vue
<DruxtAuthLogin />
```

Put it anywhere, and send the visitor on afterwards:

```vue
<DruxtAuthLogin redirect="/account" />
```

The form matches the strategy. It asks for a username and password where the
strategy takes them, and renders a button that starts the redirect where it
does not.

Your own `pages/user/login.vue` wins, so nothing changes for a site that
already has one. Set `login` to a path to move the page, or to `false` to
leave it out.

To theme the form rather than replace the page, add a component named
`DruxtAuthLoginDefault`, or one named for the strategy:

```vue
<!-- components/DruxtAuthLoginDefault.vue -->
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

An override receives the username and password, so treat it as code handling
a password. Give the inputs a font size of at least 16px, or iOS zooms the
page when one takes focus.

## Sessions

Sessions renew on their own, with no application code, as long as the backend
issues refresh tokens. Enable the **Refresh token** grant on both the
consumer and the scope.

| Situation                                            | What happens                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Access token expires while the page is open          | The next request refreshes it, silently                                                   |
| Page reloaded with an expired access token           | The tokens are in cookies, so the server render refreshes and the page hydrates logged in |
| Drupal revokes the access token, as a user save does | The next request recovers the session with the refresh token, silently                    |
| Refresh token expired or rejected                    | The session resets and the request is aborted with `ExpiredAuthSessionError`              |
| No refresh token stored                              | The request goes out with the expired token, and the backend refuses it                   |

Watch for these:

- **nuxt/auth** assumes a refresh token lives 30 days, because Simple OAuth's
  are opaque and carry no expiry to read. A consumer with a shorter lifetime
  (14 days is the usual default) rejects the refresh in between. Match the
  two, or expect a login prompt at the consumer's lifetime.
- Setting `druxt.axios` gives the DruxtClient its own axios instance, which
  the interceptor never sees. Attach the token yourself in that case.

## Logging out

`$auth.logout()` ends the frontend session and nothing else. Simple OAuth
does not serve a revocation endpoint, so its tokens stay valid until they
expire.
Ending them needs a revocation route on the Drupal side, called through the
proxy ([issue 2945273](https://www.drupal.org/project/simple_oauth/issues/2945273)).

It also leaves its own storage keys behind, holding the string `"false"`,
named for the strategy rather than for druxt:
`auth._token.drupal-authorization_code`.

`example/nuxt/pages/user/logout.vue` clears them and forces a full page load,
which is what empties the DruxtStore of content fetched while logged in.

## Options

| Option             | Type               | Required | Default       | Description                                                                                                                                                                                                              |
| ------------------ | ------------------ | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `clientId`         | `string`           | Yes      | `undefined`   | The Drupal Consumer's **Client ID** field, not its UUID                                                                                                                                                                  |
| `passwordClientId` | `string`           | No       | `clientId`    | The Consumer the password grant authenticates as, when it differs from the browser flow's.                                                                                                                               |
| `clientSecret`     | `string`           | No       | `undefined`   | The Drupal Consumer API secret. The password grant sends it, and a public Consumer needs none.                                                                                                                           |
| `login`            | `string`/`boolean` | No       | `/user/login` | Where the sign in page goes. `false` leaves it out. A page the site already has always wins.                                                                                                                             |
| `scope`            | `array`            | No       | `undefined`   | The OAuth scopes to request. When unset, no `scope` parameter is sent and Simple OAuth 6 falls back to the consumer's own **Authorization code scopes** - so either set this option or configure scopes on the consumer. |
