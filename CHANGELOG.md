# Changelog

Pi reads this file after a package update and shows entries newer than the last
version it saw, under "Extension Updates". For that reason every released
version needs a `## [x.y.z]` heading — the version must match `package.json`, or
nothing is shown.

## [0.2.1]

Packaging release. No runtime behaviour changed.

- **Available on npm**, which is what makes the package show up in the Pi
gallery — it indexes npm by the `pi-package` keyword.
- **`CHANGELOG.md` ships in the tarball.** Pi reads it from the package root, so
the changelog you are reading never reached npm users before.
- A release workflow publishes on any `v*` tag push, runs the tests first, and
uses npm provenance to sign the tarball against this repository and commit.

## [0.2.0]

### Fixed

- **A failed catalog refresh no longer drops the provider.** Pi aborts a
  model-catalog refresh after 15 seconds, and one slow provider could take that
  abort out on the others, surfacing as `Could not refresh ... uberllm,
  uberllm-anthropic; showing cached models`. A failed refresh now serves the
  last good catalog and logs the underlying failure instead of propagating it.

### Verified

- **Reasoning on every Pi thinking level.** `off` sends
  `reasoning: { effort: "none" }` and returns zero reasoning tokens; `minimal`
  through `max` pass through 1:1. UberLLM snaps to the nearest level a model
  offers rather than erroring, so no `thinkingLevelMap` is needed.
- **Install paths.** `pi -e git:github.com/Milor123/pi-uberllm` and the pinned
  `@v0.2.0` form both load the providers from an empty agent directory.

### Changed

- Tests run on Node 24 in CI (Node 22 cannot strip TypeScript types) with the
  current action majors.

## [0.1.0]

Initial release.

- Registers UberLLM's live catalog as two providers: `uberllm` on the
  OpenAI-compatible surface and `uberllm-anthropic` on the Anthropic-compatible
  one, so prompt caching works for Claude models.
- Maps all four UberLLM prices, including `cache_read_usd` and `cache_write_usd`,
  into Pi's cost accounting.
- Filters models that cannot answer a chat request: non-`chat` types,
  `available: false`, and `nsfw: true`.
- Reads the API key from `UBERLLM_API_KEY`; no key is written to any config.
