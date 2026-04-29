export const PLACEMENT_PTS = [10, 6, 5, 4, 3, 2, 1, 1]

export interface ScoringRuleConfig {
  type?: 'super' | 'chicken'
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
    type: (scoring_rules.type as 'super' | 'chicken') ?? 'super',
    placement_pts: scoring_rules.placement_pts,
    kill_pts: scoring_rules.kill_pts,
  }
}

// Extract suffix after first underscore: "DNS_Heaven" → "Heaven"
export function getSuffix(name: string): string {
  const idx = name.indexOf('_')
  return idx >= 0 ? name.substring(idx + 1) : name
}
