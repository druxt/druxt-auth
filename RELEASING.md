# Releasing

The package publishes to npm from `.github/workflows/release.yml`. Nobody runs `npm publish` by hand.

| Channel     | npm dist-tag | When it publishes                                         | What it is for                        |
| ----------- | ------------ | --------------------------------------------------------- | ------------------------------------- |
| Development | `dev`        | Every push to `0.x` with a pending changeset              | Trying unreleased work on a real site |
| Stable      | `latest`     | When you merge the pull request that versions the package | Everyone else                         |

## Development releases

A push to `0.x` with a pending changeset cuts a snapshot. A snapshot version reads `0.4.1-dev.20260925004838`: the version the pending changesets add up to, then the tag and a timestamp. Install it with:

```bash
npm install druxt-auth@dev
```

Nothing is committed, no git tag is made, and `latest` does not move.

## Stable releases

1. Merge pull requests that carry changesets. See [Changesets](CONTRIBUTING.md#changesets).
2. The workflow opens a pull request titled `chore(release): version packages`, and keeps it up to date. It holds the version bump and the changelog entries.
3. Merge that pull request when the release is ready. This is the release decision.
4. The push that follows publishes the new version to `latest`. It also pushes a `version` tag, with a GitHub Release built from that version's changelog section.

## Build and publish jobs

Each channel runs as a build job followed by a publish job.

| Job     | Runs repository code          | Can publish to npm |
| ------- | ----------------------------- | ------------------ |
| Build   | Yes, install scripts included | No                 |
| Publish | No, it checks out nothing     | Yes                |

The build job ends by packing a tarball, and the publish job hands that tarball to npm. A pull request rehearses the build job only, so code in a pull request never runs with publishing rights.

## The pre-publish gate

`yarn release:check` runs before every publish, on both channels. It refuses a release when:

- a dependency uses a specifier that only resolves in this repository, such as `workspace:` or `link:`
- the version is at or below the one npm already has
- the package has no `files` list, or an entry in it was not built

`yarn release:check:test` runs its tests.

## One-time setup

Publishing uses npm trusted publishing, so there is no npm token to store or rotate. Until the setup is complete the workflow stops after packing: the tarball it would have published is attached to the run as an artifact, and nothing reaches npm.

1. On npmjs.com, open the package, then **Settings**, then **Trusted publisher**. Choose GitHub Actions, and enter the organization `druxt`, the repository `druxt-auth` and the workflow filename `release.yml`. Leave the environment empty. Under **Allowed actions**, tick **Allow npm publish**: the workflow publishes directly, and a publisher limited to staged publishing refuses it.
2. Create a GitHub App for the organization with read and write access to **Contents** and **Pull requests**, and install it on this repository. Store its ID as the repository variable `RELEASE_APP_ID` and its private key as the secret `RELEASE_APP_PRIVATE_KEY`. GitHub doesn't run checks on a pull request opened with the workflow's own token, and `0.x` requires them.
3. Set the repository variable `NPM_PUBLISH` to `true`.

The package must exist on npm before it can name a trusted publisher. It is already published, so this does not apply. A brand-new package would need its first version published by hand before step 1.
