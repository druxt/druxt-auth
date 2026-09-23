---
'druxt-auth': minor
---

The authorization code strategy can sign in with credentials. `loginWith('drupal-authorization_code', { credentials })` signs in through Drupal's JSON login before the authorize step, so a consumer that approves automatically returns without showing a Drupal page. `logout()` ends that Drupal session, and `resetPassword()` asks Drupal for a reset email.
