import './env.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeState } from './llm/summarize.js';
import { logger } from './logger.js';
import { runScrape } from './scrape.js';

/** Replaced at build time by esbuild with the entry-point name; undefined otherwise. */
declare const __BUNDLE_ENTRY_NAME: string | undefined;

/** Run scrape and then summarize sequentially. */
export async function runCombined(argv: string[]): Promise<void> {
  const { state, config } = await runScrape(argv);
  const summary = await summarizeState(config, state);
  process.stdout.write(`${summary}\n`);
}

async function main(): Promise<void> {
  await runCombined(process.argv);
}

const entryPath = process.argv[1];
const isMain =
  entryPath !== undefined &&
  resolve(entryPath) === fileURLToPath(import.meta.url) &&
  (typeof __BUNDLE_ENTRY_NAME === 'undefined' || __BUNDLE_ENTRY_NAME === 'x-summary');
if (isMain) {
  main().catch((error: unknown) => {
    logger.fatal({ err: error }, 'x-summary failed: %s', error);
    process.exit(1);
  });
}
