export const LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'openrouter',
  'opencode',
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type LlmConfig = {
  provider: LlmProvider;
  model: string;
  /** Sampling temperature for generateText */
  temperature?: number;
};

export type AppConfig = {
  ownerHandle: string;
  timeWindowMinutes: number;
  statePath: string;
  instructionsPath: string;
  monitored: string[];
  headless: boolean;
  llm: LlmConfig;
  /** When true, exit if login is required or ownerHandle does not match (default: wait in browser). */
  abortOnIncorrectOwnerHandle?: boolean;
  /** Chrome user-data directory; cookies and localStorage persist across runs. */
  browserProfilePath?: string;
  /**
   * Attach to Chrome started with --remote-debugging-port (e.g. http://127.0.0.1:9222).
   * Most reliable for login — avoids Playwright/FedCM issues in a fresh profile.
   */
  browserCdpEndpoint?: string;
  /** IANA timezone passed to the summarization prompt (e.g. America/Sao_Paulo). */
  timezone?: string;
  /** Parallel browser tabs for post-detail scraping (default 10 when loaded). */
  parallelTabs?: number;
  /**
   * When true, run the LLM even if `state.posts` is empty (default: skip LLM and return '').
   */
  summarizeNoPosts?: boolean;
};
