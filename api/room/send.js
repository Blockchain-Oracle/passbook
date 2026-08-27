//
// A literal file at a nested path, re-exporting the one proxy handler.
//
// The catch-all `api/[...path].js` receives SINGLE-segment paths only on this platform
// configuration (framework: null, prebuilt artifact) — measured 27 Aug: /api/x invoked the
// function while /api/directory/list 404ed at the router without an invocation. Every nested
// route the relayer serves therefore needs a real file at its exact path. The handler itself
// is unchanged and shared; only the routing entry is per-path.
//
export { default, config } from '../[...path].js'
