import { createMDX } from 'fumadocs-mdx/next'

const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // `@strk20/protocol` ships TypeScript sources (`./*` → `./src/*.ts`); Next compiles them here.
  transpilePackages: ['@strk20/protocol'],
}

export default withMDX(config)
