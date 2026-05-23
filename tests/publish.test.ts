import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  if (!existsSync('dist/bundle/scrape.mjs')) {
    execFileSync('node', ['scripts/build-cli.mjs'], { stdio: 'inherit' });
  }
});

describe('npm pack contents', () => {
  it('includes minified bins, schemas, and examples', () => {
    const json = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
    const parsed = JSON.parse(json) as Array<{ files: Array<{ path: string }> }>;
    const result = parsed[0];
    if (!result) {
      throw new Error('npm pack --dry-run returned no results');
    }
    const paths = result.files.map((file) => file.path);

    expect(paths).toContain('dist/bundle/scrape.mjs');
    expect(paths).toContain('dist/bundle/summarize.mjs');
    expect(paths).toContain('schemas/config.schema.json');
    expect(paths).toContain('schemas/state.schema.json');
    expect(paths).toContain('config.example.json');
    expect(paths).toContain('.env.example');
    expect(paths).not.toContain('src/scrape.ts');
  });

  it('bundle entry files start with a shebang', () => {
    for (const name of ['scrape.mjs', 'summarize.mjs']) {
      const text = readFileSync(`dist/bundle/${name}`, 'utf8');
      expect(text.startsWith('#!/usr/bin/env node')).toBe(true);
    }
  });
});
