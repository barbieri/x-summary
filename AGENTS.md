# AGENTS.md — x-summary

This file is the canonical guide for humans and coding agents working in this repository. Keep it accurate.

## Self-update protocol (required)

When you learn something **durable** about this project (architecture, conventions, X DOM behavior, provider quirks, validation rules, or operational steps), **update this file in the same change** before finishing the task.

Add or revise a short bullet under the best matching section. Do not duplicate existing guidance. Remove outdated bullets when behavior changes.

Before finishing any task that touches config (schema, loader, `config.example.json`, or config behavior), **check that [README.md](./README.md) documents every field and constraint in `schemas/config.schema.json`**; update README in the same change if it is missing or stale. Treat the schema as the canonical source.

## Project overview

`x-summary` uses **Playwright** to control a logged-in browser session on `https://x.com/home`, scrapes timeline posts, persists structured JSON state, and summarizes via the **Vercel AI SDK** (`generateText`).

Feeds collected (in order):

1. **Following → Recent** (open Following tab menu, choose Recent)
2. **For You suggestions** (`forYouSuggestions`) — algorithmic suggestions; posts already collected in Following are skipped via a separate `href` set
3. **Monitored** handles (profiles not followed but listed in config)

Scraping walks top-to-bottom until:

- A post URL exists in the previous state, or
- A post `timestamp` is older than `timeWindowMinutes`

## Repository layout

| Path | Purpose |
|------|---------|
| `src/scrape.ts` | CLI: scrape timelines → save state |
| `src/summarize.ts` | CLI: load state → LLM summary |
| `src/logger.ts` | Pino logger + scrape failure helpers |
| `src/browser/` | Playwright session, interactions, scrape, post cache |
| `src/config/` | Config load + defaults |
| `src/state/` | State read/write (pretty JSON) + `assemble.ts` (flatten scrape graph → persisted state) |
| `src/validate/` | Ajv validation |
| `src/links/` | URL redirect resolution + HTML metadata |
| `src/llm/` | Provider registry + `generateText` summarization |
| `schemas/` | JSON Schema for config and state |
| `config.example.json` | Example machine-readable config |
| `INSTRUCTIONS.example.md` | Example LLM style / content instructions |

## Tooling

- **Node** see `.nvmrc`
- **TypeScript** `tsconfig.json` extends `@tsconfig/strictest` with `"types": ["node"]`
- **pnpm** v11 for package management (`packageManager` pins Corepack version)
- **Biome** — formatting and lint (`biome.json`: JavaScript/TypeScript **single quotes**)
- **Vitest** — run `pnpm run test`. **`tests/live-x-posts.test.ts`** and **`tests/tweet-detail-api.test.ts`** hit real X status pages (requires logged-in browser profile with `auth_token`/`ct0`; `fileParallelism: false` in `vitest.config.ts` so they share one Chrome profile). TweetDetail parser tests fetch **live GraphQL JSON** from X and compare parser-relevant **shape** against `tests/fixtures/tweet-detail/*.json` snapshots (fixtures are not the sole source of truth).
- **Pino** — structured scrape trace logs; browser `console`/`pageerror` logged with `source: browser`

## Formatting and QA (required before finishing work)

- **Quotes**: TypeScript/JavaScript use **single quotes** (`javascript.formatter.quoteStyle: "single"` in `biome.json`). JSON config/schema files keep standard double-quoted JSON.
- **Check locally**: run `pnpm run qa` (runs `check`, `build`, `test`, `typecheck` in parallel). Fix all issues before calling the task done.
- **Auto-fix**: `pnpm run check:fix` applies Biome format + safe lint fixes; re-run `pnpm run qa` after.
- **Pre-commit**: Husky runs `pnpm run qa` — do not commit with failing QA.
- Agents must run `pnpm run qa` after their changes and fix any failures before handing work back.

## JSON and validation

- All machine-readable artifacts are **JSON**, pretty-printed with 2-space indent and trailing newline.
- Validate with **Ajv** against `schemas/*.schema.json` before persisting.
- `config.example.json` is checked in tests against `schemas/config.schema.json`.
- On `saveState`, validate against `state.schema.json`, then if the state file exists rename it to `{statePath}.bkp` (unlink an existing `.bkp` first), then write the new snapshot.
- Config default `statePath`: `./tmp/state.json`

## Post object rules (scraping)

