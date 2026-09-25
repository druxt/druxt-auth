/**
 * Revoked-token recovery, on the client and on the server render.
 *
 * Drupal revokes a user's access tokens whenever that user is saved
 * (`simple_oauth_user_update()` calls the expiry trigger unconditionally), so
 * an editor who saves their own profile comes back holding a token the
 * backend has deleted. Nothing about it looks expired, so only a 401 reveals
 * it, and only the refresh interceptor recovers from that.
 *
 * The case that matters is the server-rendered one. Saving a profile in
 * Drupal's admin is a full page, and returning to the site is another full
 * page load, so the recovery has to work during the render. A client-only
 * interceptor passes every client-side check and still signs the reader out
 * on the path they actually take.
 *
 * Companion to refresh-and-logout.mjs, which pins the client-side cases. This
 * one is the server render, so it is kept apart. Not part of `yarn test`: it
 * needs a running stack.
 *
 *   npm install playwright && npx playwright install chromium
 *   node test/e2e/revoked-token-ssr.mjs
 *
 * Environment:
 *   FRONTEND    the Nuxt origin, default http://localhost:3000
 *   DRUPAL_DIR  the Drupal root, where `vendor/bin/drush` lives, default
 *               example/drupal
 *   ACCOUNT_UID the uid to save, default 2
 *   USERNAME    default druxttest
 *   PASSWORD    its password, default druxttest-pass
 *   SEL_NAME/SEL_PASS/SEL_SUBMIT
 *               the login form's selectors, defaulting to the example's own
 *               login page. A site that renders its own form sets these.
 *
 * Saving the user is the real trigger and is what makes this an end-to-end
 * check rather than a client-side simulation: expiring the token in the
 * browser exercises the library's own refresh, not this recovery.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const FRONTEND = process.env.FRONTEND || 'http://localhost:3000'
const DRUPAL_DIR = process.env.DRUPAL_DIR || 'example/drupal'
const UID = process.env.ACCOUNT_UID || '2'
const USERNAME = process.env.USERNAME || 'druxttest'
const PASSWORD = process.env.PASSWORD || 'druxttest-pass'
const PAGE = process.env.PAGE || '/'
const SEL_NAME = process.env.SEL_NAME || 'input[name="name"]'
const SEL_PASS = process.env.SEL_PASS || 'input[name="pass"]'
const SEL_SUBMIT = process.env.SEL_SUBMIT || 'button[type="submit"]'
const OPEN = process.env.SEL_OPEN || null

// Absolute: execFileSync resolves a relative command against the process cwd,
// not its `cwd` option, so a DRUPAL_DIR-relative path would double up.
const drush = resolve(DRUPAL_DIR, 'vendor/bin/drush')
if (!existsSync(drush)) {
  console.error(
    `No drush at ${drush}: the revocation is a real user save, through drush.`
  )
  process.exit(2)
}

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`
  )
}

/** What Drupal does on every user save: revoke that user's access tokens. */
const revoke = () =>
  execFileSync(
    drush,
    [
      'php:eval',
      `$u = \\Drupal\\user\\Entity\\User::load(${UID}); $u->save();`,
    ],
    { cwd: DRUPAL_DIR, encoding: 'utf8', timeout: 120000 }
  )

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

const state = () =>
  page.evaluate(() => ({
    loggedIn: Boolean(window.$nuxt.$auth && window.$nuxt.$auth.loggedIn),
    token:
      (window.$nuxt.$auth.strategy.token.get &&
        window.$nuxt.$auth.strategy.token.get()) ||
      null,
  }))

try {
  await page.goto(`${FRONTEND}${OPEN ? PAGE : '/user/login'}`, {
    waitUntil: 'load',
  })
  // A site whose sign in is a dialog opens it first.
  if (OPEN) await page.click(OPEN, { timeout: 30000 })
  if (await page.$(SEL_PASS)) {
    await page.fill(SEL_NAME, USERNAME)
    await page.fill(SEL_PASS, PASSWORD)
    await page.click(SEL_SUBMIT)
    await page.waitForTimeout(3000)
  }
  if (page.url().includes('/oauth/authorize')) {
    const allow = await page.$(
      'input[value="Grant"], button[value="Grant"], input[value="Allow"], button[value="Allow"]'
    )
    if (allow) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
        allow.click(),
      ])
    }
  }
  await page.waitForTimeout(2500)
  await page.goto(`${FRONTEND}${PAGE}`, { waitUntil: 'load' })
  await page.waitForTimeout(2000)

  const start = await state()
  check('signed in to begin with', Boolean(start.loggedIn && start.token))

  // The client path, which a client-only interceptor already passes.
  revoke()
  const clientCall = await page.evaluate(async () => {
    try {
      const client = window.$nuxt.$druxt
        ? window.$nuxt.$druxt.axios
        : window.$nuxt.$axios
      const response = await client.get('/jsonapi')
      return `ok ${response.status}`
    } catch (error) {
      return `err ${error.message}`
    }
  })
  await page.waitForTimeout(2500)
  const afterClient = await state()
  check(
    'a client-side request recovers',
    afterClient.loggedIn && clientCall.startsWith('ok'),
    clientCall
  )

  // The server render, which it does not.
  revoke()
  await page.goto(`${FRONTEND}${PAGE}`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  const afterLoad = await state()
  check(
    'a full page load recovers',
    afterLoad.loggedIn,
    `loggedIn=${afterLoad.loggedIn}`
  )

  // The reader's own path: Drupal's admin, then back to the site.
  revoke()
  await page.goto(`${FRONTEND}/user/${UID}/edit`, { waitUntil: 'load' })
  await page.waitForTimeout(2000)
  await page.goto(`${FRONTEND}${PAGE}`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  const afterAdmin = await state()
  check(
    'returning from the proxied profile form keeps the session',
    afterAdmin.loggedIn
  )

  // The rotated tokens have to reach the browser, or the next request holds
  // one the backend revoked when it rotated.
  const before = await context.cookies()
  revoke()
  await page.goto(`${FRONTEND}${PAGE}`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  const after = await context.cookies()
  // Named for the active strategy, not by prefix. A site that has more than
  // one strategy configured keeps a key per strategy, and the unused ones
  // hold the string "false", so a prefix match compares "false" to "false"
  // and reports no rotation however well rotation worked.
  const strategy = (before.find((c) => c.name === 'auth.strategy') || {}).value
  const refreshOf = (jar) =>
    (jar.find((c) => c.name === `auth._refresh_token.${strategy}`) || {})
      .value || null
  check(
    'the rotated refresh token reached the browser',
    Boolean(strategy) && refreshOf(after) !== refreshOf(before),
    `strategy ${strategy}`
  )
  revoke()
  await page.goto(`${FRONTEND}${PAGE}`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  check(
    'and it is the live one, because a second revocation also recovers',
    (await state()).loggedIn
  )
} catch (error) {
  console.error(`\nAborted: ${error.message}`)
  await browser.close()
  process.exit(1)
}

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`
)
process.exit(failed.length ? 1 : 0)
