---
'druxt-auth': patch
---

Point the `authorization` endpoint at the proxied path when `druxt.proxy.api` is set. Signing in with credentials sets the Drupal session cookie on the site's own origin, so an absolute authorize URL arrived at Drupal anonymous and was answered with Drupal's login form. A site that signs in on Drupal's own page wants the absolute URL and can still set it by overriding the strategy.
