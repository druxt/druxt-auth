/* global afterEach, beforeEach, describe, expect, test */

/**
 * The private-host rule.
 *
 * Driven as a command against throwaway repositories rather than
 * imported, because the linter is an ESM script that has to keep
 * running under plain `node`. That also puts its exit code under test,
 * which is the part CI depends on.
 *
 * The fixtures below are deliberately private-looking; this file is one
 * of the two the linter skips for exactly that reason.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LINTER = path.resolve(__dirname, '../scripts/lint-private-refs.mjs')

let repo

/** A throwaway git repository, because the linter reads tracked files. */
const commit = (files) => {
  Object.entries(files).forEach(([name, contents]) => {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true })
    fs.writeFileSync(path.join(repo, name), contents)
  })
  execFileSync('git', ['-C', repo, 'add', '-A'])
}

const run = () => {
  const result = spawnSync(process.execPath, [LINTER, repo], {
    encoding: 'utf8',
  })
  return { status: result.status, output: result.stdout + result.stderr }
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'druxt-auth-private-'))
  execFileSync('git', ['-C', repo, 'init', '-q'])
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('lint:private', () => {
  test('passes a repository with only public and local hosts', () => {
    commit({
      'README.md': [
        'http://localhost:3000/callback',
        'http://127.0.0.1:8888/jsonapi',
        'http://druxt-auth.ddev.site',
        'https://demo-api.druxtjs.org/oauth/token',
      ].join('\n'),
    })

    const { status, output } = run()

    expect(status).toBe(0)
    expect(output).toContain('No private hosts')
  })

  test('fails on a private host, naming the file and line', () => {
    commit({
      'docs/setup.md': 'first\nsecond\nsee http://example.local/path\n',
    })

    const { status, output } = run()

    expect(status).toBe(1)
    expect(output).toContain('docs/setup.md:3: example.local')
  })

  test('fails on an scp-style git remote', () => {
    commit({ 'CONTRIBUTING.md': 'git@example.internal:group/project.git' })

    expect(run().status).toBe(1)
  })

  test('steps over userinfo to reach the host', () => {
    // Capturing the username instead of the host let whole URLs through.
    commit({ 'notes.md': 'https://oauth2:token@example.local/x' })

    const { status, output } = run()

    expect(status).toBe(1)
    expect(output).toContain('example.local')
  })

  test('fails on private address ranges', () => {
    commit({
      'a.md': 'http://10.1.2.3/a',
      'b.md': 'http://192.168.0.9/b',
      'c.md': 'http://172.16.4.5/c',
    })

    const { status, output } = run()

    expect(status).toBe(1)
    expect(output).toContain('10.1.2.3')
    expect(output).toContain('192.168.0.9')
    expect(output).toContain('172.16.4.5')
  })

  test('fails on a private address written as an IPv4-mapped IPv6 literal', () => {
    // Same three addresses as above, in the spellings that read as IPv6.
    commit({
      'a.md': 'http://[::ffff:10.1.2.3]/a',
      'b.md': 'http://[::ffff:c0a8:0009]/b',
      'c.md': 'http://[0:0:0:0:0:ffff:172.16.4.5]/c',
    })

    const { status, output } = run()

    expect(status).toBe(1)
    expect(output).toContain('10.1.2.3')
    expect(output).toContain('192.168.0.9')
    expect(output).toContain('172.16.4.5')
  })

  test('ignores an untracked file, which is not published', () => {
    fs.writeFileSync(path.join(repo, 'scratch.md'), 'http://example.local/x')

    expect(run().status).toBe(0)
  })

  test('says nothing about a bare project name, which it cannot see', () => {
    // The documented gap: prose has no host shape to match, so a green
    // run is not evidence that an internal name is absent.
    commit({
      'README.md': 'mirrored to the internal group as some-private-project',
    })

    expect(run().status).toBe(0)
  })
})
