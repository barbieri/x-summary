import { describe, expect, it } from 'vitest';
import { parseCli, resolveAbortOnIncorrectOwnerHandle } from '../src/cli.js';

describe('parseCli', () => {
  it('uses default config path', () => {
    expect(parseCli(['node', 'x-summary'])).toEqual({ configPath: './config.json' });
  });

  it('parses config path and abort flag', () => {
    expect(
      parseCli(['node', 'x-summary', './custom.json', '--abort-on-incorrect-ownerHandle']),
    ).toEqual({
      configPath: './custom.json',
      abortOnIncorrectOwnerHandle: true,
    });
  });
});

describe('resolveAbortOnIncorrectOwnerHandle', () => {
  it('prefers CLI over config', () => {
    expect(
      resolveAbortOnIncorrectOwnerHandle(
        { configPath: './config.json', abortOnIncorrectOwnerHandle: true },
        false,
      ),
    ).toBe(true);
  });

  it('falls back to config then false', () => {
    expect(resolveAbortOnIncorrectOwnerHandle({ configPath: './config.json' }, true)).toBe(true);
    expect(resolveAbortOnIncorrectOwnerHandle({ configPath: './config.json' }, undefined)).toBe(
      false,
    );
  });
});
