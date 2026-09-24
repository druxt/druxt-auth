---
'druxt-auth': patch
---

Prevented a credential sign-in while another Drupal session is open in the browser, which used to issue a token for whoever left that session there.
