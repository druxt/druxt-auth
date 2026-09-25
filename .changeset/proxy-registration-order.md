---
'druxt-auth': patch
---

Fixed the proxy entries going unregistered when another Druxt module runs first, which left the sign-in failing after Drupal had already issued the token.
