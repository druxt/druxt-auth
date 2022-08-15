<template>
  <div>
    <template v-if="!this.$nuxt.$auth.loggedIn">
      <h1>You are not logged in :(</h1>
      <button @click="$auth.loginWith('drupal-authorization_code')">Click here to log in with Authorization grant</button>
      <details open style="border: 1px solid; padding: 0.5rem; margin-top: 1rem;">
        <summary>Login with Password grant</summary>
        <label>Username: <input v-model="username" /></label><br />
        <label>Password: <input v-model="password" /></label><br />
        <button @click="login">Log in</button>
      </details>
    </template>

    <template v-else>
      <h1>Yay, you are logged in!</h1>
      <pre><code v-text="$auth.user" /></pre>
      <button @click="$auth.logout()">Click here to log out</button>
    </template>
  </div>
</template>

<script>
export default {
  data: () => ({
    username: 'admin',
    password: 'password'
  }),
  methods: {
    login() {
      this.$auth.loginWith('drupal-password', {
        data: {
          username: this.username,
          password: this.password
        }
      })
    }
  }
}
</script>
