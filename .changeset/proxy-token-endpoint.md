---
'druxt-auth': patch
---

Fixed the token exchange being sent to Drupal's own origin from the browser, which cannot reach it when that origin is private, by proxying `/oauth/token` with the other endpoints.
