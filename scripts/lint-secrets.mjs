//
// Build-time guard against the two ways a privacy product leaks by accident:
// a credential compiled into something we ship, and a third-party host the BROWSER
// talks to directly.
//
// The second is the one that actually matters here, and it is easy to miss because
// nothing breaks. FR-029's whole claim is that a third party sees the relay's address
// instead of the user's IP next to their intent. One `fetch('https://some.api/...')`
// added to web/ quietly makes that claim false, in a way no test fails on and no
// reviewer notices in a diff that is otherwise about a button. So the rule is
// mechanical: in browser code, the only hosts allowed are the ones constants.ts already
// declares, and every deliberate exception is enumerated in PROXY_EXCEPTIONS with a
// written description of what it leaks. Anything else routes through POST /api/quote.
//
// Like lint-claims, every check runs before the process exits, so one run reports every
// problem rather than one at a time.
//
// `scripts` is deliberately not a scan root: this file necessarily contains every
// pattern it bans. Do not add it.
//
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// The tree to scan. Defaults to THIS script's repository rather than the current working
// directory, so `node path/to/lint-secrets.mjs` checks the repository it belongs to from
// wherever it is invoked — a guard that silently passes because it was run from the wrong
// directory is worse than no guard. The argument exists for the tests, which point it at a
// fixture tree.
const ROOT = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url))
const at = (...parts) => join(ROOT, ...parts)

