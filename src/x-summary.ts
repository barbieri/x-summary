import './env.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeState } from './llm/summarize.js';
import { logger } from './logger.js';
import { runScrape } from './scrape.js';

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
const isMain = entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error: unknown) => {
    logger.fatal({ err: error }, 'x-summary failed: %s', error);
    process.exit(1);
  });
}
