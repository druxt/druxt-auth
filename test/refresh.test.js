/* global beforeEach, describe, expect, test */

/**
 * Token refresh in the `drupal-authorization_code` strategy.
 *
 * The strategy sets no `refreshToken` block of its own, which reads as an
 * absence of refresh handling. It is not: the oauth2 scheme's own defaults
 * supply one, and `token.global` puts an interceptor on the shared $axios
 * that renews an expired token before the request goes out. These tests pin
 * that behaviour, so a config change that quietly disables it fails here
 * instead of in a user's session.
 *
 * Verified against a live quickstart backend on 2026-09-04; the same cases
 * run end to end in test/e2e/refresh-and-logout.mjs.
 */

import { ExpiredAuthSessionError } from '@nuxtjs/auth-next/dist/runtime'

import {
  accessToken,
  baseUrl,
  createScheme,
  refreshToken,
  tokenResponse,
} from './lib/strategy'

const HOUR = 60 * 60 * 1000

let ctx

beforeEach(() => {
  ctx = createScheme()
})

describe('Refresh configuration', () => {
  test('the scheme carries refresh-token handling without configuring it', () => {
    // Inherited from the oauth2 scheme defaults, not from druxt-auth.
    expect(ctx.scheme.options.refreshToken.property).toBe('refresh_token')
    expect(ctx.scheme.options.refreshToken.maxAge).toBe(60 * 60 * 24 * 30)

    // What makes the interceptor cover every request, not just auth endpoints.
    expect(ctx.scheme.options.token.global).toBe(true)

    // An expired access token alone must not end the session.
    expect(ctx.scheme.options.autoLogout).toBe(false)

    // Refresh POSTs go to the backend's token endpoint.
    expect(ctx.scheme.options.endpoints.token).toBe(`${baseUrl}/oauth/token`)
  })

  test('access token expiry comes from the JWT, not from maxAge', () => {
    const expiresAt = Date.now() + 300000
    ctx.scheme.token.set(accessToken(expiresAt))

    expect(Math.round(ctx.scheme.token._getExpiration() / 1000)).toBe(
      Math.floor(expiresAt / 1000)
    )
  })

  test('refresh token expiry falls back to maxAge, which the backend does not know about', () => {
    ctx.scheme.refreshToken.set(refreshToken())

    // Simple OAuth refresh tokens are opaque, so there is no exp to read and
    // the scheme assumes 30 days. A consumer set to a shorter lifetime (14
    // days is the usual default) rejects the refresh in between, and the
    // session ends mid-request.
    const days =
      (ctx.scheme.refreshToken._getExpiration() - Date.now()) / (24 * HOUR)
    expect(Math.round(days)).toBe(30)
  })
})

