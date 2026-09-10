/**
 * Point git at the committed hooks directory.
 *
 * The hooks live in .githooks/ and are activated with
 * `git config core.hooksPath`, which is a per-clone setting rather than
 * something the repository carries. Without this step a fresh clone has the
 * hooks on disk and none of them running, which is worse than having no hooks
 * at all: the repository looks protected and is not.
 *
 * Deliberately not husky. husky needs a package.json and a postinstall of its
 * own, which excludes the Drupal-side repositories in this ecosystem that have
 * neither, and the version in use elsewhere is on a deprecated hook-sourcing
 * style. A committed directory works everywhere and costs no dependency.
 *
 * Quiet on failure. A CI install runs this too, and there is nothing to gain
 * from failing an install because a hook could not be configured in a
 * container that will never make a commit.
 */

import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
} catch {
  // Not a git checkout: a published tarball, or a vendored copy. Nothing to do.
  process.exit(0)
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    stdio: 'ignore',
  })
  console.log('Git hooks enabled from .githooks/')
} catch (error) {
  console.warn(`Could not enable git hooks: ${error.message}`)
  console.warn('Run `npm run hooks:install` by hand if you intend to commit.')
}
