---
'druxt-auth': patch
---

Forward only the password and refresh token grants to Drupal, with only the fields each one takes. The route attaches a confidential consumer's secret, and previously passed the caller's parameters through unchanged, so a request naming another grant or another `client_id` had that secret attached to it.
