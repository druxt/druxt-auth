/* global describe, expect, jest, test */

import DruxtAuthLogin from '../src/components/DruxtAuthLogin.vue'

const { capabilities, strategyName } = DruxtAuthLogin.computed
const { readError, resetPassword } = DruxtAuthLogin.methods

const fail = (status, message) => ({ response: { status, data: { message } } })

describe('The strategy in use', () => {
  test('is the prop when given one', () => {
    expect(strategyName.call({ strategy: 'mine', $auth: {} })).toBe('mine')
  })

  test('falls back to the configured default, never a hardcoded name', () => {
    // A site whose public Drupal URL differs from the internal one registers
    // its own strategy under its own name.
    const $auth = { options: { defaultStrategy: 'site-own' } }
    expect(strategyName.call({ strategy: undefined, $auth })).toBe('site-own')
  })
})

describe('What the strategy can do', () => {
  const read = (scheme) =>
    capabilities.call({
      strategyName: 's',
      $auth: { strategies: { s: scheme } },
    })

  test('a scheme that takes credentials offers a form', () => {
    expect(read({ drupalLogin: () => {} }).credentials).toBe(true)
  })

  test('plain oauth2 does not', () => {
    expect(read({}).credentials).toBe(false)
    expect(read(undefined).credentials).toBe(false)
  })

  test('nor does a scheme whose login endpoint has no same-origin route', () => {
    // The Drupal endpoints are relative, so without the proxy they reach
    // Nuxt rather than Drupal. A site fronting both can set it back to true.
    const scheme = { drupalLogin: () => {}, options: { credentials: false } }
    expect(read(scheme).credentials).toBe(false)
    scheme.options.credentials = true
    expect(read(scheme).credentials).toBe(true)
  })

  test('password reset needs both the method and the endpoint', () => {
    expect(read({ resetPassword: () => {} }).resetPassword).toBe(false)
    expect(
      read({
        resetPassword: () => {},
        options: { endpoints: { passwordReset: '/user/password' } },
      }).resetPassword
    ).toBe(true)
  })
})

describe('Reading a failure', () => {
  test('an existing session is not a failure a reader can act on', () => {
    // The scheme carries on regardless, so surfacing this would be noise.
    expect(
      readError(
        fail(403, 'This route can only be accessed by anonymous users.')
      )
    ).toBeNull()
  })

  test('an unknown account and a flooded one read the same', () => {
    // Drupal answers 400 when no enabled account has that name, and 429 once
    // an existing one trips flood control. A message per status would say
    // which usernames are real.
    const unknown = readError(
      fail(400, 'Sorry, unrecognized username or password.')
    )
    const flooded = readError(
      fail(429, 'Too many failed login attempts from your IP address.')
    )
    expect(unknown).toBe(flooded)
    expect(flooded).not.toContain('Too many failed')
  })

  test('bad credentials do not reflect what was typed back onto the page', () => {
    // Drupal names the account in its own message.
    const typed = 'Sorry, unrecognized username or password. <script>x</script>'
    const shown = readError(fail(400, typed))
    expect(shown).not.toContain('<script>')
    expect(shown).toBe(
      'Check the username and password, then try again. Repeated attempts are blocked for a while.'
    )
  })

  test('a refused authorisation does not read as a wrong password', () => {
    const shown = readError(
      fail(401, 'The resource owner or authorization server denied the request')
    )
    expect(shown).toBe('This account is not permitted to sign in here.')
  })

  test('anything else gets a plain message', () => {
    expect(readError(new Error('boom'))).toBe('Sign in failed. Try again.')
    expect(readError(undefined)).toBe('Sign in failed. Try again.')
  })
})

describe('Resetting a password', () => {
  const vm = (scheme) => ({
    busy: false,
    error: null,
    reset: false,
    credentials: { name: 'someone', pass: '' },
    strategyName: 's',
    $auth: { strategies: { s: scheme } },
    $emit: jest.fn(),
  })

  test('says the same thing whether or not the account exists', async () => {
    // Drupal's own message says which, which is an enumeration oracle.
    const context = vm({
      resetPassword: jest.fn(() => Promise.reject(fail(400, 'no such user'))),
    })
    await resetPassword.call(context)
    expect(context.error).toBeNull()
    expect(context.reset).toBe(true)
  })

  test('reports a transport failure, which a reader can act on', async () => {
    const context = vm({
      resetPassword: jest.fn(() => Promise.reject(new Error('offline'))),
    })
    await resetPassword.call(context)
    expect(context.error).toBe('Could not reach the site. Try again.')
  })

  test('a transport failure leaves the retry control in place', async () => {
    // `reset` swaps the button for "a reset link is on its way", which would
    // contradict the alert and strand a reader who cannot try again.
    const context = vm({
      resetPassword: jest.fn(() => Promise.reject(new Error('offline'))),
    })
    await resetPassword.call(context)
    expect(context.reset).toBe(false)
  })

  test('a success reports nothing but done', async () => {
    const context = vm({ resetPassword: jest.fn(() => Promise.resolve()) })
    await resetPassword.call(context)
    expect(context.error).toBeNull()
    expect(context.reset).toBe(true)
    expect(context.$emit).toHaveBeenCalledWith('reset')
  })
})

