import './env.js';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCli } from './cli.js';
import { loadConfig } from './config/load.js';
import { summarizeState } from './llm/summarize.js';
import { loadState } from './state/io.js';

/** Load persisted state and print an LLM summary. */
export async function runSummarize(argv: string[]): Promise<string> {
  const cli = parseCli(argv);
  const resolvedConfigPath = resolve(cli.configPath);
  await assertPathExists(resolvedConfigPath, 'Config file');

  const config = await loadConfig(resolvedConfigPath);
  await assertPathExists(resolve(config.instructionsPath), 'Instructions file');

  const state = await loadState(config.statePath);
  if (!state) {
    throw new Error(
      `State file not found: ${config.statePath}. Run pnpm scrape first (or pnpm start).`,
    );
  }

  const summary = await summarizeState(config, state);
  process.stdout.write(`${summary}\n`);
  return summary;
}

async function assertPathExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
}

async function main(): Promise<void> {
  await runSummarize(process.argv);
}

const entryPath = process.argv[1];
const isMain = entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
