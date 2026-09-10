# Agent notes

DruxtAuth registers two authentication strategies against Drupal's Simple
OAuth. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. This file covers what is
easy to get wrong here.

## The module is configuration, so the tests are about behaviour

`src/index.js` mostly assembles options for @nuxtjs/auth-next. A change that
looks cosmetic can switch off session renewal, and nothing fails loudly.
`test/refresh.test.js` and `test/logout.test.js` drive the real `Oauth2Scheme`
with the module's own strategy config for that reason. If a change makes one
of them fail, the question is which behaviour changed, not which assertion to
update.

## Verify against a real backend, and not as user 1

Drupal's user 1 bypasses every permission check, so a login flow that works as
`admin` proves nothing about a normal account. The consent step needs the
`grant simple_oauth codes` permission, and testing as the admin hides its
absence completely.

## This repository is public

Everything committed here is published, including comments and example code.
Do not add a URL, hostname, project name, or issue link that only makes sense
inside a private network. `yarn lint:private` catches the URL-shaped cases by
host shape. It cannot catch a bare internal project name written as prose, so
that one is on you.

## Keep the two pipelines in step

`.github/workflows/ci.yml` and `.gitlab-ci.yml` run the same checks, one where
releases are cut and one where review happens. A check added to one belongs in
the other. Nothing on the GitHub side lints the GitLab file, so `lint:yaml`
runs actionlint over the workflow in return.

Secret scanning is gitleaks, deliberately. GitLab's `Security/Secret-Detection`
template is an Ultimate-tier feature: on a non-Ultimate instance the include
produces no job at all, so the config reads as coverage while scanning
nothing.

## The toolchain is old on purpose

Nuxt 2 means Node 16 and Yarn 1, and the lockfile is Yarn 1 format. Do not
migrate the lockfile as a side effect of another change: `corepack prepare
--activate` reads the `packageManager` field, so the right manager is already
what runs.

## Commands

| Command | What it does |
| ------- | ------------ |
| `mise run ci` | Everything the pipelines run |
| `yarn lint` | JS, Markdown, spelling, private hosts |
| `yarn test` | The unit suites |
| `mise run test:e2e` | The live session check, needs a running stack |