// Shapes that are a credential wherever they appear. Vendor prefixes rather than
// entropy heuristics: this repository is full of 64-hex class hashes and addresses, and
// a "long random-looking string" rule would cry wolf on every one of them until someone
// turned it off.
const CREDENTIAL_SHAPES = [
  [/\bsk-[A-Za-z0-9]{16,}/, 'an OpenAI-style secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'a Google API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a PEM private key block'],
]

// A secret-shaped name assigned a literal. The literal, not the name: `apiKey:
// process.env.X` is how it is supposed to look, and banning the word would only teach
// people to rename the variable.
const ASSIGNED_SECRET =
  /\b(api[_-]?key|apikey|secret|password|passwd|access[_-]?token|private[_-]?key|credential)s?\s*[:=]\s*(['"`])([^'"`\n]{12,})\2/i

// Values that match the assignment shape but are not secrets. Every one of these is a
// thing this repository legitimately writes.
function isNotASecret(value) {
  return (
    value.includes('${') ||                    // a template, so the value comes from elsewhere
    /^0x[0-9a-fA-F]+$/.test(value) ||          // an address or class hash, which are public
    /^[A-Z][A-Z0-9_]*$/.test(value) ||         // the NAME of an environment variable
    /^https?:\/\//.test(value) ||              // a URL; the host check below owns those
    value.includes('/') ||                     // a path or a mime type
    /\.{3}|<|your[-_ ]|example|placeholder|TODO/i.test(value)   // an obvious placeholder
  )
}

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.html'])

// Any absolute URL that names a host. `wss:`/`ws:` are here because a WebSocket to a
// third-party host leaks exactly what an HTTP poll leaks, and for longer — a live socket is
// a continuous "this visitor is still here" signal, which is worse than one request.
const HOST_IN_URL = /(?:https?|wss?):\/\/([a-zA-Z0-9.-]+)/g

// Protocol-relative `//host/path`, which inherits the page's scheme and is easy to miss
// because it does not look like a URL. Anchored to a preceding quote so that `// comment`
// and file paths cannot match — a protocol-relative URL that reaches anywhere lives in a
// string literal — and a dot is required, so `//foo` is not mistaken for a host.
const PROTOCOL_RELATIVE_HOST = /['"`]\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)/g

// A URL assembled from pieces, which is how a host disappears from a host check. Neither
// `'https://' + host` nor `` `https://${host}` `` contains a literal hostname for the patterns
// above to find, so the destination becomes invisible to this lint while remaining perfectly
// visible to the user's browser. There is no legitimate reason for browser code to build a
// third-party origin at runtime — the hosts it may reach are a fixed list in constants.ts — so
// the construction itself is the finding, whatever it ends up pointing at.
const CONCATENATED_SCHEME = [
  /(['"`])(?:https?:)?\/\/\1\s*\+/,          // 'https://' + host
  /\+\s*(['"`])(?:https?:)?\/\/\1/,          // host + '//'
  /`[^`]*:\/\/\$\{/,                          // `https://${host}`
  /`[^`]*\/\/\$\{/,                           // `//${host}`
]

let credentialFailed = false
let hostFailed = false
let exceptionFailed = false

// ---- Which hosts browser code may name -----------------------------------------
// constants.ts is the declaration of what this app talks to, under version control
// where a judge can read it. Anything it does not name has no business in the bundle.
const constants = readFileSync(at('packages/protocol/src/constants.ts'), 'utf8')
const declaredHosts = new Set([...constants.matchAll(HOST_IN_URL)].map((m) => m[1]))
// Local development, which reaches nobody.
for (const h of ['localhost', '127.0.0.1', '0.0.0.0', '::1']) declaredHosts.add(h)

// The enumerated browser-direct exceptions, read out of the module that owns them so
// there is exactly one list and it is the one the disclosure panel renders. Each entry is
// captured whole, because checking the cited LINE needs the description beside it.
const quoteProxy = readFileSync(at('packages/relayer/src/quote-proxy.ts'), 'utf8')
const exceptions = [
  ...quoteProxy.matchAll(/\{[^{}]*?where:\s*['"`]([^'"`]+)['"`][^{}]*?\}/gs),
].map((m) => ({ site: m[1], entry: m[0] }))
const exceptionSites = exceptions.map((e) => e.site)

// A parser that finds nothing looks exactly like a repository with nothing to check. Prettier
// switching the file to double quotes, or someone reformatting the array across lines, would
// silently turn every check below into a no-op and this script would still print "clean". If
// the list is declared, it must parse.
if (/PROXY_EXCEPTIONS/.test(quoteProxy) && exceptions.length === 0) {
  console.error(
    'quote-proxy.ts declares PROXY_EXCEPTIONS but no entries could be parsed out of it. The ' +
      'citation checks below are silently doing nothing — fix this parser rather than trusting ' +
      'the clean result.',
  )
  exceptionFailed = true
}

// Tokens that make a line plausibly the one being disclosed: it reaches out, or it names a
// place to reach. A cited line containing none of these is a citation that has drifted.
const REACHES_OUT = /(fetch|:\/\/|https?|wss?|window\.open|\.href|XMLHttpRequest|WebSocket|EXPLORER|RPC)/i

// An exception that points at a file, a line, or a piece of code that is no longer there is
// a disclosure nobody can check — which after one refactor is the same as no disclosure.
for (const { site, entry } of exceptions) {
  const match = /^(.*):([1-9]\d*)$/.exec(site)
  if (!match) {
    console.error(
      `quote-proxy.ts PROXY_EXCEPTIONS: ${JSON.stringify(site)} is not a "file:line" citation ` +
        `with a positive line number — a disclosure has to say where to look`,
    )
    exceptionFailed = true
    continue
  }
  const [, file, line] = match
  if (!existsSync(at(file))) {
    console.error(`quote-proxy.ts PROXY_EXCEPTIONS: ${site} names a file that does not exist`)
    exceptionFailed = true
    continue
  }
  const lines = readFileSync(at(file), 'utf8').split('\n')
  if (Number(line) > lines.length) {
    console.error(
      `quote-proxy.ts PROXY_EXCEPTIONS: ${site} is past the end of ${file} (${lines.length} lines) — ` +
        `the code moved and the disclosure did not`,
    )
    exceptionFailed = true
    continue
  }

  // Past-EOF was never the common way a citation goes stale. Code gets inserted above and
  // every line number below it shifts by three, still pointing inside the file and now at
  // something unrelated. So the CONTENT is checked: the cited line must either reach out to
  // the network or name a host the disclosure itself mentions.
  const cited = lines[Number(line) - 1]
  // Bare dotted names, not just full URLs: a disclosure says "Voyager sees the transaction",
  // it does not paste a scheme. The cited line naming something the disclosure names is
  // enough corroboration for a line that does not obviously reach out on its own.
  //
  // The `where` value is stripped out FIRST, because it contains the filename — `web/app.js`
  // yields the dotted name `app.js`, and any line mentioning `app.js` would then corroborate
  // the very citation pointing at it. A claim cannot be its own evidence.
  const described = entry.replace(/where:\s*['"`][^'"`]+['"`]/, '')
  const hostsNamed = [...described.matchAll(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)].map((m) => m[0])
  const plausible = REACHES_OUT.test(cited) || hostsNamed.some((h) => cited.includes(h))
  if (!plausible) {
    console.error(
      `quote-proxy.ts PROXY_EXCEPTIONS: ${site} cites a line that does not look like the ` +
        `browser-direct call it describes:\n    ${cited.trim() || '(blank line)'}\n  ` +
        `Re-point the citation, or drop the exception if the call is gone.`,
    )
    exceptionFailed = true
  }
}

function scan(path, { browserFacing }) {
  const lines = readFileSync(path, 'utf8').split('\n')
  // Reported relative to the scanned root, so the output is the same wherever it was run from.
  const shown = relative(ROOT, path)

  lines.forEach((line, i) => {
    const where = `${shown}:${i + 1}`

    for (const [pattern, what] of CREDENTIAL_SHAPES) {
      if (pattern.test(line)) {
        console.error(`${where}  looks like ${what}`)
        credentialFailed = true
      }
    }

    const assigned = ASSIGNED_SECRET.exec(line)
    if (assigned && !isNotASecret(assigned[3])) {
      console.error(`${where}  ${assigned[1]} assigned a literal — read it from the environment`)
      credentialFailed = true
    }

    if (!browserFacing) return

    for (const pattern of [HOST_IN_URL, PROTOCOL_RELATIVE_HOST]) {
      for (const m of line.matchAll(pattern)) {
        if (declaredHosts.has(m[1])) continue
        console.error(`${where}  browser code names ${m[1]}, which constants.ts does not declare`)
        hostFailed = true
      }
    }

    if (CONCATENATED_SCHEME.some((p) => p.test(line))) {
      console.error(
        `${where}  browser code builds a URL from a scheme plus a variable, so what it reaches ` +
          `cannot be read here`,
      )
      hostFailed = true
    }
  })
}

function walk(path, opts) {
  if (statSync(path).isDirectory()) {
    for (const f of readdirSync(path)) if (f !== 'node_modules') walk(join(path, f), opts)
    return
  }
  if (CODE_EXTS.has(extname(path))) scan(path, opts)
}

// web/ is browser code: both checks. packages/*/src is server and shared code, where a
// third-party host is the CORRECT place for one — that is what the proxy is — so only
// the credential check applies there.
if (existsSync(at('web'))) walk(at('web'), { browserFacing: true })
for (const pkg of existsSync(at('packages')) ? readdirSync(at('packages')) : []) {
  const src = at('packages', pkg, 'src')
  if (existsSync(src)) walk(src, { browserFacing: false })
}

if (credentialFailed) {
  console.error(
    '\nA credential belongs in the process environment and nowhere else. Anything in web/ ' +
      'is downloadable by every visitor, and anything in packages/ is one bad import away ' +
      'from being bundled into it. See the header of packages/relayer/src/server.ts.',
  )
}
if (hostFailed) {
  console.error(
    '\nA third-party host reached from the browser sees the visitor IP next to what they ' +
      'were doing — the exact linkage FR-029 claims to close. Route it through the relayer ' +
      "(POST /api/quote, and add the upstream to PROXY_TARGETS), or, if it genuinely has to " +
      'be browser-direct, add it to PROXY_EXCEPTIONS in quote-proxy.ts with one line saying ' +
      'what it leaks — so the disclosure panel can say it out loud.',
  )
}
if (credentialFailed || hostFailed || exceptionFailed) process.exit(1)

console.log(
  `secrets lint: clean · browser hosts limited to ${declaredHosts.size} declared` +
    ` · ${exceptionSites.length} disclosed browser-direct exception(s)`,
)
