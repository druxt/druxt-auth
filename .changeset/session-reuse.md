---
'druxt-auth': patch
---

Refuse to sign in with credentials when a Drupal session is already open in the browser. Drupal answers 403 rather than replacing the session, and carrying on into the authorize step issued a token for whoever left that session there, so on a shared browser one person was signed in as another.
