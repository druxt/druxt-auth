---
'druxt-auth': patch
---

fix(#105): several server renders for one browser, such as tabs opening at once after Drupal revoked the visitor's access tokens, now recover with one refresh. Before, each render spent the same refresh token, Drupal accepted only the first, and the rest failed.
