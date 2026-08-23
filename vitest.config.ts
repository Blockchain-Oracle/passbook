import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    // Only OUR source is tested. The vendored clones under reference/ (Uniswap, Yosuku) and every
    // node_modules carry their own suites that are not ours to run and fail in this environment —
    // exclude them so `vitest run` reports Passbook's real status.
    include: ['packages/*/test/**/*.test.ts', 'web/**/*.test.js', 'scripts/**/*.test.{ts,js,mjs}'],
    exclude: ['**/node_modules/**', 'reference/**', 'contracts/**', 'dist/**'],
  },
})
