//
// The staircase, drawn from the REAL epoch count with the current tread lit. Flat treads, hard
// risers: inside a step the price does not move at all, so there is nothing to win by racing in.
// One drawing for the card and the detail page — `height` is the only thing that differs.
//
export function Staircase({ epochs, at, height = 40 }: { epochs: number; at: number; height?: number }) {
  const steps = Math.max(1, Math.min(epochs, 8))
  const width = 120
  const tread = width / steps - 3
  const top = height - 6
  const rise = (top - 6) / Math.max(1, steps - 1)
  return (
    <svg
      viewBox={`0 0 120 ${height}`}
      style={{ height }}
      className="w-full"
      fill="none"
      role="img"
      aria-label={`The staircase: price is flat within each of ${epochs} epochs and steps up between them`}
    >
      {Array.from({ length: steps }, (_, i) => {
        const x = 2 + i * (width / steps)
        const y = top - i * rise
        return (
          <g key={i}>
            <path
              d={`M${x} ${y} h${tread}`}
              stroke="currentColor"
              className={i === at ? 'text-accent1' : 'text-neutral3'}
              strokeWidth={i === at ? 3 : 2}
              strokeLinecap="round"
            />
            {i < steps - 1 ? (
              <path
                d={`M${x + tread} ${y} V${y - rise}`}
                stroke="currentColor"
                className="text-neutral3"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.5"
              />
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
