/* global expect, test */

// The changelog generator, which writes each entry of CHANGELOG.md at release
// time. It ships nowhere, so its coverage is not counted.
const { getReleaseLine } = require('../.changeset/changelog.cjs')

const SHA = '75b37680976671879b03eaf2eb046d799456f5ef'
const LATER = '773a7b76a4115327c4cd5b6a937e8ecaa6f13c65'

test('an entry links the commit that added its changeset', async () => {
  const line = await getReleaseLine({
    summary: 'Routes are kept.',
    commit: LATER,
  })
  expect(line).toMatch(/\[`773a7b7`\]\(.*\/commit\/773a7b76/)
})

test('a Commit line links the change instead, and is left out of the entry', async () => {
  const line = await getReleaseLine({
    summary: `Routes are kept.\n\nCommit: ${SHA}`,
    commit: LATER,
  })
  expect(line).toMatch(/\[`75b3768`\]\(.*\/commit\/75b37680/)
  expect(line).not.toMatch(/773a7b7|Commit:/)
})

test('the rest of the body stays when a Commit line is removed', async () => {
  const line = await getReleaseLine({
    summary: `Routes are kept.\n\nThe store too.\nCommit: ${SHA}`,
    commit: LATER,
  })
  expect(line).toMatch(/\n {2}The store too\.$/)
})

test('the body is a paragraph of its own, so the links close the first one', async () => {
  const line = await getReleaseLine({
    summary:
      'fix(#962): a query reaches Drupal.\n\nIt was sent empty.\n\n```js\nget()\n```',
    commit: LATER,
  })
  // Joined straight under the bullet, the body ran into the first paragraph
  // and left the links in the middle of it.
  expect(line).toMatch(
    /\/commit\/773a7b76[^)]*\)\)\n\n {2}It was sent empty\.\n\n {2}```js\n {2}get\(\)\n {2}```$/
  )
  expect(line).not.toMatch(/^ +$/m)
})

