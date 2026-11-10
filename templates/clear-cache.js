/**
 * Clears what Druxt has stored when the visitor signs in or out.
 *
 * Druxt keeps resources, views, menus and routes in the store. Loaded while
 * signed in, they stay visible after signing out until a full reload, and
 * loaded anonymously, they hide what a sign-in gives access to. Druxt 0.25.0
 * and later flush all of it with the `druxt/clearCache` action, so the next
 * render fetches again with the new session.
 *
 * Browser only: a server render starts each request with an empty store, so
 * it has nothing left over from another session.
 */

const ACTION = 'druxt/clearCache'

export default function ({ store }) {
  if (!store || typeof store.watch !== 'function') return

  store.watch(
    // auth-next keeps the session in the store's `auth` module.
    (state) => Boolean((state.auth || {}).loggedIn),
    () => {
      // Druxt before 0.25.0 has no such action, and Vuex reports a missing
      // one with console.error rather than throwing, so it is looked up first.
      if (!(store._actions || {})[ACTION]) return
      store.dispatch(ACTION)
    }
  )
}
