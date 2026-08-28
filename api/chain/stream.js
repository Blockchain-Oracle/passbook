//
// A literal file at a nested path, re-exporting the one proxy handler — `api/room/stream.js`'s
// reason verbatim: the catch-all only ever receives single-segment paths on this platform
// configuration (measured 27 Aug), so every nested relayer route needs a real file at its path.
//
export { default, config } from '../[...path].js'
