import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractNotes } from '../notes.mjs'

const changelog = `# druxt-auth

## 0.15.0 - 2026-09-20

### Minor Changes

- abc1234: Added a thing.

## 0.14.3 - 2024-01-08

### Patch Changes

- Updated dependencies.
`

test('extracts a dated section up to the next version', () => {
  assert.equal(
    extractNotes(changelog, '0.15.0'),
    '### Minor Changes\n\n- abc1234: Added a thing.'
  )
})

test('extracts the last section', () => {
  assert.equal(
    extractNotes(changelog, '0.14.3'),
    '### Patch Changes\n\n- Updated dependencies.'
  )
})

test('a version prefix does not match a longer version', () => {
  assert.equal(extractNotes(changelog, '0.15'), null)
  assert.equal(extractNotes(changelog, '0.14.30'), null)
})

test('reads a bracketed Keep a Changelog heading', () => {
  const bracketed = `# druxt-auth

## [0.5.0] - 2026-09-26

### Minor Changes

- Added a thing.

## [0.4.0] - 2023-07-28

- Old.

[0.5.0]: https://example.test/compare/0.4.0...0.5.0
`
  assert.equal(
    extractNotes(bracketed, '0.5.0'),
    '### Minor Changes\n\n- Added a thing.'
  )
})
