---
'druxt-auth': patch
---

Send the browser to whichever authorize URL the session can reach. Signing in with credentials sets the Drupal session cookie on the site's own origin, so that flow uses the proxied path. Signing in on Drupal's own page keeps the backend URL, because Drupal's login form lives there.
