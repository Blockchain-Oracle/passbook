//
// One dynamic-segment function for every leaf under this prefix, re-exporting the shared proxy
// handler. Collapses what used to be a literal file per leaf — the Vercel Hobby plan caps a
// deployment at 12 functions, and a single-segment dynamic file at this nested depth routes
// exactly as the per-leaf files did (the 27-Aug measurement was about the TOP-LEVEL catch-all
// not matching nested paths, not about a real function file sitting at this depth).
//
export { default, config } from '../[...path].js'