describe('Refresh through the request interceptor', () => {
  test('a live access token is sent as is, with no refresh', async () => {
    ctx.signIn()
    ctx.scheme.requestHandler.initializeRequestInterceptor(
      ctx.scheme.options.endpoints.token
    )

    const config = await ctx.intercept()

    expect(ctx.$auth.request).not.toHaveBeenCalled()
    expect(config.headers.Authorization).toBe(ctx.scheme.token.get())
  })

  test('an expired access token is refreshed before the request goes out', async () => {
    ctx.signIn({ expiresAt: Date.now() - 60000 })
    const expired = ctx.scheme.token.get()
    ctx.$auth.request.mockResolvedValue(tokenResponse())
    ctx.scheme.requestHandler.initializeRequestInterceptor(
      ctx.scheme.options.endpoints.token
    )

    const config = await ctx.intercept()

    // One refresh_token grant, sent to the backend's token endpoint.
    expect(ctx.$auth.request).toHaveBeenCalledTimes(1)
    const request = ctx.$auth.request.mock.calls[0][0]
    expect(request.method).toBe('post')
    expect(request.url).toBe(`${baseUrl}/oauth/token`)
    expect(request.data).toContain('grant_type=refresh_token')
    expect(request.data).toContain(`refresh_token=${refreshToken()}`)
    expect(request.data).toContain('client_id=mock-client-id')

    // The waiting request carries the new token, not the expired one.
    expect(config.headers.Authorization).not.toBe(expired)
    expect(config.headers.Authorization).toBe(ctx.scheme.token.get())

    // Both tokens rotate.
    expect(ctx.scheme.refreshToken.get()).toBe(refreshToken('0002'))
  })

  test('a data request refreshes too, because the token is global', async () => {
    ctx.signIn({ expiresAt: Date.now() - 60000 })
    ctx.$auth.request.mockResolvedValue(tokenResponse())
    ctx.scheme.requestHandler.initializeRequestInterceptor(
      ctx.scheme.options.endpoints.token
    )

    // The DruxtClient shares this axios instance unless druxt.axios is set.
    const config = await ctx.intercept({ url: '/jsonapi/node/article' })

    expect(ctx.$auth.request).toHaveBeenCalledTimes(1)
    expect(config.headers.Authorization).toBe(ctx.scheme.token.get())
  })

  test('the refresh request itself is not intercepted', async () => {
    ctx.signIn({ expiresAt: Date.now() - 60000 })
    ctx.scheme.requestHandler.initializeRequestInterceptor(
      ctx.scheme.options.endpoints.token
    )

    const config = await ctx.intercept({ url: `${baseUrl}/oauth/token` })

    expect(ctx.$auth.request).not.toHaveBeenCalled()
    expect(config.headers.Authorization).toBeUndefined()
  })

  test('an expired refresh token ends the session without calling the backend', async () => {
    ctx.signIn({ expiresAt: Date.now() - 60000 })
    ctx.scheme.refreshToken._setExpiration(Date.now() - 60000)
    ctx.scheme.requestHandler.initializeRequestInterceptor(
      ctx.scheme.options.endpoints.token
    )

    await expect(ctx.intercept()).rejects.toThrow(ExpiredAuthSessionError)

    expect(ctx.$auth.request).not.toHaveBeenCalled()
    expect(ctx.scheme.token.get()).toBe(false)
  })

  test('a refresh the backend rejects ends the session', async () => {
    ctx.signIn({ expiresAt: Date.now() - 60000 })
    // What Simple OAuth answers once the refresh token is spent or revoked.
    ctx.$auth.request.mockRejectedValue({
      response: { status: 400, data: { error: 'invalid_grant' } },
    })
    ctx.scheme.requestHandler.initializeRequestInterceptor(
      ctx.scheme.options.endpoints.token
    )

    await expect(ctx.intercept()).rejects.toThrow(ExpiredAuthSessionError)

    expect(ctx.scheme.token.get()).toBe(false)
    expect(ctx.scheme.refreshToken.get()).toBe(false)
  })

  test('an expired token with no refresh token is sent anyway, and the session survives', async () => {
    // Documents a gap rather than an intent: refreshTokens() returns early
    // when nothing is stored, and the interceptor treats that as success. The
    // backend answers 401 while the frontend still believes it is logged in.
    ctx.signIn({ expiresAt: Date.now() - 60000 })
    ctx.scheme.refreshToken.reset()
    ctx.scheme.requestHandler.initializeRequestInterceptor(
      ctx.scheme.options.endpoints.token
    )

    const config = await ctx.intercept()

    expect(ctx.$auth.request).not.toHaveBeenCalled()
    expect(config.headers.Authorization).toBe(ctx.scheme.token.get())
    expect(ctx.scheme.token.status().expired()).toBe(true)
  })
})

describe('Page load', () => {
  test('mounted keeps a session whose access token has expired', async () => {
    ctx.signIn({ expiresAt: Date.now() - 60000 })

    await ctx.scheme.mounted()

    // No reset: the interceptor renews on the first request instead.
    expect(ctx.$auth.reset).not.toHaveBeenCalled()
    expect(ctx.$auth.fetchUserOnce).toHaveBeenCalled()
    expect(ctx.scheme.refreshToken.get()).toBe(refreshToken())
  })

  test('mounted ends a session whose refresh token has expired', async () => {
    ctx.signIn({ expiresAt: Date.now() - 60000 })
    ctx.scheme.refreshToken._setExpiration(Date.now() - 60000)

    await ctx.scheme.mounted()

    expect(ctx.$auth.reset).toHaveBeenCalled()
    expect(ctx.scheme.token.get()).toBe(false)
  })
})
