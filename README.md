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
    ['druxt-auth', {
      clientId: '[DRUPAL_CONSUMER_CLIENT_ID]',
      clientSecret: '[DRUPAL_CONSUMER_SECRET]',
    }]
  ],
  druxt: {
    baseUrl: 'https://demo-api.druxtjs.org'
  },
}
```

_Note:_ Use `modules`, not `buildModules`: this module registers the
authentication endpoints and proxy at runtime, and `buildModules` are not
loaded by `nuxt start`, so authentication would silently stop working in
production while the dev server looks fine.

_Note:_ Replace `[DRUPAL_CONSUMER_CLIENT_ID]` and `[DRUPAL_CONSUMER_SECRET]` with the details from the consumer created in the following step. With Simple OAuth 6 this is the consumer's **Client ID** field, not its UUID.

### Drupal

1. Download, install and setup the [Simple OAuth module](https://www.drupal.org/project/simple_oauth).

2. **Simple OAuth 6.x only:** create an OAuth2 scope
   (`/admin/config/people/simple_oauth/oauth2_scope/dynamic`). Simple OAuth 6
   ships without any scopes, and it rejects every authorization request -
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
          is the default when the frontend sends no scope of its own, which
          is what DruxtAuth does unless the `scope` option is set_
        - Redirect URI: `[FRONTEND_URL]/callback` (e.g., `http://localhost:3000/callback`)

    - **Password** grant:
        - New Secret: _provide a secure secret_
        - Is Confidential: _checked_
        - Redirect URI: `[FRONTEND_URL]/callback` (e.g., `http://localhost:3000/callback`)

## Usage

The DruxtAuth module installs and configures the **nuxt/auth** module for your Druxt site.

It adds two auth strategies  that can be used via the `$auth` plugin:
- `drupal-authorization_code`  
  ```js
  this.$nuxt.$auth.loginWith('drupal-authorization_code')
  ```

- `drupal-password`
  ```js
  this.$nuxt.$auth.loginWith('drupal-password', {
    data: {
      username: '',
      password: ''
    }
  })
  ```

  _Note:_ Nuxt must be running in SSR mode for password grant, and client secret must be set.


- See the **nuxt/auth** documentation form more details: https://auth.nuxtjs.org/api/auth


## Options

| Option | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `clientId` | `string` | Yes | `undefined` | The Drupal Consumer UUID |
| `clientSecret` | `string` | No | `undefined` | The Drupal Consumer API secret. Required for Password grant. |
| `scope` | `array` | No | `undefined` | The OAuth scopes to request. When unset, the request carries an empty `scope` and Simple OAuth 6 falls back to the consumer's own **Authorization code scopes** - so either set this option or configure scopes on the consumer. |
