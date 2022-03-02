# DruxtAuth

[![npm](https://badgen.net/npm/v/druxt-auth)](https://www.npmjs.com/package/druxt-auth)
[![CircleCI](https://circleci.com/gh/druxt/druxt-auth.svg?style=svg)](https://circleci.com/gh/druxt/druxt-auth)
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
  buildModules: ['druxt-auth'],
  druxt: {
    baseUrl: 'https://demo-api.druxtjs.org',
    auth: {
      clientId: '[DRUPAL_CONSUMER_UUID]'
    },
  },
}
```

_Note:_ Replace `[DRUPAL_CONSUMER_UUID]` with the UUID of the consumer created in the following step.

### Drupal

1. Download, install and setup the [Simple OAuth module](https://www.drupal.org/project/simple_oauth).
2. Create a Consumer with:
    - New Secret: _leave this empty_
    - Is Confidential: _unchecked_
    - Use PKCE?: _checked_
    - Redirect URI: `[FRONTEND_URL]/callback` (e.g., `http://localhost:3000/callback`)

## Usage

The DruxtAuth module installs and configures the **nuxt/auth** module for your Druxt site.

It adds a `drupal-authorization_code` auth strategy that can be used via the `$auth` plugin:

```js
this.$nuxt.$auth.loginWith('drupal-authorization_code')
```

- See the **nuxt/auth** documentation form more details: https://auth.nuxtjs.org/api/auth


## Options

| Option | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `druxt.auth.cliendId` | `string` | Yes | `undefined` | The Drupal Consumer UUID |
