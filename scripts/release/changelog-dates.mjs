/**
 * Brings the changeset-written changelog heading into this repository's
 * Keep a Changelog style: a bare `## 0.5.0` becomes `## [0.5.0] - 2026-09-26`,
 * with a `[0.5.0]: .../compare/0.4.0...0.5.0` reference added at the bottom.
 *
 * `changeset version` writes a bare, undated heading; running this right after
 * it (see the root `version` script) dates it at versioning time, which in
 * this repo's release flow is the release date, and links it against the
 * previous version the way every historical entry is linked. Idempotent: an
 * already-dated heading no longer matches, so re-running changes nothing.
 *
 *   node scripts/release/changelog-dates.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The GitHub `owner/repo` URL from a package.json `repository` field.
 *
 * @param {string|object} repository - The manifest's `repository`.
 * @returns {string} The `https://github.com/owner/repo` URL.
 */
export function repoUrl(repository) {
  const value =
    typeof repository === 'string' ? repository : repository?.url || ''
  const shorthand = value.match(/^github:(.+)$/)
  if (shorthand) return `https://github.com/${shorthand[1]}`
  return value
    .replace(/^git\+/, '')
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '')
}

/**
 * Dates the bare headings changeset just wrote and links each one against the
 * version below it, Keep a Changelog style.
 *
 * @param {string} source - The changelog source.
 * @param {object} options - The input.
 * @param {string} options.date - Today, as `YYYY-MM-DD`.
 * @param {string} options.url - The repository's `https://github.com/owner/repo` URL.
 * @returns {string} The rewritten changelog.
 */
export function stampChangelog(source, { date, url }) {
  const bare = /^## (\d+\.\d+\.\d+(?:-[\w.]+)?)$/
  const dated = []
  const fresh = []
  for (const line of source.split('\n')) {
    const match = line.match(bare)
    if (match) {
      fresh.push(match[1])
      dated.push(`## [${match[1]}] - ${date}`)
    } else {
      dated.push(line)
    }
  }
  if (!fresh.length) return source

  // The versions in heading order, newest first, so each one's predecessor is
  // the next heading down.
  const order = dated
    .map((line) => line.match(/^## \[([^\]]+)\]/))
    .filter(Boolean)
    .map((match) => match[1])
  const previous = (version) => order[order.indexOf(version) + 1]

  const lines = dated
  const hasReference = (version) =>
    lines.some((line) => line.startsWith(`[${version}]:`))
  const reference = (version) => {
    const prev = previous(version)
    // The oldest entry has nothing to compare against, so it points at its tag.
    const target = prev
      ? `compare/${prev}...${version}`
      : `releases/tag/${version}`
    return `[${version}]: ${url}/${target}`
  }

  const additions = fresh
    .filter((version) => !hasReference(version))
    .map(reference)
  if (!additions.length) return lines.join('\n')

  const first = lines.findIndex((line) => /^\[[^\]]+\]:\s/.test(line))
  if (first === -1) {
    // No reference block yet: start one after a trailing blank line.
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    lines.push('', ...additions, '')
  } else {
    lines.splice(first, 0, ...additions)
  }
  return lines.join('\n')
}

function main() {
  const root = process.cwd()
  const file = path.join(root, 'CHANGELOG.md')
  if (!fs.existsSync(file)) {
    console.log('changelog-dates: no CHANGELOG.md, nothing to do.')
    return
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  )
  const source = fs.readFileSync(file, 'utf8')
  const output = stampChangelog(source, {
    date: new Date().toISOString().slice(0, 10),
    url: repoUrl(manifest.repository),
  })
  if (output === source) {
    console.log('changelog-dates: no bare heading to date.')
    return
  }
  fs.writeFileSync(file, output)
  console.log('changelog-dates: dated and linked the new heading.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(`changelog-dates: ${error.message}`)
    process.exit(1)
  }
}
