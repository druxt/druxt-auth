import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stampChangelog, repoUrl } from '../changelog-dates.mjs'

const url = 'https://github.com/druxt/druxt-auth'
const opts = { date: '2026-09-26', url }

const changelog = `# druxt-auth

## 0.5.0

### Minor Changes

- A change.

## [0.4.0] - 2023-07-28

### Minor Changes

- Old.

[0.4.0]: https://github.com/druxt/druxt-auth/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/druxt/druxt-auth/compare/0.2.0...0.3.0
`

test('dates the bare heading in Keep a Changelog style', () => {
  const out = stampChangelog(changelog, opts)
  assert.match(out, /^## \[0\.5\.0\] - 2026-09-26$/m)
  assert.doesNotMatch(out, /^## 0\.5\.0$/m)
})

test('links the new version against the previous one, newest first', () => {
  const out = stampChangelog(changelog, opts).split('\n')
  const refs = out.filter((line) => /^\[[^\]]+\]:/.test(line))
  assert.equal(refs[0], `[0.5.0]: ${url}/compare/0.4.0...0.5.0`)
  assert.equal(
    refs[1],
    '[0.4.0]: https://github.com/druxt/druxt-auth/compare/0.3.0...0.4.0'
  )
})

test('is idempotent: an already-dated changelog is unchanged', () => {
  const once = stampChangelog(changelog, opts)
  assert.equal(stampChangelog(once, opts), once)
})

test('leaves a changelog with no bare heading untouched', () => {
  const dated = '# druxt-auth\n\n## [0.4.0] - 2023-07-28\n\n- Old.\n'
  assert.equal(stampChangelog(dated, opts), dated)
})

test('starts a reference block when there is none', () => {
  const first = '# druxt-auth\n\n## 0.1.0\n\n- Initial release.\n'
  const out = stampChangelog(first, opts)
  assert.match(out, /^## \[0\.1\.0\] - 2026-09-26$/m)
  assert.match(
    out,
    new RegExp(`^\\[0\\.1\\.0\\]: ${url}/releases/tag/0\\.1\\.0$`, 'm')
  )
})

test('repoUrl reads the github shorthand and git urls', () => {
  assert.equal(repoUrl('github:druxt/druxt-auth'), url)
  assert.equal(repoUrl('git+https://github.com/druxt/druxt-auth.git'), url)
  assert.equal(repoUrl({ url: 'git@github.com:druxt/druxt-auth.git' }), url)
})
