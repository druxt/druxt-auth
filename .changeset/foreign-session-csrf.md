---
'druxt-auth': patch
---

Fixed ending a session this module did not open, which needs Drupal's CSRF token to reach a `sessionLogout` route protected the way core protects its writes.
