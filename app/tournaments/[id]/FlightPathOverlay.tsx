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
  const ex = Number(v(path.entry.x)), ey = Number(v(path.entry.y))
  const lx = Number(v(path.exit.x)), ly = Number(v(path.exit.y))

  const rawDx = path.exit.x - path.entry.x
  const rawDy = path.exit.y - path.entry.y
  const len = Math.sqrt(rawDx * rawDx + rawDy * rawDy)
  if (len < 1e-9) return null
  const ndx = rawDx / len, ndy = rawDy / len

  // Arrow placed at 1/3 from entry toward exit
  const ax = ex + (lx - ex) / 3
  const ay = ey + (ly - ey) / 3

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${S} ${S}`}
      preserveAspectRatio="none"
    >
      <defs>
        <filter id="fp-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Main dashed flight line */}
      <line
        x1={ex} y1={ey} x2={lx} y2={ly}
        stroke="white" strokeWidth="2.5" strokeOpacity="0.78"
        strokeDasharray="10 7" strokeLinecap="round"
        filter="url(#fp-glow)"
      />

      {/* Direction arrow */}
      <polygon
        points={arrowPoints(ax, ay, ndx, ndy)}
        fill="white" fillOpacity="0.88"
      />

      {/* Entry: solid dot + ring */}
      <circle cx={ex} cy={ey} r="7" fill="none" stroke="white" strokeWidth="2" strokeOpacity="0.7" />
      <circle cx={ex} cy={ey} r="4" fill="white" fillOpacity="0.9" />

      {/* Jump dots */}
      {path.jumps.map((j, i) => (
        <circle
          key={i}
          cx={Number(v(j.x))} cy={Number(v(j.y))}
          r="2.8"
          fill="white" fillOpacity="0.6"
        />
      ))}

      {/* Exit: outlined circle only */}
      <circle cx={lx} cy={ly} r="5" fill="none" stroke="white" strokeWidth="2" strokeOpacity="0.65" />
    </svg>
  )
}