describe('The form it renders', () => {
  // A stand-in for Vue's createElement, so the tree can be asserted without
  // mounting the whole Druxt wrapper stack.
  const h = (tag, data, children) =>
    Array.isArray(data)
      ? { tag, data: {}, children: data }
      : { tag, data, children }

  const render = (context) => {
    const slots = DruxtAuthLogin.druxt.slots.call(
      {
        busy: false,
        credentials: { name: '', pass: '' },
        error: null,
        reset: false,
        resetPassword: jest.fn(),
        submit: jest.fn(),
        ...context,
      },
      h
    )
    return slots.default()
  }

  const flatten = (node) => {
    if (!node || typeof node !== 'object') return [node]
    return [node, ...[].concat(node.children || []).flatMap(flatten)]
  }
  const tags = (node) => flatten(node).map((o) => (o || {}).tag)
  const text = (node) =>
    flatten(node)
      .filter((o) => typeof o === 'string')
      .join(' ')

  test('a strategy that takes credentials gets fields', () => {
    const tree = render({
      capabilities: { credentials: true, resetPassword: false },
    })
    expect(tags(tree).filter((t) => t === 'input')).toHaveLength(2)
    expect(text(tree)).toContain('Sign in')
  })

  test('a strategy that cannot gets a redirect, not fields that would fail', () => {
    const tree = render({
      capabilities: { credentials: false, resetPassword: false },
    })
    expect(tags(tree)).not.toContain('input')
    expect(text(tree)).toContain('Continue to Drupal')
  })

  test('an error is announced', () => {
    const tree = render({
      capabilities: { credentials: true, resetPassword: false },
      error: 'Too many attempts.',
    })
    const alert = flatten(tree).find(
      (o) => ((o || {}).data || {}).attrs?.role === 'alert'
    )
    expect(alert).toBeDefined()
    expect(text(tree)).toContain('Too many attempts.')
  })

  test('password reset is offered only when the strategy has it', () => {
    const without = render({
      capabilities: { credentials: true, resetPassword: false },
    })
    expect(text(without)).not.toContain('Reset password')
    const with_ = render({
      capabilities: { credentials: true, resetPassword: true },
    })
    expect(text(with_)).toContain('Reset password')
  })

  test('after a reset it says the same thing either way', () => {
    const tree = render({
      capabilities: { credentials: true, resetPassword: true },
      reset: true,
    })
    expect(text(tree)).toContain('If that account exists')
    expect(text(tree)).not.toContain('Reset password')
  })

  test('submitting does not reload the page', () => {
    const submit = jest.fn()
    const tree = render({
      capabilities: { credentials: true, resetPassword: false },
      submit,
    })
    const preventDefault = jest.fn()
    tree.data.on.submit({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
    expect(submit).toHaveBeenCalled()
  })
})

describe('Its initial state', () => {
  test('starts empty, idle and quiet', () => {
    expect(DruxtAuthLogin.data()).toEqual({
      credentials: { name: '', pass: '' },
      busy: false,
      error: null,
      reset: false,
    })
  })
})

describe('Signing in', () => {
  const { submit } = DruxtAuthLogin.methods

  const vm = (overrides = {}) => ({
    busy: false,
    error: null,
    credentials: { name: 'editor', pass: 'secret' },
    capabilities: { credentials: true, resetPassword: false },
    strategyName: 's',
    redirect: undefined,
    readError: DruxtAuthLogin.methods.readError,
    $auth: { loginWith: jest.fn(() => Promise.resolve()) },
    $router: { push: jest.fn() },
    $emit: jest.fn(),
    ...overrides,
  })

  test('sends the credentials when the strategy takes them', async () => {
    const context = vm()
    await submit.call(context)
    expect(context.$auth.loginWith).toHaveBeenCalledWith('s', {
      credentials: { name: 'editor', pass: 'secret' },
    })
    expect(context.$emit).toHaveBeenCalledWith('success')
    expect(context.busy).toBe(false)
  })

  test('starts the redirect instead when it cannot take them', async () => {
    const context = vm({
      capabilities: { credentials: false, resetPassword: false },
    })
    await submit.call(context)
    expect(context.$auth.loginWith).toHaveBeenCalledWith('s', {})
  })

  test('goes where it was told to afterwards', async () => {
    const context = vm({ redirect: '/account' })
    await submit.call(context)
    expect(context.$router.push).toHaveBeenCalledWith('/account')
  })

  test('shows a readable message when it fails, and clears busy', async () => {
    const context = vm({
      $auth: {
        loginWith: jest.fn(() =>
          Promise.reject({ response: { status: 400, data: { message: 'x' } } })
        ),
      },
    })
    await submit.call(context)
    expect(context.error).toBe(
      'Check the username and password, then try again. Repeated attempts are blocked for a while.'
    )
    expect(context.busy).toBe(false)
    expect(context.$emit).toHaveBeenCalledWith('error', context.error)
  })

  test('stays quiet when the failure is only an existing session', async () => {
    const context = vm({
      $auth: {
        loginWith: jest.fn(() =>
          Promise.reject({
            response: {
              status: 403,
              data: {
                message: 'This route can only be accessed by anonymous users.',
              },
            },
          })
        ),
      },
    })
    await submit.call(context)
    expect(context.error).toBeNull()
    expect(context.$emit).not.toHaveBeenCalledWith('error', expect.anything())
  })

  test('ignores a second submit while one is in flight', async () => {
    const context = vm({ busy: true })
    await submit.call(context)
    expect(context.$auth.loginWith).not.toHaveBeenCalled()
  })
})

describe('What it does not leak', () => {
  const { submit, readError } = DruxtAuthLogin.methods

  const vm = (overrides = {}) => ({
    busy: false,
    error: null,
    credentials: { name: 'editor', pass: 'secret' },
    capabilities: { credentials: true, resetPassword: false },
    strategyName: 's',
    redirect: undefined,
    readError,
    $auth: { loginWith: jest.fn(() => Promise.resolve()) },
    $router: { push: jest.fn() },
    $emit: jest.fn(),
    ...overrides,
  })

  test('the submit event carries the username, never the password', async () => {
    // A listener wiring this to analytics must not receive a secret, and
    // devtools records every emitted payload.
    const context = vm()
    await submit.call(context)
    const [, payload] = context.$emit.mock.calls.find(
      ([name]) => name === 'submit'
    )
    expect(payload).toEqual({ name: 'editor' })
    expect(JSON.stringify(context.$emit.mock.calls)).not.toContain('secret')
  })

  test('the password is cleared once the sign in succeeds', async () => {
    const context = vm()
    await submit.call(context)
    expect(context.credentials.pass).toBe('')
  })

  test("no message repeats Drupal's own text, which names the account", () => {
    const shown = readError(
      fail(400, 'Sorry, unrecognized username or password.')
    )
    expect(shown).not.toContain('unrecognized')
  })

  test('the form posts, so a submit before hydration keeps the password out of the URL', () => {
    // No method means GET, and the submit listener does not exist until the
    // bundle runs, so the fields would serialise into the query string.
    const h = (tag, data, children) =>
      Array.isArray(data)
        ? { tag, data: {}, children: data }
        : { tag, data, children }
    const tree = DruxtAuthLogin.druxt.slots
      .call(
        {
          busy: false,
          credentials: { name: '', pass: '' },
          error: null,
          reset: false,
          capabilities: { credentials: true, resetPassword: false },
          resetPassword: jest.fn(),
          submit: jest.fn(),
        },
        h
      )
      .default()
    expect(tree.tag).toBe('form')
    expect(tree.data.attrs.method).toBe('post')
  })
})

describe('What a wrapper component receives', () => {
  test('includes the handlers, or it can render a form and never submit it', () => {
    const vm = {
      busy: false,
      capabilities: { credentials: true, resetPassword: true },
      credentials: { name: '', pass: '' },
      error: null,
      reset: false,
      submit: jest.fn(),
      resetPassword: jest.fn(),
    }
    const props = DruxtAuthLogin.druxt.propsData(vm)
    expect(props.submit).toBe(vm.submit)
    expect(props.resetPassword).toBe(vm.resetPassword)
    // The readme's override example reads each of these.
    for (const key of [
      'busy',
      'capabilities',
      'credentials',
      'error',
      'reset',
    ]) {
      expect(props).toHaveProperty(key)
    }
  })
})
