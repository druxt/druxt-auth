---
'druxt-auth': patch
---

Require Drupal's own answer before a sign in proceeds. Any response without an HTTP error counted as a successful sign in, so where this request reached the site's own routes rather than Drupal, a rendered page was read as valid credentials and the authorize step ran against whatever session the browser already held. The answer now has to carry the account and a logout token, which only Drupal's JSON login returns.
