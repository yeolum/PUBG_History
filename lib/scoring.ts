export const PLACEMENT_PTS = [10, 6, 5, 4, 3, 2, 1, 1]

export function calcPlacementPts(placement: number): number {
  return placement >= 1 && placement <= 8 ? PLACEMENT_PTS[placement - 1] : 0
}

// Extract suffix after first underscore: "DNS_Heaven" → "Heaven"
export function getSuffix(name: string): string {
  const idx = name.indexOf('_')
  return idx >= 0 ? name.substring(idx + 1) : name
}
