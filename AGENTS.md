# AGENTS.md — x-summary

This file is the canonical guide for humans and coding agents working in this repository. Keep it accurate.

## Self-update protocol (required)

Record durable project behavior in its owning documentation source. Runtime and product details live in [the runtime reference](./docs/agent-runtime-reference.md); keep this file focused on agent workflow, QA, and navigation.

Before finishing a task that changes config behavior, check that [README.md](./README.md) documents every field and constraint in `schemas/config.schema.json`. Treat the schema as canonical.

## Agent workflow and PR readiness

- For nontrivial implementation, load `.agents/skills/poteto-mode/SKILL.md` before work and run `.agents/skills/thermos/SKILL.md` before handoff. Review a PR against its merge-base with `.agents/skills/code-review/SKILL.md` when an originating spec exists. Its GitHub issue source is `docs/agents/issue-tracker.md`.
- For Codex, use native subagents for upstream `Task` roles. In Thermos,
  give one reviewer `.agents/skills/thermo-nuclear-review/SKILL.md` and another
  `.agents/skills/thermo-nuclear-code-quality-review/SKILL.md`, then synthesize
  their findings.
- Before publishing, inspect every commit and the final diff. Fold a correction to code introduced earlier on this branch into the introducing commit with a fixup and autosquash. Keep an independent improvement or a fix to base-branch code as a separate commit. Use `.agents/skills/git-history-cleanup/SKILL.md` for a private linear series that needs broader regrouping.
- Add a test only when it proves distinct behavior or a regression that existing tests do not cover. Keep existing QA and coverage gates.
- After a failed check, PR review, or chat feedback, reflect on any durable lesson and update its owning documentation in the relevant original commit. Use `.agents/skills/reflect/SKILL.md` when its trigger applies. Never self-update non-owned installed skills under `~/.agent/skills/`, `~/.agents/skills/`, or project `.agents/skills/` tracked by a skill lock. For owned skills, edit source in `barbieri-playground/skills`, open a PR for Gustavo to review, and update consumers only after merge.

## Project and runtime reference

Read [the runtime and product reference](./docs/agent-runtime-reference.md) when changing scraping, persisted state, summarization, browser operations, or packaging.

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
