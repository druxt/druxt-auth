<template>
  <div class="container mx-auto py-16">
    <template v-if="!this.$nuxt.$auth.loggedIn">
      <h1>You are not logged in</h1>
      <button @click="$auth.loginWith('drupal-authorization_code')">Click here to log in</button>
    </template>
  </div>
</template>
