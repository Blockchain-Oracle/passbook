// The share card, drawn from the DTO and nothing else: 1200×630, STUDIO tokens read off the
// document so the card matches the app in either theme, Anton for the headline once the font has
// actually loaded. `null` from the canvas is an export failure the dialog says in red.
import { SHARE_OUTCOME, SHARE_SIDE, shareQuestion, shareUnits, type PositionShare } from '@strk20/protocol/position-share'

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function short(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

/** Renders the card to a PNG file. Every string on it comes from the DTO. */
export async function renderShareCard(share: PositionShare): Promise<File | null> {
  await Promise.all([document.fonts.load('64px Anton'), document.fonts.load('600 24px "Archivo Variable"'), document.fonts.load('22px "Space Mono"')]).catch(() => undefined)
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const c = canvas.getContext('2d')
  if (!c) return null

  const ink = token('--color-neutral1', '#0A0A0A')
  const paper = token('--color-ground', '#E7E6E1')
  const accent = token('--color-accent1', '#B93404')
  const muted = token('--color-neutral3', '#85847E')
  const display = token('--font-display', 'Anton, sans-serif')
  const sans = token('--font-sans', 'system-ui, sans-serif')
  const mono = token('--font-mono', 'ui-monospace, monospace')

  // Ground: near-black with the running-asterisk mark's orange as a single bar at the edge.
  c.fillStyle = ink
  c.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  c.fillStyle = accent
  c.fillRect(0, 0, 18, CARD_HEIGHT)

  // Wordmark + kicker
  c.fillStyle = paper
  c.font = `36px ${display}`
  c.textBaseline = 'alphabetic'
  c.fillText('strk20', 72, 90)
  const w = c.measureText('strk20').width
  c.fillStyle = accent
  c.fillText('.run', 72 + w, 90)
  c.fillStyle = muted
  c.font = `600 20px ${sans}`
  c.fillText('MARKET POSITION', 72, 136)

  // Headline: the question, wrapped to two lines at most.
  c.fillStyle = paper
  c.font = `88px ${display}`
  const question = shareQuestion(share).toUpperCase()
  const lines = wrap(c, question, CARD_WIDTH - 144)
  let y = 260
  for (const line of lines.slice(0, 2)) {
    c.fillText(line, 72, y)
    y += 92
  }

  // Side + stake
  c.fillStyle = paper
  c.font = `600 34px ${sans}`
  const side = SHARE_SIDE[share.side] ?? `Side ${share.side}`
  c.fillText(`${side} · ${shareUnits(share.cashIn, share.decimals, share.symbol)}`, 72, y + 12)

  // Outcome
  const outcome = share.terminal ? SHARE_OUTCOME[share.terminal.kind] : 'Still open'
  const amount = share.terminal?.amount ? shareUnits(share.terminal.amount, share.decimals, share.symbol) : null
  c.fillStyle = accent
  c.font = `72px ${display}`
  c.fillText(outcome.toUpperCase(), 72, y + 100)
  if (amount) {
    const ow = c.measureText(outcome.toUpperCase()).width
    c.fillStyle = paper
    c.font = `600 44px ${sans}`
    c.fillText(amount, 72 + ow + 28, y + 100)
  }

  // Footer: the transactions, in mono, the only identifiers on the card.
  c.fillStyle = muted
  c.font = `22px ${mono}`
  const opened = `opened ${short(share.openingTxHash)}`
  const closed = share.terminal?.txHash ? `   closed ${short(share.terminal.txHash)}` : ''
  c.fillText(`${opened}${closed}`, 72, CARD_HEIGHT - 56)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new File([blob], `strk20-position-${share.commitment.slice(2, 10)}.png`, { type: 'image/png' })
}

function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(' ')
  const out: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (c.measureText(next).width > width && line) {
      out.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out
}
