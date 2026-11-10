---
'druxt-auth': minor
---

feat(#103): signing in or out clears what Druxt has stored, so a visitor who signs out no longer sees content loaded while signed in, and one who signs in sees what the new session can. It dispatches Druxt's `druxt/clearCache`, available from Druxt 0.25.0, and a site turns it off with `clearCache: false`.
