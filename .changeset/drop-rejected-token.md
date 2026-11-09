---
'druxt-auth': patch
---

A token Drupal rejects no longer breaks public pages. When the token endpoint refuses its refresh token, the session ends and the request is repeated anonymously, so the visitor can read the site and sign in again. A refresh that fails for another reason, such as a timeout, keeps the session.