| Field | Meaning |
|-------|---------|
| `href` | Canonical post URL |
| `author` | Author handle |
| `timestamp` | ISO8601 publish time |
| `stats` | `{ comments, reposts, likes }` |
| `body` | Markdown (omitted on bare reposts) |
| `references` | Quoted / referenced posts (nested `Post` while scraping; href keys in `posts` when saved) |
| `thread` | Thread ancestors (nested `Post` while scraping; href keys in `posts` when saved) |
| `links` | `{ url, title?, description? }` resolved externally |

Scraping behavior:

1. **Timeline walk** (`src/browser/scrape.ts`): collect post status URLs from feed articles (href + timestamp for stop conditions only); timeline stays on one tab.
2. **Post detail** (`src/browser/tweet-detail-api.ts` + `src/browser/post-detail.ts`): primary source is **TweetDetail GraphQL** captured on `page.goto` / reload — body, stats, author, timestamp, media URLs (`pbs.twimg.com`, `/video/`, broadcasts), quotes (`quoted_status_result`), thread chain (`in_reply_to_status_id_str`), bare reposts (`retweeted_status_result`). **No `blob:` video URLs.** DOM parsing is fallback only when API capture fails. The main timeline tab scrapes one post at a time, then **`scrollPastArticle`**. DOM parsing has a **60s** timeout; link resolution runs afterward with **30s** per URL.
3. **External links**: resolved with a **30s** per-URL timeout; failures keep `{ url }` only (no title/description). Only `http:` / `https:` URLs are resolved; loopback, localhost, link-local, private, multicast, carrier-grade NAT, and private DNS targets are blocked before each request and redirect hop.
4. **Body** from TweetDetail `full_text` / `note_tweet` → markdown via `plainTextToMarkdown` and `entities.urls`. **Links**: `entities.urls`, `extended_entities.media` (`media_url_https`, `expanded_url`, video `variants`), card bindings — never `blob:` from DOM video elements. External links follow redirects even when HTML metadata fetch fails (403).
5. **Link state safety**: before a link is cached or persisted, `PostProcessor` must accept only valid `http:` / `https:` URLs after `new URL(...).toString()` normalization, then de-duplicate by normalized URL. Invalid raw links or invalid resolver results are logged at `warn` and skipped so state validation cannot fail on a bad link.
6. **Quotes / threads / reposts**: from `quoted_status_result`, `in_reply_to_status_id_str` chain, and `retweeted_status_result` in TweetDetail JSON. DOM fallback only when API capture fails.
7. **Threads**: multiple conversation articles before the focal tweet (same status id as the page URL) — parsed inline; not replies below the focal post.
8. Click **Show more** / **Show N posts** with human-paced delays (500ms + random jitter).
9. After timeline UI actions, **wait for network idle** and `aria-busy="false"` before reading DOM. Post detail pages use **`waitForConversationReady`** (conversation timeline + first article) instead of `networkidle`, which is too slow under parallel tabs.
10. Prefer **role**, **accessible name**, **href**, **aria-***, and **data-testid** — avoid CSS class selectors.
11. Browser locale is **`en-US`**.
12. **Post cache** (`PostProcessor`): reuse scraped posts by `href` when the same item appears again. Inline **thread** snapshots are finalized for link metadata but are **not** cached under their href (avoids partial thread rows blocking a full detail scrape).
13. **Cycle guard** (separate `Set<href>`): stop adding `references` / `thread` entries when a cycle is detected.
14. **Following dedup set** (separate from cycle guard): skip For You suggestions already collected in Following.

## Persisted state shape

| Field | Meaning |
|-------|---------|
| `timestamp` | When this snapshot was written |
| `cutoffTimestamp` | Absolute ISO8601 window start (not a duration); first run ≈ scrape time − timeWindowMinutes, incremental = previous `timestamp` |
| `posts` | All post payloads keyed by canonical href (`author`, `timestamp`, `stats`, `body`, `links`, `references`, `thread`) |
| `following` | Ordered hrefs into `posts` (Following > Recent) |
| `forYouSuggestions` | Ordered hrefs into `posts` |
| `monitored` | Per-handle ordered hrefs into `posts` |
| `references` / `thread` (in `posts`) | Href lists pointing at other keys in `posts` |

## LLM summarization

- Uses `ai` package `generateText()` with `config.llm.temperature` (default `0.2`).
- Prompt = JSON structure preamble + optional `config.timezone` (IANA) + `INSTRUCTIONS.md` + **minified** state JSON.
- When `state.posts` is empty and `config.summarizeNoPosts` is `false` (default), summarization returns an empty string and **does not** call the LLM. Set `summarizeNoPosts: true` to still invoke the LLM so `INSTRUCTIONS.md` can define a custom no-posts message (e.g. tone or language).
- Built-in providers: OpenAI, Anthropic, Google, xAI, OpenRouter, OpenCode.
- Extend via `registerLlmProvider()` in `src/llm/providers.ts`.

