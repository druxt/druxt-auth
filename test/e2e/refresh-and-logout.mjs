/**
 * End-to-end check of session renewal and logout against a real backend.
 *
 * The jest suites pin the same behaviour against the scheme's own code; this
 * one proves it through a browser, a real Drupal login and a real Simple
 * OAuth consumer, because the interesting failures (a consent permission, a
 * refresh the backend rejects, a token that outlives the logout) only exist
 * on the far side of the network.
 *
 * Not part of `yarn test`: it needs a running stack.
 *
 *   npm install playwright && npx playwright install chromium
 *   node test/e2e/refresh-and-logout.mjs
 *
 * Environment:
 *   FRONTEND   Nuxt origin, default http://localhost:3000
 *   BACKEND    Drupal origin, default http://127.0.0.1:8888
 *   CLIENT_ID  the consumer's client_id (required for the logout checks)
 *   USERNAME   Drupal account to log in as, default druxttest
 *   PASSWORD   its password, default druxttest-pass
 *   STRATEGY   default drupal-authorization_code
 *
 * The account needs the `grant simple_oauth codes` permission. Without it the
 * consent form returns to itself with an error, and no login completes. User
 * 1 bypasses permissions, so test with a normal account.
 */

const FRONTEND = process.env.FRONTEND || 'http://localhost:3000'
const BACKEND = process.env.BACKEND || 'http://127.0.0.1:8888'
const CLIENT_ID = process.env.CLIENT_ID
const USERNAME = process.env.USERNAME || 'druxttest'
const PASSWORD = process.env.PASSWORD || 'druxttest-pass'
const STRATEGY = process.env.STRATEGY || 'drupal-authorization_code'

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('playwright is not installed. npm install playwright && npx playwright install chromium')
  process.exit(2)
}

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

/** Every OAuth and JSON:API call the browser makes, with the grant type. */
const calls = []
context.on('request', (request) => {
  const url = request.url()
  if (!/\/oauth\/(token|userinfo)|\/jsonapi/.test(url)) return
  let body = null
  try { body = request.postData() } catch { /* no body */ }
  calls.push({
    method: request.method(),
    url: url.split('?')[0],
    grant: (/grant_type=([^&]+)/.exec(body || '') || [])[1] || null,
  })
})

const state = () => page.evaluate(() => {
  const auth = window.$nuxt.$auth
  return {
    loggedIn: auth.loggedIn,
    user: auth.user && (auth.user.name || auth.user.preferred_username),
    token: auth.strategy.token.get() || null,
    refreshToken: auth.strategy.refreshToken.get() || null,
    tokenExpiry: auth.strategy.token._getExpiration(),
    refreshExpiry: auth.strategy.refreshToken._getExpiration(),
  }
})

/**
 * Expire the access token the way the app stores it.
 *
 * Writing localStorage alone does nothing: getUniversal reads state, then the
 * cookie, then localStorage, so the cookie wins. _setExpiration writes all
 * three.
 */
const expireAccessToken = () => page.evaluate(
  () => window.$nuxt.$auth.strategy.token._setExpiration(Date.now() - 60000),
)

const login = async () => {
  await page.goto(`${FRONTEND}/user/login`, { waitUntil: 'networkidle' })
  if (page.url().startsWith(BACKEND) && page.url().includes('/user/login')) {
    await page.fill('#edit-name', USERNAME)
    await page.fill('#edit-pass', PASSWORD)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('#edit-submit'),
    ])
  }
  if (page.url().includes('/oauth/authorize')) {
    const allow = await page.$('input[value="Allow"], button[value="Allow"]')
    if (!allow) throw new Error(`No consent button at ${page.url()}`)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      allow.click(),
    ])
  }
  await page.waitForTimeout(2500)
  if (page.url().includes('/oauth/authorize')) {
    const message = await page.$eval('body', (el) => el.innerText).catch(() => '')
    const error = /The '[^']+' permission is required\./.exec(message)
    throw new Error(error ? error[0] : `Login did not complete: ${page.url()}`)
  }
}

