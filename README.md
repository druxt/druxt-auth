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
  buildModules: [
    'druxt',
    ['druxt-auth', {
      clientId: '[DRUPAL_CONSUMER_UUID]',
      clientSecret: '[DRUPAL_CONSUMER_SECRET]',
      scope: ['default'],
    }]
  ],
  druxt: {
    baseUrl: 'https://demo-api.druxtjs.org'
  },
}
```

_Note:_ Replace `[DRUPAL_CONSUMER_UUID]` and `[DRUPAL_CONSUMER_SECRET]` with the details from the consumer created in the following step.

### Drupal

1. Download, install and setup the [Simple OAuth module](https://www.drupal.org/project/simple_oauth).
2. Create a Consumer depending on your desired authorization strategy:

    - **Authorization Code** grant:
        - New Secret: _leave this empty_
        - Is Confidential: _unchecked_
        - Use PKCE?: _checked_
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
| `scope` | `array` | No | `undefined` | The OAuth Scopes to be used for the Drupal Consumer. |
