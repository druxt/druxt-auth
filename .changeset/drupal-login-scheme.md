---
'druxt-auth': minor
---

Added credential sign-in to the authorization code strategy, so `loginWith('drupal-authorization_code', { credentials })` signs a visitor in without showing Drupal's login page, alongside `logout()` and `resetPassword()`.
