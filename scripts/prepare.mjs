import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Husky only when developing from a git clone (not on npm install of the published package). */
if (existsSync('.git') && existsSync('node_modules/husky/package.json')) {
  const result = spawnSync('husky', { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
