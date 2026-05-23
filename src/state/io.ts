import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppState } from '../types/state.js';
import { assertValid } from '../validate/ajv.js';
import { parseJson, stringifyJson } from '../validate/json.js';

export async function loadState(statePath: string): Promise<AppState | null> {
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = parseJson(raw);
    return await assertValid<AppState>('state.schema.json', parsed, 'State');
  } catch (error) {
    if (isENOENT(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveState(statePath: string, state: AppState): Promise<void> {
  await assertValid('state.schema.json', state, 'State');
  await mkdir(dirname(statePath), { recursive: true });
  await backupExistingState(statePath);
  await writeFile(statePath, stringifyJson(state), 'utf8');
}

async function backupExistingState(statePath: string): Promise<void> {
  const backupPath = `${statePath}.bkp`;
  try {
    await access(statePath);
  } catch (error) {
    if (isENOENT(error)) {
      return;
    }
    throw error;
  }
  try {
    await access(backupPath);
    await unlink(backupPath);
  } catch (error) {
    if (!isENOENT(error)) {
      throw error;
    }
  }
  await rename(statePath, backupPath);
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
