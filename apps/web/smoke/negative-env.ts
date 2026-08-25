//
// THIS FILE MUST NOT BUILD. That is its entire job.
//
// `@strk20/protocol`'s exports map gives `./env` a `node` condition only. A client build resolves
// with `["module","browser","production","import"]`, none of which match, and there is no wildcard
// fallback past a failed condition — so the node-only surface is unreachable from the browser by
// the RESOLVER, not by a convention someone has to remember.
//
// `scripts/smoke-sdk-build.mjs` builds this file and fails if the build SUCCEEDS. Without that
// inverted assertion, the boundary is a claim nobody checks: adding a `"default"` or `"browser"`
// key to `./env` would reopen it silently, and every gate in the repository would stay green.
//
// It is deliberately outside `apps/web/tsconfig.json`'s `include` (which is `src` only): a file
// designed to fail resolution cannot also be allowed to fail `npm run typecheck`.
//
import * as env from '@strk20/protocol/env'

console.log(env)
