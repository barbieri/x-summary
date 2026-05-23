import * as esbuild from 'esbuild';

const BUNDLE_DIR = 'dist/bundle';

/** Playwright must stay external (browser downloads, native layout). */
const EXTERNAL = ['playwright', 'playwright-core'];

await esbuild.build({
  entryPoints: {
    scrape: 'src/scrape.ts',
    summarize: 'src/summarize.ts',
  },
  outdir: BUNDLE_DIR,
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  format: 'esm',
  target: 'node24.15.0',
  bundle: true,
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  banner: { js: '#!/usr/bin/env node\n' },
  /** Bundle app code only; node_modules stay external (CJS-safe at runtime). */
  packages: 'external',
  external: EXTERNAL,
});

console.log(`Wrote minified CLI bundles to ${BUNDLE_DIR}/`);
