---
'druxt-auth': patch
---

Fixed the password grant route answering 500 for a grant named after an inherited property, such as `toString`, rather than refusing it.