try {
  // Login
  await login()
  let session = await state()
  check('a real login completes and the session holds both tokens',
    !!(session.loggedIn && session.token && session.refreshToken),
    `user ${session.user}`)
  check('the access token expiry comes from the token itself',
    session.tokenExpiry > Date.now() && session.tokenExpiry < Date.now() + 24 * 3600 * 1000,
    `${Math.round((session.tokenExpiry - Date.now()) / 1000)}s`)
  check('the refresh token expiry is the scheme default, which the backend never sees',
    Math.round((session.refreshExpiry - Date.now()) / 86400000) === 30,
    `${((session.refreshExpiry - Date.now()) / 86400000).toFixed(1)} days stored`)

  // Case A: warm session
  const before = session.token
  calls.length = 0
  await expireAccessToken()
  await page.evaluate(() => window.$nuxt.$auth.fetchUser())
  await page.waitForTimeout(2500)
  session = await state()
  check('A. a warm session refreshes on the next request',
    session.loggedIn && session.token !== before
      && calls.some((c) => c.grant === 'refresh_token'),
    calls.map((c) => `${c.method} ${c.url.replace(BACKEND, '')}${c.grant ? ` (${c.grant})` : ''}`).join(', '))

  // Case C: the Druxt data path
  const beforeData = session.token
  calls.length = 0
  await expireAccessToken()
  const data = await page.evaluate(async () => {
    try {
      const response = await window.$nuxt.$axios.get('/jsonapi/node/page')
      return `ok ${response.status}`
    } catch (error) { return `err ${error.message}` }
  })
  await page.waitForTimeout(2000)
  session = await state()
  check('C. a DruxtClient request refreshes too',
    session.loggedIn && session.token !== beforeData && data.startsWith('ok'),
    data)

  // Case B: cold reload
  const beforeReload = session.token
  calls.length = 0
  await expireAccessToken()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  session = await state()
  check('B. a cold reload restores the session',
    session.loggedIn && !!session.user && session.token !== beforeReload,
    calls.length ? 'refreshed in the browser' : 'refreshed during the server render')

  // Case D: refresh token expired in storage
  await page.evaluate(() => {
    window.$nuxt.$auth.strategy.token._setExpiration(Date.now() - 60000)
    window.$nuxt.$auth.strategy.refreshToken._setExpiration(Date.now() - 60000)
  })
  calls.length = 0
  const expired = await page.evaluate(async () => {
    try {
      const response = await window.$nuxt.$axios.get('/jsonapi/node/page')
      return `ok ${response.status}`
    } catch (error) { return `err ${error.message}` }
  })
  session = await state()
  check('D. an expired refresh token ends the session without a request',
    !session.loggedIn && expired.startsWith('err') && calls.length === 0,
    expired)

  // Logout, and what the backend still accepts afterwards
  await login()
  session = await state()
  const carried = { token: session.token, refresh: session.refreshToken }
  calls.length = 0
  await page.evaluate(() => window.$nuxt.$auth.logout())
  await page.waitForTimeout(1500)
  const residue = await page.evaluate(() => {
    const out = { cookies: {}, local: {} }
    document.cookie.split(';').map((c) => c.trim()).filter((c) => c.startsWith('auth.'))
      .forEach((c) => { out.cookies[c.split('=')[0]] = decodeURIComponent(c.split('=')[1] || '') })
    Object.keys(localStorage).filter((key) => key.startsWith('auth.'))
      .forEach((key) => { out.local[key] = localStorage.getItem(key) })
    return out
  })
  check('logout calls nothing on the backend', calls.length === 0)
  check('logout leaves stale keys in cookies and localStorage',
    Object.keys(residue.cookies).length > 0 && Object.keys(residue.local).length > 0,
    `${Object.keys(residue.cookies).length} cookies, ${Object.keys(residue.local).length} localStorage keys`)
  check('the stale keys are named for the strategy',
    Object.keys(residue.cookies).includes(`auth._token.${STRATEGY}`),
    Object.keys(residue.cookies).join(', '))

  const userinfo = await fetch(`${BACKEND}/oauth/userinfo`, { headers: { Authorization: carried.token } })
  check('the access token still works after logout', userinfo.status === 200,
    `HTTP ${userinfo.status} from /oauth/userinfo`)

  if (CLIENT_ID) {
    const renewed = await fetch(`${BACKEND}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: carried.refresh,
        client_id: CLIENT_ID,
      }),
    })
    const body = await renewed.json().catch(() => ({}))
    check('the refresh token still mints access tokens after logout',
      renewed.status === 200 && !!body.access_token,
      `HTTP ${renewed.status}`)
  } else {
    console.log('SKIP  refresh token after logout (set CLIENT_ID to run it)')
  }
} catch (error) {
  console.error(`\nAborted: ${error.message}`)
  await browser.close()
  process.exit(1)
}

await browser.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
