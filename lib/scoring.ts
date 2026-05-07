export const PLACEMENT_PTS = [10, 6, 5, 4, 3, 2, 1, 1]

export interface ScoringRuleConfig {
  type?: 'super' | 'super_v1' | 'chicken' | 'chicken_v2'
  placement_pts: number[]
  kill_pts: number
}

export const DEFAULT_RULE: ScoringRuleConfig = {
  type: 'super',
  placement_pts: PLACEMENT_PTS,
  kill_pts: 1,
}

export function calcPlacementPts(placement: number): number {
  return placement >= 1 && placement <= 8 ? PLACEMENT_PTS[placement - 1] : 0
}

export function calcPlacementPtsWithRule(placement: number, rule: ScoringRuleConfig): number {
  const pts = rule.placement_pts
  return placement >= 1 && placement <= pts.length ? pts[placement - 1] : 0
}

export function ruleFromStage(scoring_rules: { placement_pts: number[]; kill_pts: number; type: string } | null | undefined): ScoringRuleConfig {
  if (!scoring_rules) return DEFAULT_RULE
  return {
    type: (scoring_rules.type as 'super' | 'super_v1' | 'chicken' | 'chicken_v2') ?? 'super',
    placement_pts: scoring_rules.placement_pts,
    kill_pts: scoring_rules.kill_pts,
  }
}

// Extract suffix after first underscore: "DNS_Heaven" → "Heaven"
export function getSuffix(name: string): string {
  const idx = name.indexOf('_')
  return idx >= 0 ? name.substring(idx + 1) : name
}

// Lowercased lookup variants for a PUBG-style name. The first variant is
// always the full name; if the name contains an underscore (typical
// "TAG_PlayerName" pattern) the after-first-underscore portion is added as a
// secondary variant. This handles both cases at once:
//   "Heaven"        → ["heaven"]
//   "DNS_Heaven"    → ["dns_heaven", "heaven"]
//   "JoShY-_-"      → ["joshy-_-", "-"]            (full still indexed)
//   "DNS_JoShY-_-"  → ["dns_joshy-_-", "joshy-_-"] (suffix preserves underscores)
// Indexing both lets a player whose nickname is "JoShY-_-" still match a
// match name "DNS_JoShY-_-": the input's suffix variant resolves to the
// player's full-name variant.
export function getNameVariants(name: string): string[] {
  const trimmed = name.trim()
  if (!trimmed) return []
  const full = trimmed.toLowerCase()
  const out = [full]
  const idx = trimmed.indexOf('_')
  if (idx > 0) {
    const tail = trimmed.substring(idx + 1).trim().toLowerCase()
    if (tail && tail !== full) out.push(tail)
  }
  return out
}
