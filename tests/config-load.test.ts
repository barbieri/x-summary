import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/load.js';

describe('loadConfig', () => {
  it('defaults parallelTabs to 4 when omitted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'x-summary-config-'));
    const path = join(dir, 'config.json');
    await writeFile(
      path,
      JSON.stringify(
        {
          ownerHandle: 'alice',
          timeWindowMinutes: 60,
          instructionsPath: './INSTRUCTIONS.md',
          monitored: [],
          llm: { provider: 'openai', model: 'gpt-4.1' },
        },
        null,
        2,
      ),
    );

    const config = await loadConfig(path);
    expect(config.parallelTabs).toBe(4);
  });
});
