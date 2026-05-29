import './env.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeState } from './llm/summarize.js';
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
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
