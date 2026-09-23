---
'druxt-auth': minor
---

Keep the password grant, which Simple OAuth 6 moved into `simple_oauth_password_grant` rather than removing. The token request now leaves `client_secret` out when a site configures none, so a public Consumer can use the grant.
