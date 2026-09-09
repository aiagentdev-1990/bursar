/** Trend shape only — no axis, no scale, no tooltip. Decorative by intent: the number that
 *  matters is in the next column. */
export function Sparkline({ series, width = 62, height = 20 }: { series: number[]; width?: number; height?: number }) {
  if (series.length < 2) return <svg width={width} height={height} aria-hidden />

  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const pad = 2

  const points = series
    .map((value, i) => {
      const x = (i / (series.length - 1)) * width
      const y = height - pad - ((value - min) / span) * (height - pad * 2)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden focusable="false">
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </svg>
  )
}
