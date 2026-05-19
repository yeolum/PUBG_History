'use client'

import type { PlanePath } from '@/lib/types'

const S = 1000 // SVG viewBox size — keeps coordinates as integers

function v(n: number) {
  return (n * S).toFixed(1)
}

// Triangle pointing in direction (ndx, ndy), centered at (cx, cy) in SVG units
function arrowPoints(cx: number, cy: number, ndx: number, ndy: number): string {
  const hl = 16, hw = 10 // half-length and half-width in SVG units
  return [
    `${cx + ndx * hl},${cy + ndy * hl}`,
    `${cx - ndx * hl - ndy * hw},${cy - ndy * hl + ndx * hw}`,
    `${cx - ndx * hl + ndy * hw},${cy - ndy * hl - ndx * hw}`,
  ].join(' ')
}

export default function FlightPathOverlay({ path }: { path: PlanePath }) {
  const rawDx = path.exit.x - path.entry.x
  const rawDy = path.exit.y - path.entry.y
  const len = Math.sqrt(rawDx * rawDx + rawDy * rawDy)
  if (len < 1e-9) return null
  const ndx = rawDx / len, ndy = rawDy / len

  // Trim 10% from each end so line doesn't reach the map edge
  const TRIM = 0.10
  const sx = Number(v(path.entry.x + rawDx * TRIM))
  const sy = Number(v(path.entry.y + rawDy * TRIM))
  const ex = Number(v(path.exit.x - rawDx * TRIM))
  const ey = Number(v(path.exit.y - rawDy * TRIM))

  // Arrow placed near the exit end (85% along the trimmed line)
  const ax = sx + (ex - sx) * 0.85
  const ay = sy + (ey - sy) * 0.85

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${S} ${S}`}
      preserveAspectRatio="none"
    >
      {/* Twire style: red base + white dashes on top → alternating red/white segments */}
      <line
        x1={sx} y1={sy} x2={ex} y2={ey}
        stroke="rgb(220,38,38)" strokeWidth="5" strokeOpacity="0.95" strokeLinecap="butt"
      />
      <line
        x1={sx} y1={sy} x2={ex} y2={ey}
        stroke="white" strokeWidth="5" strokeOpacity="0.95" strokeLinecap="butt"
        strokeDasharray="20 20"
      />

      {/* Direction arrow at the exit end */}
      <polygon
        points={arrowPoints(ax, ay, ndx, ndy)}
        fill="white" fillOpacity="0.95"
      />
    </svg>
  )
}
