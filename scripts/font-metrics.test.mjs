//
// The two design-system facts that only a real browser can establish, in one browser.
//
//   1. THE TYPEFACE ACTUALLY INTERPOLATES. The `@font-face` descriptor is its own silent clamp
//      layer: a narrowed `font-weight` range renders 485, 535 and 700 at IDENTICAL widths on a fully
//      variable binary, with no error and no console warning. `width(485) !== width(535)` catches
//      every variant of that bug in one line — and the negative control below reproduces the bug on
//      purpose, so the assertion is known to be capable of failing.
//
//   2. THE THEME PAINTS THE RIGHT WAY IN ALL SIX STATES. OS light/dark crossed with no pin, pinned
//      light and pinned dark. The half that CSS cannot do on its own is the pin, which is why
//      `index.html` carries a blocking inline script.
//
// A NOTE ON THE MEASUREMENT ITSELF, which is where this test would otherwise lie. `document.fonts
// .ready` resolves BEFORE a lazily-referenced face has loaded — measured: it returns fallback-font
// widths, silently, with no error. So every measurement below is preceded by an explicit
// `document.fonts.load(...)` and an assertion that the face reports `loaded`. Without that this
// file would be measuring the system sans and reporting it as Plex.
//
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium } from 'playwright-core'
import YAML from 'yaml'

import { assertBrowserAvailable, BROWSER_INSTALL_COMMAND } from './build-web.mjs'
import { compileAppStylesheet } from './tailwind-probe.mjs'

const FONTSOURCE = 'node_modules/@fontsource-variable/ibm-plex-sans'
const FAMILY = 'IBM Plex Sans Variable'

/**
 * The SHIPPED `@font-face`, with its own descriptor, pointing at the real binary.
 *
 * The latin `src` url is swapped for a data URI so the page needs no server, and NOTHING else is
 * rewritten — in particular the `font-weight: 100 700` descriptor is fontsource's own text. That is
 * the point: if fontsource ever narrows it, this test measures the narrowed face and fails, which
 * is exactly the failure mode being guarded.
 */
function shippedFace({ descriptorOverride } = {}) {
  const css = readFileSync(resolve(FONTSOURCE, 'wght.css'), 'utf8')
  const block = css
    .split('@font-face')
    .map((b) => `@font-face${b}`)
    .find((b) => b.includes('ibm-plex-sans-latin-wght-normal.woff2'))
  if (!block) throw new Error('the latin @font-face block is not in fontsource\'s wght.css any more')

  const woff2 = readFileSync(resolve(FONTSOURCE, 'files/ibm-plex-sans-latin-wght-normal.woff2'))
  const inlined = block.replace(
    /url\([^)]*\)/,
    `url(data:font/woff2;base64,${woff2.toString('base64')})`,
  )
  return descriptorOverride
    ? inlined.replace(/font-weight:\s*[\d\s]+;/, `font-weight: ${descriptorOverride};`)
    : inlined
}

let browser
beforeAll(async () => {
  try {
    assertBrowserAvailable('font-metrics')
    browser = await chromium.launch({ channel: 'chromium-headless-shell' })
  } catch (e) {
    throw new Error(`${e.message}\n\n  (install with: ${BROWSER_INSTALL_COMMAND})`)
  }
}, 120_000)

afterAll(async () => {
  await browser?.close()
})

/** Loads the face, ASSERTS it loaded, then measures. Never the other way round. */
async function measure(faceCss, family = FAMILY) {
  const page = await browser.newPage()
  try {
    await page.setContent(
      `<style>${faceCss}
       #probe { position: absolute; white-space: pre; font-size: 100px; font-family: '${family}'; }
       </style><span id="probe"></span>`,
    )
    return await page.evaluate(
      async ({ family: f, weights, strings }) => {
        const loaded = {}
        for (const w of weights) {
          const faces = await document.fonts.load(`${w} 100px "${f}"`)
          loaded[w] = faces.length > 0 && faces.every((face) => face.status === 'loaded')
        }
        const probe = document.getElementById('probe')
        const widths = {}
        for (const w of weights) {
          probe.style.fontWeight = String(w)
          for (const [name, text] of Object.entries(strings)) {
            probe.textContent = text
            widths[`${w}:${name}`] = probe.getBoundingClientRect().width
          }
        }
        return { loaded, widths, available: document.fonts.check(`485 100px "${f}"`) }
      },
      {
        family,
        weights: [485, 535, 700],
        strings: {
          specimen: 'Passbook 0 1 4 7 .',
          ones: '1111111111',
          zeros: '0000000000',
          money: '-1,234.50 5.00%',
        },
      },
    )
  } finally {
    await page.close()
  }
}

