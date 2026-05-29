import pino from 'pino';

function readLogLevel(): string {
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access required by TS4111 (noPropertyAccessFromIndexSignature).
  return process.env['LOG_LEVEL'] ?? 'info';
}

export const logger = pino(
  {
    level: readLogLevel(),
    base: { app: 'x-summary' },
  },
  pino.destination(2), // all logs should go to stderr
);

export type ScrapeLogger = pino.Logger;
export type LogLevel = pino.Level;

export function createScrapeLogger(): ScrapeLogger {
  return logger.child({ module: 'scrape' });
}

export function logScrapeFailure(
  log: ScrapeLogger,
  context: {
    action: string;
    expected?: string;
    missing?: string;
    href?: string;
    err: unknown;
  },
): void {
  const error =
    context.err instanceof Error
      ? { message: context.err.message, stack: context.err.stack, name: context.err.name }
      : { message: String(context.err) };

  log.error(
    {
      action: context.action,
      expected: context.expected,
      missing: context.missing,
      href: context.href,
      err: error,
    },
    'scrape step failed',
  );
}
