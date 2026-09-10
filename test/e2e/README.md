# End-to-end checks

`refresh-and-logout.mjs` drives a real browser through a real login and
answers the questions the unit tests can only answer about the module's own
code: does a session renew silently, and what survives a logout.

## What it needs

- A Drupal backend with `simple_oauth`, a public PKCE consumer whose grants
  include `refresh_token`, and a scope that enables the same.
- A Nuxt frontend running `druxt-auth`, with a route that calls
  `$auth.loginWith('drupal-authorization_code')` at `/user/login`.
- A Drupal account other than user 1, holding the
  `grant simple_oauth codes` permission. User 1 bypasses permission checks,
  so testing as the admin hides a consent step that fails for everyone else.
- Playwright: `npm install playwright && npx playwright install chromium`.

The [quickstart](https://github.com/druxt/quickstart) provides all of the
above once its backend and frontend are running.

## Running it

```sh
FRONTEND=http://localhost:3000 \
BACKEND=http://127.0.0.1:8888 \
CLIENT_ID=<the consumer's client_id> \
USERNAME=druxttest PASSWORD=druxttest-pass \
node test/e2e/refresh-and-logout.mjs
```

`CLIENT_ID` is optional; without it the script skips the check that exchanges
the logged-out refresh token. Exit code is 0 when every check passes.

## What it checks

| Check                                               | Why it matters                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| Login stores an access and a refresh token          | The refresh token is what makes silent renewal possible                          |
| Access token expiry comes from the token            | Simple OAuth issues JWTs, so the frontend knows the real expiry                  |
| Refresh token expiry is the scheme's 30-day default | The backend's own lifetime is usually shorter, and nothing reconciles them       |
| A warm session refreshes on the next request        | The shared axios interceptor renews before the request goes out                  |
| A DruxtClient request refreshes too                 | Druxt shares that axios instance unless `druxt.axios` is set                     |
| A cold reload restores the session                  | The tokens are in cookies, so the server render refreshes and hydrates logged in |
| An expired refresh token ends the session           | And does so without calling the backend                                          |
| Logout calls nothing                                | Simple OAuth has no revocation endpoint                                          |
| Logout leaves stale storage keys                    | Named for the strategy, in both cookies and localStorage                         |
| The old access token still works                    | Until it expires, on the backend's clock                                         |
| The old refresh token still mints tokens            | The reason a logout page should do more than `$auth.logout()`                    |
