import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveState } from '../src/state/io.js';
import type { AppState } from '../src/types/state.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CUTOFF = '2026-05-22T11:00:00.000Z';

function emptyState(): AppState {
  return {
    timestamp: '2026-05-22T12:00:00.000Z',
    cutoffTimestamp: CUTOFF,
    posts: {},
    following: [],
    forYouSuggestions: [],
    monitored: {},
  };
}

async function makeTempStatePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'x-summary-state-'));
  tempDirs.push(dir);
  return join(dir, 'state.json');
}

describe('saveState', () => {
  it('renames an existing state file to .bkp before writing', async () => {
    const statePath = await makeTempStatePath();
    const backupPath = `${statePath}.bkp`;
    await writeFile(statePath, '{"old":true}\n', 'utf8');

    await saveState(statePath, emptyState());

    await expect(readFile(statePath, 'utf8')).resolves.toContain('"posts": {}');
    await expect(readFile(backupPath, 'utf8')).resolves.toBe('{"old":true}\n');
  });

  it('replaces an existing .bkp before backing up the current state', async () => {
    const statePath = await makeTempStatePath();
    const backupPath = `${statePath}.bkp`;
    await writeFile(backupPath, '{"stale":true}\n', 'utf8');
    await writeFile(statePath, '{"current":true}\n', 'utf8');

    await saveState(statePath, emptyState());

    await expect(readFile(backupPath, 'utf8')).resolves.toBe('{"current":true}\n');
    await expect(readFile(statePath, 'utf8')).resolves.toContain('"posts": {}');
  });

  it('writes state when no previous file exists', async () => {
    const statePath = await makeTempStatePath();
    const backupPath = `${statePath}.bkp`;

    await saveState(statePath, emptyState());

    await expect(readFile(statePath, 'utf8')).resolves.toContain('"posts": {}');
    await expect(access(backupPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
