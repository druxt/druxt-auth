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

/**
 * Who the session belongs to, as a string that changes only when that does.
 *
 * Drupal's userinfo names the account in `sub`, and a site with its own user
 * endpoint may use another field. Fetching the same account again, with a
 * changed name or picture, is the same session.
 *
 * @param {object} auth - auth-next's store state.
 * @returns {string}
 */
const session = (auth = {}) => {
  if (!auth.loggedIn) return 'signed out'
  const user = auth.user || {}
  const id = [user.sub, user.uid, user.id].find((value) => value !== undefined && value !== null)
  return `signed in as ${id === undefined ? '' : id}`
}

export default function ({ store }) {
  if (!store || typeof store.watch !== 'function') return

  store.watch(
    // auth-next keeps the session in the store's `auth` module. The account
    // counts as well as `loggedIn`: a sign-in to a second account can leave
    // `loggedIn` true throughout, and the first account's content would stay.
    (state) => session(state.auth),
    () => {
      // Druxt before 0.25.0 has no such action, and Vuex reports a missing
      // one with console.error rather than throwing, so it is looked up first.
      if (!(store._actions || {})[ACTION]) return
      store.dispatch(ACTION)
    }
  )
}
