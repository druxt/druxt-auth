<template>
  <div>
    <p>
      Logging out.
      <NuxtLink to="#" @click.native="logout()">Click here</NuxtLink>
      if you are not redirected.
    </p>
  </div>
</template>

<script>
export default {
  mounted() {
    this.logout()
  },

  methods: {
    async logout() {
      // Read the strategy first: the storage keys are named after it, and
      // they differ between the two strategies this module registers.
      const strategy = this.$auth.strategy.name

      // Simple OAuth serves no revocation endpoint, so the tokens it issued
      // stay valid on the backend until they expire, and the refresh token
      // can still mint new access tokens for its whole lifetime. Add a
      // revocation route to Drupal (drupal.org issue 2945273 has a patch,
      // or write your own) and uncomment this to spend them at logout.
      // Proxy the path so the call is same-origin, and keep it in a
      // try/catch: a failed revocation must not leave the user logged in
      // locally. Never log the error object itself, because axios keeps the
      // request config, Authorization header included, on rejections.
      //
      // try {
      //   await this.$axios.post('/oauth/logout')
      // } catch (e) {
      //   console.warn('Token revocation failed; tokens live until expiry.')
      // }

      // Ends the frontend session, and nothing else.
      await this.$auth.logout()

      // @nuxtjs/auth-next stores `false` rather than removing these, in both
      // cookies and localStorage, so clear them for a clean next login.
      // `auth.strategy` comes back on the next page load holding the default
      // strategy; that is the module seeding itself, not session state.
      const keys = [
        `auth._token.${strategy}`,
        `auth._token_expiration.${strategy}`,
        `auth._refresh_token.${strategy}`,
        `auth._refresh_token_expiration.${strategy}`,
        `auth.${strategy}.pkce_state`,
        'auth.strategy'
      ]
      keys.forEach((key) => {
        document.cookie = `${key}=; Path=/; Max-Age=0`
        window.localStorage.removeItem(key)
      })

      // A full page load, not router.push: this is what drops content fetched
      // while logged in from the DruxtStore.
      window.location.href = window.location.origin
    }
  }
}
</script>
