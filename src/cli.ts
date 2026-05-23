const DEFAULT_CONFIG_PATH = './config.json';

export type CliOptions = {
  configPath: string;
  /** CLI flag overrides config when set. */
  abortOnIncorrectOwnerHandle?: boolean;
};

export function parseCli(argv: string[]): CliOptions {
  let configPath = DEFAULT_CONFIG_PATH;
  let abortOnIncorrectOwnerHandle: boolean | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === '--abort-on-incorrect-ownerHandle') {
      abortOnIncorrectOwnerHandle = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    configPath = arg;
  }

  return {
    configPath,
    ...(abortOnIncorrectOwnerHandle !== undefined ? { abortOnIncorrectOwnerHandle } : {}),
  };
}

export function resolveAbortOnIncorrectOwnerHandle(
  cli: CliOptions,
  configValue: boolean | undefined,
): boolean {
  return cli.abortOnIncorrectOwnerHandle ?? configValue ?? false;
}
