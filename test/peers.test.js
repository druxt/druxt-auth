/* global describe, expect, test */

import semver from 'semver'
import pkg from '../package.json'

describe('axios peer range', () => {
  test('admits the axios druxt 0.25.0 requires, and not 1.x', () => {
    // A range that refuses druxt's axios makes npm nest a copy of druxt per module (#97).
    const range = pkg.peerDependencies.axios
    expect(semver.satisfies('0.27.2', range)).toBe(true)
    expect(semver.satisfies('0.34.0', range)).toBe(true)
    // auth-next does not work with axios 1.x yet (#98).
    expect(semver.satisfies('1.0.0', range)).toBe(false)
  })
})
