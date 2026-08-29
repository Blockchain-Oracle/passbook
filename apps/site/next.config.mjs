import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // `@strk20/protocol` ships TypeScript sources (`./*` → `./src/*.ts`); Next compiles them here.
  transpilePackages: ['@strk20/protocol'],
  // The repository carries its own rules; the dev server must not write AGENTS.md / CLAUDE.md here.
  agentRules: false,
}

export default withMDX(config)
