<template>
  <div class="container mx-auto py-16">
    <template v-if="!this.$nuxt.$auth.loggedIn">
      <h1 class="text-xl mb-8">You are not logged in!</h1>
      <button class="rounded-full px-4 py-2 bg-cyan-500 text-white font-semibold text-sm" @click="$auth.loginWith('drupal-authorization_code')">Click here to log in</button>
    </template>
  </div>
</template>
