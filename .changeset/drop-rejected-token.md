---
'druxt-auth': patch
---

A token Drupal rejects no longer breaks public pages. When it can't be refreshed, the session ends and the request is repeated anonymously, so the visitor can read the site and sign in again.
