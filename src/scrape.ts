import './env.js';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeTimelines } from './browser/scrape.js';
import {
  acquireBrowserSession,
  type BrowserSession,
  closeBrowser,
  ensureOwnerSession,
} from './browser/session.js';
import { parseCli, resolveAbortOnIncorrectOwnerHandle } from './cli.js';
import { loadConfig } from './config/load.js';
import { createScrapeLogger } from './logger.js';
import { loadState, saveState } from './state/io.js';
import type { AppState } from './types/state.js';

/** Scrape timelines and persist state to `config.statePath`. */
export async function runScrape(argv: string[]): Promise<AppState> {
  const start = Date.now();
  const getElapsedInSeconds = () => (Date.now() - start) / 1000;

  const cli = parseCli(argv);
  const resolvedConfigPath = resolve(cli.configPath);
  await assertPathExists(resolvedConfigPath, 'Config file');

  const config = await loadConfig(resolvedConfigPath);
  const log = createScrapeLogger();
  const abortOnIncorrectOwnerHandle = resolveAbortOnIncorrectOwnerHandle(
    cli,
    config.abortOnIncorrectOwnerHandle,
  );

  const previousState = await loadState(config.statePath);
  let session: BrowserSession | null = null;
  let sigtermReceived = false;
  let sigtermCleanup: Promise<void> | null = null;

  const handleSigterm = (): void => {
    if (sigtermReceived) {
      return;
    }

    sigtermReceived = true;
    process.exitCode = 1;
    log.warn(
      { elapsedInSeconds: getElapsedInSeconds() },
      'SIGTERM received; stopping scrape early',
    );

    if (!session) {
      process.exit(1);
    }

    sigtermCleanup = closeBrowser(session, log)
      .catch((err: unknown) => {
        log.error(
          { err, elapsedInSeconds: getElapsedInSeconds() },
          'failed to close browser after SIGTERM: %s',
          err,
        );
      })
      .finally(() => {
        process.exit(1);
      });
  };

  process.once('SIGTERM', handleSigterm);

  try {
    session = await acquireBrowserSession(config, log);

    session = await ensureOwnerSession(session, {
      ownerHandle: config.ownerHandle,
      headless: config.headless,
      abortOnIncorrectOwnerHandle,
      log,
    });

    const state = await scrapeTimelines(session.page, { config, previousState });
    if (sigtermReceived) {
      throw new Error('Scrape stopped early after SIGTERM');
    }
    await saveState(config.statePath, state);

    log.info(
      {
        statePath: config.statePath,
        following: state.following.length,
        forYouSuggestions: state.forYouSuggestions.length,
        elapsedInSeconds: getElapsedInSeconds(),
        monitored: Object.fromEntries(
          Object.entries(state.monitored).map(([handle, posts]) => [handle, posts.length]),
        ),
      },
      'scrape complete; state saved',
    );

    return state;
  } finally {
    process.off('SIGTERM', handleSigterm);

    if (sigtermCleanup) {
      await sigtermCleanup;
    } else if (session) {
      await closeBrowser(session, log);
    }
  }
}

async function assertPathExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found: ${path}`);
  }
}

async function main(): Promise<void> {
  await runScrape(process.argv);
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
