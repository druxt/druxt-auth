<template>
  <div>
    <template v-if="!this.$nuxt.$auth.loggedIn">
      <h1>You are not logged in :(</h1>
      <button @click="$auth.loginWith('drupal-authorization_code')">Click here to log in</button>
      <pre><code>Username: admin
Password: password</code></pre>
    </template>

    <template v-else>
      <h1>Yay, you are logged in!</h1>
      <pre><code v-text="$auth.user" /></pre>
      <button @click="$auth.logout()">Click here to log out</button>
    </template>
  </div>
</template>
