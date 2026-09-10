module.exports = {
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.{js,vue}'],
  coverageDirectory: './coverage/',
  coveragePathIgnorePatterns: ['/dist/', '/node_modules/'],
  // cobertura feeds the merge request coverage view, text feeds the regex the
  // pipeline reads.
  coverageReporters: ['cobertura', 'lcov', 'text'],
  // A floor, not a target: the measured baseline of the current tests, rounded
  // down. Raise it as coverage genuinely improves, and never lower it to make a
  // merge request pass.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 70,
      functions: 75,
      lines: 94,
    },
  },
  moduleFileExtensions: ['js', 'json', 'vue'],
  modulePathIgnorePatterns: ['/example/'],
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['/example/'],
  transform: {
    '^.+\\.(js)$': 'esbuild-jest',
    '^.+\\.(mjs)$': 'esbuild-jest',
    '^.+\\.(vue)$': 'vue-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!(druxt)/)'],
}
