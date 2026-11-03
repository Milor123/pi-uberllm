# pi-uberllm

A [Pi](https://pi.dev) extension that adds [UberLLM](https://uberllm.dev) as a model provider.

<img width="825" height="495" alt="imagen" src="https://github.com/user-attachments/assets/cdf19f0e-1b14-4490-879e-b74de656c0c0" />


It reads UberLLM's live model catalog and registers it with Pi, so every model
UberLLM serves shows up in the `/model` picker. There is no model list to
maintain by hand.

| Provider | UberLLM surface | Models |
| --- | --- | --- |
| `uberllm` | OpenAI-compatible — `https://api.uberllm.dev/v1` | every chat model UberLLM serves |
| `uberllm-anthropic` | Anthropic-compatible — `https://api.uberllm.dev` | `anthropic/*` (Claude) |

The catalog is refreshed at startup and on every new session, so models that
appear or disappear on UberLLM's marketplace show up without restarting Pi.

## Install

```bash
pi install git:github.com/Milor123/pi-uberllm
```

Pin a version instead of tracking the default branch:

```bash
pi install git:github.com/Milor123/pi-uberllm@v0.2.0
```

To try it for one invocation without adding it to your settings:

```bash
pi -e git:github.com/Milor123/pi-uberllm
```

## Setup

Set your UberLLM API key once. It starts with `ull_` and is created at
<https://uberllm.dev/dashboard/keys>.

```powershell
# Windows (persistent, user scope)
setx UBERLLM_API_KEY "ull_your_key_here"
```

```bash
# macOS / Linux
export UBERLLM_API_KEY="ull_your_key_here"
```

Restart your terminal and Pi afterwards. Then run `/model` and pick anything
under `UberLLM`.

**Is it plug and play?** Yes, after those two steps: install the package and set
the key. You do **not** need to edit `models.json`, `settings.json` or
`auth.json`, and the key is never written to a config file — the extension
declares `apiKey: "$UBERLLM_API_KEY"` and Pi resolves it from the environment.

Alternatively, run `/login` and pick `uberllm` to store the key through Pi
instead of using an environment variable.

## Why two providers

UberLLM speaks both wire formats, and the split is not cosmetic — it decides
whether prompt caching works.

Anthropic-style prompt caching needs `cache_control` markers on the request. Pi
emits those itself on the `anthropic-messages` API and does **not** on the
OpenAI-compatible one. Routing Claude through `/v1/messages` keeps caching in
Pi's hands instead of relying on the aggregator to inject it, which is the
difference between paying cache-read rates and paying full input rates.

UberLLM publishes `cache_read_usd` and `cache_write_usd` per model, and both are
mapped into Pi's model cost. Without that mapping Pi reports cached tokens at
the input rate and the session total does not match the UberLLM bill.

Prompt cache warming is deliberately **off**. A warm-up request is a billed
request against prepaid credit, so this extension leaves `promptCache` unset. To
opt in, add `promptCache: { short: 300, long: 3600 }` to the model in
`src/catalog.ts`.

To see whether caching is actually happening, set `"showCacheMissNotices": true`
in Pi's `settings.json`.

## Compatibility notes

Pi's guidance is to set compatibility flags only for differences verified
against the real service, never because an endpoint advertises compatibility.
This extension sets exactly one, in `src/catalog.ts`:

- `supportsDeveloperRole: false` on the OpenAI-compatible surface. UberLLM
  rejects OpenAI's `developer` role with
  `developer is not one of ['system', 'assistant', 'user', 'tool', 'function']`,
  and Pi auto-detects the flag as enabled for a base URL it does not know.

Reasoning uses the OpenRouter wire format, because UberLLM documents its catalog
as OpenRouter-shaped and uses OpenRouter's names in `supported_parameters`.

Every Pi thinking level was verified against the live service:

| Pi level | Sent as | Result |
| --- | --- | --- |
| `off` | `reasoning: { effort: "none" }` | accepted, zero reasoning tokens |
| `minimal` … `max` | `reasoning: { effort: "<level>" }` | accepted |

No `thinkingLevelMap` is needed, because every Pi level maps 1:1. When a model
does not offer the level you picked, UberLLM returns the nearest level it does
offer instead of failing. Note that UberLLM rejects the spellings `"off"` and
`"disabled"` with HTTP 400 — Pi sends `"none"`, so this never triggers, and the
`"openai"` format has no equivalent for a disabled level anyway.

Models are filtered to `type: "chat"`, `available: true` and `nsfw: false`.
UberLLM's `available` flag is live marketplace state: a model with no seller
right now answers `503 no_available_provider`, so it is not offered.

## Development

```bash
npm test
```

The mapping logic lives in `src/catalog.ts` with no network access and no Pi
runtime dependency, so it is unit tested directly. `src/index.ts` owns fetching
and provider registration.

To work on it against your own Pi install, point a directory at the repository.
On Windows a junction works and needs no privileges:

```powershell
mklink /J "%USERPROFILE%\.pi\agent\extensions\uberllm" "C:\path\to\pi-uberllm"
```

On macOS and Linux:

```bash
ln -s /path/to/pi-uberllm ~/.pi/agent/extensions/uberllm
```

A single-file symlink does not work for this extension: `src/index.ts` imports
`./catalog`, which must resolve inside the loaded directory.

## License

MIT — see [LICENSE](LICENSE).
