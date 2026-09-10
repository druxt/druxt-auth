/* global beforeEach, describe, expect, test */

/**
 * What `$auth.logout()` does, and what it leaves behind.
 *
 * Simple OAuth has no revocation endpoint (6.1.1 serves /oauth/token,
 * /oauth/authorize, /oauth/debug, /oauth/userinfo and /oauth/jwks, nothing
 * else), so the strategy configures no logout endpoint and logging out is a
 * local reset. These tests pin what that reset does and does not clear, which
 * is what a logout page has to clean up after.
 *
 * Verified against a live quickstart backend on 2026-09-04; the same cases
 * run end to end in test/e2e/refresh-and-logout.mjs.
 */

import { createScheme, strategyOptions } from './lib/strategy'

let ctx

beforeEach(() => {
  ctx = createScheme()
})

describe('Logging out', () => {
  test('the strategy configures no logout endpoint, so nothing is revoked', async () => {
    ctx.signIn()

    await ctx.scheme.logout()

    // Simple OAuth has nothing to call. The tokens the backend issued stay
    // valid until they expire, the refresh token included.
    expect(ctx.scheme.options.endpoints.logout).toBeNull()
    expect(ctx.$auth.request).not.toHaveBeenCalled()
    expect(ctx.$auth.requestWith).not.toHaveBeenCalled()
  })

  test('logout clears the session state', async () => {
    ctx.signIn()

    await ctx.scheme.logout()

    expect(ctx.scheme.token.get()).toBe(false)
    expect(ctx.scheme.refreshToken.get()).toBe(false)
    expect(ctx.$auth.setUser).toHaveBeenCalledWith(false)
    expect(ctx.axios.setHeader).toHaveBeenLastCalledWith('Authorization', false)
  })

  test('logout leaves its storage keys behind, in cookies and in localStorage', async () => {
    ctx.signIn()
    ctx.storage.setUniversal('strategy', 'drupal-authorization_code')
    ctx.storage.setUniversal('drupal-authorization_code.pkce_state', 'abc123')

    await ctx.scheme.logout()

    // reset() stores `false` rather than removing the key, and setUniversal
    // only removes on undefined or null. A logout page that wants a clean
    // slate has to clear these itself, in both stores.
    const { cookies, local } = ctx.residue()
    const stale = [
      'auth._token.drupal-authorization_code',
      'auth._token_expiration.drupal-authorization_code',
      'auth._refresh_token.drupal-authorization_code',
      'auth._refresh_token_expiration.drupal-authorization_code',
    ]
    stale.forEach((key) => {
      expect(cookies[key]).toBe('false')
      expect(local[key]).toBe('false')
    })

    // The strategy name and the PKCE state survive untouched.
    expect(cookies['auth.strategy']).toBe('drupal-authorization_code')
    expect(cookies['auth.drupal-authorization_code.pkce_state']).toBe('abc123')
  })

  test('the keys to clear are named for the strategy, not for druxt', async () => {
    ctx.signIn()

    await ctx.scheme.logout()

    // A cleanup list written against `auth._token.druxt` clears nothing.
    expect(Object.keys(ctx.residue().cookies)).toEqual(
      expect.arrayContaining([`auth._token.${ctx.scheme.name}`]),
    )
    expect(ctx.scheme.name).toBe('drupal-authorization_code')
  })
})

describe('Password grant', () => {
  test('the password strategy disables its logout endpoint explicitly', () => {
    // Same story, stated in config: the refresh scheme would otherwise post
    // to a logout endpoint that Simple OAuth does not serve.
    expect(strategyOptions('drupal-password').endpoints.logout).toBe(false)
  })
})
