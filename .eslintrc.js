module.exports = {
  env: { browser: true, es6: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:nuxt/recommended',
    'plugin:vue/recommended'
  ],
  overrides: [
    {
      // Standalone ESM scripts, run directly by node: top-level await.
      files: ['*.mjs'],
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' }
    }
  ]
}
