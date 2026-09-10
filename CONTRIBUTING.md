# Contributing

DruxtAuth is a configuration surface between
[@nuxtjs/auth-next](https://auth.nuxtjs.org) and Drupal Simple OAuth, so most
defects here look like a session that quietly stops working rather than a
stack trace.

## Getting set up

```sh
corepack enable && corepack prepare --activate
yarn install --frozen-lockfile
mise run hooks:install   # once per clone
```

Node 16 and Yarn 1, both declared in the repository (`.nvmrc`,
`packageManager`). `mise run install` provides them if you use mise.

## Before you push

```sh
mise run ci
```

That is every linter and the unit tests, which is what both pipelines run.
If you only touched prose, `yarn lint` is enough.

## The checks

| Check          | Guards against                                                             |
| -------------- | -------------------------------------------------------------------------- |
| `lint:js`      | Mistakes in the module, the tests and the scripts                          |
| `lint:md`      | Malformed Markdown                                                         |
| `lint:cspell`  | Typos, including in the documentation people follow                        |
| `lint:private` | Publishing a URL that only resolves on a private network                   |
| `test`         | The strategies losing behaviour nobody would notice until a session breaks |

## The end-to-end check

`test/e2e/refresh-and-logout.mjs` drives a real browser through a real login
against a running Drupal and Nuxt. It is not part of `yarn test` because it
needs that stack, and it answers the questions the unit tests cannot: whether
a session renews silently, and what survives a logout. Run it when you touch
either strategy. `test/e2e/README.md` says what it needs.

## Commits

[Conventional Commits](https://www.conventionalcommits.org). The `commit-msg`
hook checks the message, and the pipeline checks every commit on a merge
request.

Titles matter more than usual here: these repositories squash-merge, so the
pull request or merge request title becomes the commit subject. A prose title
lands on the target branch and breaks the next push.

## Changesets

User-facing changes need a changeset:

```sh
yarn changeset
```