describe('the shipped typeface', () => {
  let shipped
  beforeAll(async () => {
    shipped = await measure(shippedFace())
  }, 120_000)

  it('is LOADED before anything is measured', () => {
    // `document.fonts.ready` resolves before a lazily-referenced face loads and the measurement then
    // silently returns fallback widths. This is the assertion that makes the rest of the file mean
    // something.
    expect(shipped.available).toBe(true)
    for (const weight of [485, 535, 700]) expect(shipped.loaded[weight], `weight ${weight}`).toBe(true)
  })

  it('renders 485 and 535 at DIFFERENT widths — the descriptor did not flatten the axis', () => {
    expect(shipped.widths['485:specimen']).not.toBe(shipped.widths['535:specimen'])
    expect(shipped.widths['535:specimen']).toBeGreaterThan(shipped.widths['485:specimen'])
  })

  it('would go RED against a narrowed descriptor — the bug reproduced on purpose', async () => {
    // Without this, "485 !== 535" could be passing for reasons unrelated to the descriptor. Pin the
    // descriptor to a single weight and the SAME fully-variable binary renders every weight
    // identically, with no error anywhere. That silent flattening is what the assertion above
    // exists to catch, and this is it happening.
    const flattened = await measure(shippedFace({ descriptorOverride: '400' }))
    expect(flattened.available).toBe(true)
    expect(flattened.widths['485:specimen']).toBe(flattened.widths['535:specimen'])
    expect(flattened.widths['535:specimen']).toBe(flattened.widths['700:specimen'])
  }, 120_000)

  it('sets digits on a fixed grid, stated as the OUTCOME rather than as a feature', () => {
    // NOT "confirm `tabular-nums` works": this face has no `tnum` feature at all and the toggle
    // measures a 0.000px no-op, so a tester following that instruction reads it as broken. The
    // outcome is what the design needs, and it holds unconditionally here — a money column cannot
    // shift when a digit changes.
    expect(shipped.widths['485:ones']).toBe(shipped.widths['485:zeros'])
    expect(shipped.widths['535:ones']).toBe(shipped.widths['535:zeros'])
  })

  it('keeps the digit advance INVARIANT across the two weights in use', () => {
    // The consequence the design relies on: a balance that changes weight (hover, emphasis, the
    // digit roll) must not reflow the column.
    const perDigit = (w) => shipped.widths[`${w}:zeros`] / 10
    expect(perDigit(485)).toBeCloseTo(perDigit(535), 5)
  })

  it('renders the specimen the money formatter actually produces', () => {
    // A negative and a percentage, because the fallback face rewrites both under tabular figures.
    expect(shipped.widths['485:money']).toBeGreaterThan(0)
  })

  it('names only families that actually ship, plus system keywords', async () => {
    // `--font-sans` ends `'Inter', system-ui, sans-serif` and Inter is NOT a dependency — that entry
    // resolves only for a reader who has it installed locally. The comments used to describe Inter
    // as the fallback the app relies on; the fallback it really has is `system-ui`. This asserts the
    // chain so the claim and the stylesheet cannot drift apart again.
    const chain = /--font-sans:\s*([^;]+);/
      .exec(readFileSync(resolve('apps/web/design/tokens.css'), 'utf8'))[1]
      .split(',')
      .map((f) => f.trim().replace(/^'|'$/g, ''))

    expect(chain[0]).toBe(FAMILY)
    expect(chain.at(-2)).toBe('system-ui')
    expect(chain.at(-1)).toBe('sans-serif')

    const bundled = ['IBM Plex Sans Variable']
    const generic = ['system-ui', 'sans-serif', 'ui-sans-serif']
    const unbundled = chain.filter((f) => !bundled.includes(f) && !generic.includes(f))
    // Not a failure — the design authority names Inter as the swap target — but it must be known
    // to be decorative rather than load-bearing.
    expect(unbundled).toEqual(['Inter'])
    expect(existsSync(resolve('node_modules/@fontsource-variable/inter'))).toBe(false)
  })

  it('proves `tabular-nums` is load-bearing on the fallback the app REALLY has', async () => {
    // The claim the `.numeric` primitive rests on, measured instead of asserted: on `system-ui`
    // (the true end of the chain, since Inter is not bundled) figures are proportional by default,
    // so the toggle changes real pixels. If it ever stops doing so, `.numeric` is dead CSS and the
    // comment saying otherwise is wrong.
    const page = await browser.newPage()
    try {
      await page.setContent(
        '<style>#p{position:absolute;white-space:pre;font-size:100px;font-family:system-ui}</style><span id="p"></span>',
      )
      const seen = await page.evaluate(() => {
        const p = document.getElementById('p')
        const width = (text, tnum) => {
          p.style.fontVariantNumeric = tnum ? 'tabular-nums' : 'normal'
          p.textContent = text
          return p.getBoundingClientRect().width
        }
        return {
          proportionalSpread: Math.abs(width('1111111111', false) - width('0000000000', false)),
          tabularSpread: Math.abs(width('1111111111', true) - width('0000000000', true)),
        }
      })
      expect(seen.proportionalSpread).toBeGreaterThan(0)
      expect(seen.tabularSpread).toBe(0)
    } finally {
      await page.close()
    }
  }, 60_000)
})

