<template>
  <div>
    <template v-if="!$auth.loggedIn">
      <h1>You are not signed in</h1>

      <!-- The module adds this page, so there is no file for it here. -->
      <p><NuxtLink to="/user/login">Sign in</NuxtLink></p>

      <h2>Or sign in from anywhere</h2>
      <DruxtAuthLogin />

      <h2>Password grant</h2>
      <p>
        Needs the
        <a href="https://www.drupal.org/project/simple_oauth_password_grant">
          Simple OAuth Password Grant</a
        >
        module on the backend, and the grant enabled on the Consumer.
      </p>
      <label>Username: <input v-model="username" /></label><br />
      <label>Password: <input v-model="password" type="password" /></label
      ><br />
      <button @click="passwordGrant">Sign in</button>
    </template>

    <template v-else>
      <h1>You are signed in</h1>
      <pre><code v-text="$auth.user" /></pre>
      <p><NuxtLink to="/user/logout">Sign out</NuxtLink></p>
    </template>
  </div>
</template>

<script>
export default {
  data: () => ({
    username: 'druxttest',
    password: 'druxttest-pass',
  }),
  methods: {
    passwordGrant() {
      this.$auth.loginWith('drupal-password', {
        data: { username: this.username, password: this.password },
      })
    },
  },
}
</script>
