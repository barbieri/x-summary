# x-summary

Summarize your X (Twitter) **Following** (Recent) feed and **For You** suggestions for the last N minutes using Playwright and an LLM.

## Requirements

- Node.js ≥ 24.15
- Google Chrome (Playwright `channel: "chrome"`)
- API key(s) for your chosen LLM provider

## Install (npm)

Published builds ship minified CLI bundles; runtime libraries (Playwright, Pino, AI SDK, etc.) are installed as npm dependencies.

```bash
mkdir x-summary-run && cd x-summary-run
npm init -y
npm install x-summary
npx playwright install chrome
cp node_modules/x-summary/config.example.json config.json
cp node_modules/x-summary/INSTRUCTIONS.example.md INSTRUCTIONS.md
cp node_modules/x-summary/.env.example .env
```

Edit `config.json`, `INSTRUCTIONS.md`, and `.env` (API keys). Then run them in one go:

```bash
npx x-summary config.json
```

Or run them individually:

```bash
npx x-summary-scrape config.json
npx x-summary-summarize config.json
```

Global install (optional):

```bash
npm install -g x-summary
npx playwright install chrome
# run from a directory with config.json, INSTRUCTIONS.md, and .env
x-summary config.json
```

`playwright install chrome` downloads browser support for the Playwright version bundled as a dependency. Run it once per machine (or after upgrading `x-summary`).

## Quick start (from source)

For development or contributing, clone the repo and use pnpm:

```bash
pnpm install
pnpm exec playwright install chrome        # If you don't have Chrome already installed
cp config.example.json config.json         # You MUST edit it and add your handle
cp INSTRUCTIONS.example.md INSTRUCTIONS.md # Adjust to your personal preferences
cp .env.example .env                       # Add API keys for your LLM provider
pnpm run start
```

On first run (or when logged out), a **visible Chrome window** opens via Playwright’s **persistent context** (`launchPersistentContext`). Cookies, `localStorage`, and other site data are stored on disk under `browserProfilePath` (default `./tmp/browser-profile`) and **reused on every run** — not an ephemeral test browser.

You must login to https://x.com/i/flow/login, but do so avoiding things such as PassKeys or FedCM as they may need revalidation.

Only one process should use a profile at a time. The script waits until you log in and `ownerHandle` matches.

To **exit immediately** on login/owner mismatch instead of waiting:

```bash
pnpm run start -- --abort-on-incorrect-ownerHandle
```

Or set `"abortOnIncorrectOwnerHandle": true` in `config.json`. The CLI flag overrides the config value when present.

## Configuration

Copy and edit `config.example.json`. Fields and defaults are defined in [`schemas/config.schema.json`](./schemas/config.schema.json); config and state files are validated with Ajv before use.

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `ownerHandle` | yes | — | Logged-in user handle; session must match before scraping |
| `timeWindowMinutes` | yes | — | Collect posts from the last N minutes (integer ≥ 1) |
| `instructionsPath` | yes | — | Path to `INSTRUCTIONS.md` prepended to the LLM prompt |
| `monitored` | yes | — | Handles not followed but included in summarization (unique strings) |
| `llm` | yes | — | `provider`, `model`, optional `temperature` (see below) |
| `statePath` | no | `./tmp/state.json` | Scrape state JSON path; previous file is backed up as `{statePath}.bkp` on save |
| `headless` | no | `true` | When `false`, run the scrape browser visibly |
| `abortOnIncorrectOwnerHandle` | no | `false` | When `true`, exit on login required or owner mismatch instead of waiting |
| `browserProfilePath` | no | `./tmp/browser-profile` | Chrome user-data dir reused across runs (cookies, storage) |
| `browserCdpEndpoint` | no | — | Optional CDP URL (e.g. `http://127.0.0.1:9222`) to attach to Chrome you start manually |
| `timezone` | no | — | Optional IANA timezone for summarization (e.g. `America/Sao_Paulo`) |
| `parallelTabs` | no | `4` | Browser tabs used in parallel for post-detail and reference scraping (lower if X rate-limits) |
| `summarizeNoPosts` | no | `false` | When `false`, an empty `posts` map skips the LLM and prints an empty summary; set `true` to still call the LLM (e.g. custom or translated no-posts message via `INSTRUCTIONS.md`) |

`llm.provider` must be one of: `openai`, `anthropic`, `google`, `xai`, `openrouter`, `opencode`.

| `llm` field | Required | Default | Description |
|-------------|----------|---------|-------------|
| `provider` | yes | — | LLM provider id |
| `model` | yes | — | Model name for the provider |
| `temperature` | no | - | Sampling temperature passed to `generateText` (0–1), use a lower value such as `0.1`. Reasoning models (ie: GPT-5.x) does not support temperature and will issue a warning |

## Login (two Chrome launches)

X blocks Playwright on the login page (remote-debugging detection). The flow is:

1. **Login window** — `loginContextOptions()`: visible Chrome, `ignoreDefaultArgs: true`, opens `https://x.com/i/flow/login`. Playwright does not control it; you log in and **close Chrome**.
2. **Scrape window** — `persistentContextOptions()`: your tuned scrape profile; cookies from step 1 are reused from `browserProfilePath`.

If auth cookies are missing **or** the logged-in account does not match `ownerHandle`, step 1 runs automatically before scraping.

## Login troubleshooting (FedCM / `onboarding/task.json` 400)

`[GSI_LOGGER]: FedCM get() rejects with NetworkError` and `onboarding/task.json 400` usually mean **Google Sign-In failed** in an automated browser — X never received `auth_token` / `ct0` cookies.

The default persistent profile uses **installed Chrome** (`channel: "chrome"`) with stealth flags and FedCM disabled — not Playwright’s bundled Chromium.

## Logging

Scrape logs use [Pino](https://getpino.io/) and are written as **JSON lines** (one object per line). Set verbosity in `.env`:

```bash
LOG_LEVEL=debug   # trace | debug | info | warn | error | fatal (default: info)
```

For human-readable, colorized output during development, pipe through [pino-pretty](https://github.com/pinojs/pino-pretty) (included as a dev dependency when working from source):

```bash
pnpm run scrape 2>&1 | pnpm exec pino-pretty
pnpm run start 2>&1 | pnpm exec pino-pretty
```

Useful flags:

```bash
pnpm run scrape 2>&1 | pnpm exec pino-pretty --colorize --translateTime 'SYS:standard'
```

When installed from npm, add `pino-pretty` locally or pipe via `npx`:

```bash
npx x-summary-scrape config.json 2>&1 | npx pino-pretty
```

Merge stdout and stderr (`2>&1`) so browser and scrape messages stay in order.

## Development

```bash
pnpm run check       # biome check --error-on-warnings
pnpm run typecheck
pnpm run test
pnpm run build       # tsc + minified CLI bundles (dist/bundle/*.mjs)
pnpm run build:cli   # esbuild only
pnpm run inspect:x config.json --action home-following   # dump X DOM for scraper work
pnpm run scrape [config.json]                            # scrape → save state (tsx)
pnpm run summarize [config.json]                         # summarize persisted state (tsx)
pnpm run x-summary [config.json]                         # scrape then summarize (tsx)
pnpm run start [config.json]                             # scrape then summarize (tsx alias to x-summary)
pnpm run scrape:bundle [config.json]                     # minified bundle (after build)
pnpm run summarize:bundle [config.json]                  # minified bundle (after build)
pnpm run x-summary:bundle [config.json]                  # minified bundle (after build)
pnpm run start:bundle [config.json]                      # minified bundle (after build)
```

Agent-oriented project rules live in [AGENTS.md](./AGENTS.md).
