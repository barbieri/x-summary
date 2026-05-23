import { readFile } from 'node:fs/promises';
import { DEFAULT_BROWSER_PROFILE_PATH } from '../browser/profile.js';
import type { AppConfig } from '../types/config.js';
import { assertValid } from '../validate/ajv.js';
import { parseJson } from '../validate/json.js';

const DEFAULT_STATE_PATH = './tmp/state.json';
export const DEFAULT_PARALLEL_TABS = 4;

export async function loadConfig(configPath: string): Promise<AppConfig> {
  const raw = await readFile(configPath, 'utf8');
  const parsed = parseJson(raw);
  const config = await assertValid<AppConfig>('config.schema.json', parsed, 'Config');
  return {
    ...config,
    statePath: config.statePath ?? DEFAULT_STATE_PATH,
    browserProfilePath: config.browserProfilePath ?? DEFAULT_BROWSER_PROFILE_PATH,
    llm: {
      ...config.llm,
      ...(config.llm.temperature ? { temperature: config.llm.temperature } : {}),
    },
    parallelTabs: config.parallelTabs ?? DEFAULT_PARALLEL_TABS,
  };
}
