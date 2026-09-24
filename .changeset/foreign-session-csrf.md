---
'druxt-auth': patch
---

Send Drupal's CSRF token with the request that ends a foreign session. A route a site points `sessionLogout` at is protected the way core protects its writes, so without the `X-CSRF-Token` header it answers 403, the sign in is refused, and nothing in the failure names the cause. The token route is configurable, and a route that takes no token sets it to null.
