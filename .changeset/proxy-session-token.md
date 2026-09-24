---
'druxt-auth': patch
---

Fixed ending a foreign Drupal session failing under the proxy, because the CSRF token it fetches from `/session/token` was never proxied.