test('an issue ref in a link, a URL or code stays as written', async () => {
  const line = await getReleaseLine({
    summary:
      'fix: see [the guide](https://example.org/#123), `#9` and <https://example.org/#7> for #45',
    commit: LATER,
  })
  expect(line).toMatch(/\(https:\/\/example\.org\/#123\)/)
  expect(line).toMatch(/`#9`/)
  expect(line).toMatch(/<https:\/\/example\.org\/#7>/)
  expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
})

test('only a Conventional Commits type is taken as a prefix', async () => {
  const line = await getReleaseLine({
    summary: 'Windows: fix path resolution',
    commit: LATER,
  })
  expect(line).toMatch(/^- Windows: fix path resolution\. /)
})

test('an indented code block that opens the body keeps its indent', async () => {
  const line = await getReleaseLine({
    summary: 'fix: keep the slot.\n\n    const a = 1\n    const b = 2',
    commit: LATER,
  })
  expect(line).toMatch(/\n\n {6}const a = 1\n {6}const b = 2$/)
})

test('a link whose destination holds parentheses stays as written', async () => {
  for (const link of [
    '[the guide](https://example.org/guide(v2)#123)',
    '[the guide](https://example.org/a(b(c))#123)',
    '[the guide](https://example.org/guide\\(v2#123)',
    '[issue #123][guide]',
  ]) {
    const line = await getReleaseLine({
      summary: `fix: see ${link} for #45\n\n[guide]: https://example.org/guide`,
      commit: LATER,
    })
    expect(line).toContain(link)
    expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
  }
})

test('a code span ends on a run of as many backticks as opened it', async () => {
  const line = await getReleaseLine({
    summary: 'fix: show `foo ``` #9` for #45',
    commit: LATER,
  })
  expect(line).toContain('`foo ``` #9`')
  expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
})

test('a Commit line in a code example stays in the example', async () => {
  const fenced = await getReleaseLine({
    summary: `docs: show the metadata.\n\n\`\`\`\nCommit: ${SHA}\n\`\`\``,
    commit: LATER,
  })
  const indented = await getReleaseLine({
    summary: `docs: show the metadata.\n\n    Commit: ${SHA}`,
    commit: LATER,
  })
  for (const line of [fenced, indented]) {
    expect(line).toMatch(/\/commit\/773a7b76/)
    expect(line).toMatch(new RegExp(`\\n {2}(?: {4})?Commit: ${SHA}`))
  }
})

test('a breaking-change footer in a code example does not mark the entry', async () => {
  const fenced = await getReleaseLine({
    summary:
      'docs: show the footer.\n\n~~~\nBREAKING CHANGE: remove the old API\n~~~',
    commit: LATER,
  })
  const indented = await getReleaseLine({
    summary:
      'docs: show the footer.\n\n    BREAKING CHANGE: remove the old API',
    commit: LATER,
  })
  const footer = await getReleaseLine({
    summary: 'fix: drop the old API.\n\nBREAKING CHANGE: use the new one.',
    commit: LATER,
  })
  expect(fenced).not.toMatch(/\*\*Breaking/)
  expect(indented).not.toMatch(/\*\*Breaking/)
  expect(footer).toMatch(/^- \*\*Breaking/)
})

test('a code span or a fence in a list item does not hide the footers after it', async () => {
  for (const example of ['```example```', '- ~~~text\n  example\n  ~~~']) {
    const line = await getReleaseLine({
      summary: `fix: drop the old API.\n\n${example}\n\nCommit: ${SHA}\nBREAKING CHANGE: use the new one.`,
      commit: LATER,
    })
    expect(line).toMatch(/^- \*\*Breaking/)
    expect(line).toMatch(/\/commit\/75b37680/)
  }
})

test('a link label with code, a quoted title or an angle-bracket destination stays as written', async () => {
  for (const link of [
    '[guide `[`](guide#123)',
    '[guide](guide#123 "release (")',
    '[guide](<a)b#123>)',
  ]) {
    const line = await getReleaseLine({
      summary: `fix: see ${link} for #45`,
      commit: LATER,
    })
    expect(line).toContain(link)
    expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
  }
})

test('an escaped or bracketed issue ref stays as written', async () => {
  const line = await getReleaseLine({
    summary: 'fix: see \\#12 and [#7] for #45',
    commit: LATER,
  })
  expect(line).toContain('\\#12 and [#7]')
  expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
})

test('an indented line that only looks like a list fence does not hide the footers after it', async () => {
  const line = await getReleaseLine({
    summary: `fix: drop the old API.\n\n    - ~~~\n\nCommit: ${SHA}\nBREAKING CHANGE: use the new one.`,
    commit: LATER,
  })
  expect(line).toMatch(/^- \*\*Breaking/)
  expect(line).toMatch(/\/commit\/75b37680/)
})

test('a fence does not close on a line indented four spaces', async () => {
  const line = await getReleaseLine({
    summary: `docs: show the footers.\n\n~~~text\n    ~~~\nCommit: ${SHA}\nBREAKING CHANGE: migrate\n~~~`,
    commit: LATER,
  })
  expect(line).not.toMatch(/\*\*Breaking/)
  expect(line).toMatch(/\/commit\/773a7b76/)
  expect(line).toContain(`Commit: ${SHA}`)
})

test('an issue ref in an entity, an email autolink, a title or a reference link stays as written', async () => {
  const definition = '\n\n[guide #123]: https://example.org/guide'
  for (const [summary, kept] of [
    ['fix: show &#123; for #45', '&#123;'],
    [
      'fix: contact <release#123@example.org> for #45',
      '<release#123@example.org>',
    ],
    [
      'fix: see [the `]` guide #123](https://example.org) for #45',
      '[the `]` guide #123](https://example.org)',
    ],
    [
      'fix: see [guide](https://example.org "version) #123") for #45',
      '[guide](https://example.org "version) #123")',
    ],
    [`fix: see [x][guide #123] for #45${definition}`, '[x][guide #123]'],
    [`fix: see [guide #123][] for #45${definition}`, '[guide #123][]'],
    [`fix: see [guide #123] for #45${definition}`, '[guide #123] for'],
  ]) {
    const line = await getReleaseLine({ summary, commit: LATER })
    expect(line).toContain(kept)
    expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
  }
})

test('a fence in a list item ends with the item, so the footers after it are read', async () => {
  const line = await getReleaseLine({
    summary: `fix: drop the old API.\n\n- ~~~\n  example\n\nCommit: ${SHA}\nBREAKING CHANGE: use the new one.`,
    commit: LATER,
  })
  expect(line).toMatch(/^- \*\*Breaking/)
  expect(line).toMatch(/\/commit\/75b37680/)
})

test('a fence in a list item does not close on a line indented four spaces past the item', async () => {
  const line = await getReleaseLine({
    summary: `docs: show the footers.\n\n- ~~~text\n      ~~~\n  Commit: ${SHA}\n  BREAKING CHANGE: migrate\n  ~~~`,
    commit: LATER,
  })
  expect(line).not.toMatch(/\*\*Breaking/)
  expect(line).toMatch(/\/commit\/773a7b76/)
})

test('a Commit line or a breaking-change footer in an HTML block stays an example', async () => {
  const line = await getReleaseLine({
    summary: `docs: show the footers.\n\n<pre>\nCommit: ${SHA}\nBREAKING CHANGE: migrate\n</pre>`,
    commit: LATER,
  })
  expect(line).not.toMatch(/\*\*Breaking/)
  expect(line).toMatch(/\/commit\/773a7b76/)
  expect(line).toContain(`Commit: ${SHA}`)
})

test('an issue ref inside an HTML link stays as written', async () => {
  const line = await getReleaseLine({
    summary: 'fix: see <a href="/guide">#123</a> for #45',
    commit: LATER,
  })
  expect(line).toContain('<a href="/guide">#123</a>')
  expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
})

test('an issue ref in a bare URL stays as written', async () => {
  const line = await getReleaseLine({
    summary:
      'fix: see https://example.org/guide#123, www.example.org/a#7 and https://example.org/a(b(c))#8 for #45',
    commit: LATER,
  })
  expect(line).toContain(
    'https://example.org/guide#123, www.example.org/a#7 and https://example.org/a(b(c))#8 for'
  )
  expect(line).toMatch(/\[#45\]\(.*\/issues\/45\)/)
})
