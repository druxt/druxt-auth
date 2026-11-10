/* global describe, expect, jest, test */

import Vue from 'vue'
import Vuex from 'vuex'

import plugin from '../templates/clear-cache.js'

Vue.use(Vuex)

// auth-next keeps the session in the store's `auth` module, and Druxt 0.25.0
// and later register `druxt/clearCache`.
const site = ({ loggedIn = false, clearCache = true } = {}) => {
  const flush = jest.fn()
  const modules = {
    auth: {
      namespaced: true,
      state: () => ({ loggedIn }),
      mutations: {
        SET(state, { key, value }) {
          state[key] = value
        },
      },
    },
  }
  if (clearCache) {
    modules.druxt = { namespaced: true, actions: { clearCache: flush } }
  }
  const store = new Vuex.Store({ modules })
  plugin({ store })
  const signedIn = async (value) => {
    store.commit('auth/SET', { key: 'loggedIn', value })
    await Vue.nextTick()
  }
  return { flush, signedIn }
}

describe('Clearing Druxt when the session changes', () => {
  test('signing in clears what was loaded anonymously', async () => {
    const { flush, signedIn } = site()
    await signedIn(true)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  test('signing out clears what was loaded while signed in', async () => {
    const { flush, signedIn } = site({ loggedIn: true })
    await signedIn(false)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  test('a page load that keeps the session clears nothing', async () => {
    const { flush, signedIn } = site({ loggedIn: true })
    await signedIn(true)
    expect(flush).not.toHaveBeenCalled()
  })

  test('a Druxt without clearCache is left alone', async () => {
    const { signedIn } = site({ clearCache: false })
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(signedIn(true)).resolves.toBeUndefined()
    // Vuex reports an unknown action with console.error rather than throwing.
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
