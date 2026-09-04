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

      // Ends the frontend session. Nothing is revoked: Simple OAuth serves no
      // revocation endpoint, so the tokens it issued stay valid on the
      // backend until they expire, the refresh token included.
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
