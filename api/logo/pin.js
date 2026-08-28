//
// A literal file at a nested path, re-exporting the one proxy handler — `api/room/stream.js`'s
// reason: the catch-all only ever receives single-segment paths here (measured 27 Aug).
//
export { default, config } from '../[...path].js'
