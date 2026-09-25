---
'druxt-auth': patch
---

Fixed a site's `auth.strategies` entry for a built-in strategy replacing it outright, so naming one endpoint no longer drops the scheme, the client id and every other endpoint.
