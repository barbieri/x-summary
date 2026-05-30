import * as esbuild from 'esbuild';

const BUNDLE_DIR = 'dist/bundle';

/** Playwright must stay external (browser downloads, native layout). */
const EXTERNAL = ['playwright', 'playwright-core'];

/** Shared build options (applied to every bundle). */
const BASE_OPTIONS = {
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
};

/** Each entry point sets its own name so bundled child modules skip their `isMain` guard. */
const ENTRIES = [
  { name: 'scrape', path: 'src/scrape.ts' },
  { name: 'summarize', path: 'src/summarize.ts' },
  { name: 'x-summary', path: 'src/x-summary.ts' },
];

for (const { name, path } of ENTRIES) {
  await esbuild.build({
    ...BASE_OPTIONS,
    entryPoints: { [name]: path },
    define: { __BUNDLE_ENTRY_NAME: JSON.stringify(name) },
  });
}

console.log(`Wrote minified CLI bundles to ${BUNDLE_DIR}/`);
