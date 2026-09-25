---
'druxt-auth': minor
---

Added a `passwordSession` option, so the password grant also opens a Drupal session through the proxied login and `logout()` ends both, for a site that proxies Drupal's own pages and would otherwise see them anonymous.
