---
'druxt-auth': patch
---

Move the example backend to Drupal 11 with Simple OAuth 6, matching the module template. The consumer now declares `grant_types` and a default scope, both of which Simple OAuth 6 requires and neither of which existed on 5.