### Environment variables

| Provider | Typical env vars |
|----------|------------------|
| openai | `OPENAI_API_KEY` |
| anthropic | `ANTHROPIC_API_KEY` |
| google | `GOOGLE_GENERATIVE_AI_API_KEY` |
| xai | `XAI_API_KEY` |
| openrouter | `OPENROUTER_API_KEY` |
| opencode | OpenCode CLI + provider keys in OpenCode config |

| `LOG_LEVEL` | Pino level (default `info`) |

Load API keys and `LOG_LEVEL` from a `.env` file in the project root via **dotenv** (`src/env.ts` imported first in CLI entrypoints; Vitest uses `tests/setup-env.ts`).

## Code conventions

- ESM (`"type": "module"`), `.js` extensions in TypeScript imports.
- Playwright logic lives under `src/browser/`; use `logScrapeFailure()` for errors with action + expected + missing context.
- Minimize scope of changes; match existing style (Biome-formatted, single quotes in `.ts`).
- Do not commit secrets, `tmp/`, or browser profile data.

## Commands

```bash
pnpm install
pnpm run qa             # required gate: check + build + test + typecheck
pnpm run build          # tsc + minified CLI bundles (dist/bundle/*.mjs)
pnpm run build:cli      # esbuild only (minified scrape + summarize)
pnpm run check          # biome check --error-on-warnings
pnpm run check:fix      # biome check --write --error-on-warnings
pnpm run typecheck
pnpm run inspect:x config.json --action home-following   # dump X DOM for scraper work
pnpm run scrape [config.json]                            # scrape → save state (tsx)
pnpm run summarize [config.json]                         # summarize persisted state (tsx)
pnpm run scrape:bundle [config.json]                     # minified bundle from pnpm build
pnpm run summarize:bundle [config.json]                  # minified bundle from pnpm build
pnpm run test
pnpm run start [config.json]                             # scrape then summarize
```

## npm publish

- **`prepublishOnly`** runs `pnpm run build` (minified `dist/bundle/*.mjs` with shebangs).
- **`files`** ships bundles, `schemas/`, examples, and docs only (no `src/` or dev tooling).
- **`bin`**: `x-summary-scrape`, `x-summary-summarize` → `dist/bundle/*.mjs`.
- **Runtime deps** (including `playwright`) are normal `dependencies`; users run `npx playwright install chrome` after install.
- **`prepare`** runs Husky only in a git clone with dev deps, not on end-user `npm install`.

## Operational notes

- **Login / owner fix**: `runManualLoginWindow()` uses `loginContextOptions()` when auth is missing **or** `ownerHandle` mismatches (non-CDP). User closes Chrome; then scrape session relaunches. **Never** `page.goto` login URL on the scrape context.
- **Scrape**: `openPersistentSession()` → `persistentContextOptions()` + stealth script. Re-open after login window if `auth_token`/`ct0` missing.
- **Early stop**: `src/scrape.ts` handles `SIGTERM` by logging, closing the active Playwright browser/session, and exiting with code `1`; it skips `saveState` if the signal arrives before persistence starts.
- Session cookies: `auth_token` + `ct0` (`hasXAuthCookies`). Use email/password, not Google.
- If login is required or `ownerHandle` does not match (non-CDP): manual login window, then scrape session relaunch (see README).
- X DOM changes often — update `src/browser/scrape.ts` and document the fix here.
- **Following sort (home)**: `[data-testid="ScrollSnap-List"]` → Following `[role="tab"]` opens a detached `[role="menu"]` containing Popular/Recent `[role="menuitem"]` (no `data-testid="Dropdown"`). One tab click only — do not click again while the menu overlay is open.
- **Timeline posts**: virtualized list under `[aria-label="Timeline: Your Home Timeline"]`; scrape one post at a time on the main tab, then `scrollPastArticle` (scroll into view + wheel on the feed column / scroll parent) so the next items load; fallback `scrollTimelineDown` when no new articles are visible. Skip ads in `[data-testid="placementTracking"]`.
- **Tweet body**: `[data-testid="tweetText"]` HTML → markdown (emoji `img` uses `alt`); if `[data-testid="tweet-text-show-more-link"]` exists, open the status URL for the full body.
- This project is not intended to be used as a library, there is no need to keep API compatible. **NEVER** leave deprecated functions, always port the whole code to use the new version of the function when it changes.