// ── The six-state theme matrix ────────────────────────────────────────────────────────────────

//
// The expected colours come from the design authority's own committed copy, PARSED — no regex over
// the yaml text, and no `??` fallback.
//
// The version this replaces ran `/--color-ground: (#…);/` against tokens.yaml, which writes
// `ground: "#FCFAF6"` — so it never matched, the `?? '#FCFAF6'` fallback always won, and dark was
// hardcoded outright. A silent fallback inside the suite that polices silent fallbacks: the whole
// six-state matrix would have kept passing against two literals no matter what the authority said.
//
const TOKENS = readFileSync(resolve('apps/web/design/tokens.css'), 'utf8')
const DESIGN = YAML.parse(readFileSync(resolve('apps/web/design/tokens.yaml'), 'utf8'))

/**
 * The app's REAL entry stylesheet, compiled by the real compiler.
 *
 * Not just `tokens.css` plus a few utilities: this pulls in the `@layer base` block that paints
 * `body` from `--color-ground`, which is what makes "the body is the right colour" an assertion
 * about the shipped design system rather than about a class the test itself wrote.
 */
async function compiledSheet() {
  return compileAppStylesheet(['bg-ground', 'text-neutral1', 'shadow-short', 'dark:bg-raised'])
}

const rgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('the theme paints correctly in all six OS x pin states', () => {
  let sheet
  const grounds = { light: rgb(DESIGN.colors.light.ground), dark: rgb(DESIGN.colors.dark.ground) }

  it('reads both grounds from the design authority, not from a fallback', () => {
    // If this ever reads a literal again, the matrix below stops testing the design system.
    expect(DESIGN.colors.light.ground).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(DESIGN.colors.dark.ground).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(DESIGN.colors.light.ground).not.toBe(DESIGN.colors.dark.ground)
  })

  beforeAll(async () => {
    sheet = await compiledSheet()
  }, 120_000)

  const states = [
    { os: 'light', pin: null, expected: 'light' },
    { os: 'light', pin: 'light', expected: 'light' },
    { os: 'light', pin: 'dark', expected: 'dark' },
    { os: 'dark', pin: null, expected: 'dark' },
    { os: 'dark', pin: 'light', expected: 'light' },
    { os: 'dark', pin: 'dark', expected: 'dark' },
  ]

  for (const { os, pin, expected } of states) {
    it(`OS ${os} + ${pin ? `pinned ${pin}` : 'no pin'} paints ${expected}`, async () => {
      const page = await browser.newPage({ colorScheme: os })
      try {
        await page.setContent(
          `<!doctype html><html${pin ? ` data-theme="${pin}"` : ''}><head><style>${sheet}</style>` +
            `</head><body class="bg-ground"><p class="text-neutral1 shadow-short">x</p></body></html>`,
        )
        const seen = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement)
          return {
            background: getComputedStyle(document.body).backgroundColor,
            colorScheme: root.colorScheme,
            shadowInk: root.getPropertyValue('--sh-short').trim(),
            ground: root.getPropertyValue('--color-ground').trim(),
          }
        })
        expect(seen.background).toBe(grounds[expected])
        // `color-scheme` is the only thing that flips native scrollbars and form controls.
        expect(seen.colorScheme).toBe(expected)
        // The shadow's GEOMETRY changes per theme, not just its ink — so this is a real check that
        // whole-value indirection reached the element, not just that a colour changed.
        expect(seen.shadowInk.startsWith(expected === 'dark' ? '0 1px 3px' : '0 1px 6px')).toBe(true)
      } finally {
        await page.close()
      }
    }, 60_000)
  }

  //
  // THE PIN SCRIPT, EXECUTED — not read.
  //
  // Every structural assertion below this one passes if `document.documentElement.dataset.theme` is
  // changed to `document.body.dataset.theme`, which pins nothing at all: the sheet selects on
  // `:root[data-theme]`. Reading source text cannot tell those apart. So the real `index.html` is
  // served on a real origin (localStorage needs one — `about:` and `data:` URLs have none), the
  // key is seeded, the page is reloaded, and the assertion is on what the ROOT ELEMENT ends up with
  // and what the body actually paints.
  //
  describe('the pin script, executed against a real origin', () => {
    const ORIGIN = 'https://passbook.test'

    async function loadWithPin(pin) {
      const html = readFileSync(resolve('apps/web/index.html'), 'utf8')
        // The module script would 404 here and is not what is under test.
        .replace(/<script type="module"[^>]*><\/script>/, '')
        .replace('</head>', `<style>${sheet}</style></head>`)

      const page = await browser.newPage({ colorScheme: 'light' })
      await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html', body: html }))
      await page.goto(`${ORIGIN}/`)
      if (pin !== null) {
        await page.evaluate((v) => localStorage.setItem('passbook-theme', v), pin)
      } else {
        await page.evaluate(() => localStorage.removeItem('passbook-theme'))
      }
      await page.reload()
      const seen = await page.evaluate(() => ({
        attribute: document.documentElement.getAttribute('data-theme'),
        onBody: document.body.getAttribute('data-theme'),
        background: getComputedStyle(document.body).backgroundColor,
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
      }))
      await page.close()
      return seen
    }

    it('pins dark against a light OS', async () => {
      const seen = await loadWithPin('dark')
      expect(seen.attribute).toBe('dark')
      expect(seen.background).toBe(grounds.dark)
      expect(seen.colorScheme).toBe('dark')
      // The mutation that every source-text assertion misses.
      expect(seen.onBody, 'the pin must land on the ROOT element; the sheet selects :root[data-theme]').toBe(null)
    }, 60_000)

    it('pins light, and stays light', async () => {
      const seen = await loadWithPin('light')
      expect(seen.attribute).toBe('light')
      expect(seen.background).toBe(grounds.light)
      expect(seen.colorScheme).toBe('light')
    }, 60_000)

    it('ignores a junk value rather than pinning it', async () => {
      // A stale or tampered key must not put an arbitrary string on the root element.
      const seen = await loadWithPin('purple')
      expect(seen.attribute).toBe(null)
      expect(seen.background).toBe(grounds.light)
    }, 60_000)

    it('sets nothing at all when no pin is stored', async () => {
      const seen = await loadWithPin(null)
      expect(seen.attribute).toBe(null)
      expect(seen.background).toBe(grounds.light)
    }, 60_000)
  })

  it('carries the pin in a BLOCKING inline script, ahead of anything that paints', async () => {
    // The mechanical form of "no flash". CSS alone is flash-free for OS-followers and can never
    // reach a pin; a deferred module script is long enough to paint the wrong theme first.
    const html = readFileSync(resolve('apps/web/index.html'), 'utf8')
    const script = html.indexOf('passbook-theme')
    expect(script, 'the theme script is missing from index.html').toBeGreaterThan(-1)
    expect(script).toBeLessThan(html.indexOf('</head>'))

    // Find the script element that carries the pin, and hold ITS open tag to the contract — every
    // one of `src`, `defer`, `async` and `type="module"` makes it non-blocking, and a non-blocking
    // theme script paints the wrong theme first for exactly the users it exists to serve.
    const theme = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find((m) =>
      m[2].includes('passbook-theme'),
    )
    expect(theme, 'no inline script element carries the pin').toBeTruthy()
    for (const disqualifier of ['src', 'defer', 'async', 'module']) {
      expect(theme[1], `the theme script must not be \`${disqualifier}\``).not.toContain(disqualifier)
    }

    // Nothing that paints may precede it.
    for (const painter of ['<link', '<style']) {
      const at = html.indexOf(painter)
      if (at !== -1) expect(at).toBeGreaterThan(script)
    }

    // Safari's private mode throws on localStorage; an uncaught throw here takes the document down.
    expect(html).toMatch(/try \{[\s\S]*localStorage[\s\S]*catch/)
  })
})
