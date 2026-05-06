import 'server-only'
import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/server'
import { calcPlacementPtsWithRule, ruleFromStage } from '@/lib/scoring'

// Mirrors the rank board + DQ + prize logic that TournamentContent /
// TournamentStagesView render in the public Final Standings table, so
// other pages (team / player profiles) can show the exact same rank /
// prize without duplicating the logic in each place.
//
// Returns: teamId → { rank: 1..N as displayed (DQ teams marked 'DQ'),
//                     prize: prize_config[origRank].prize + WWCD/stage/series bonuses }
//
// For tournaments where ranking_method is 'stage' (default) the rank comes
// from prize_config stage/series mappings if any, otherwise from the
// grand_final stage's cumulative standings. For 'prize' / 'pgs' / 'pgc'
// it's the sort over teamStats by accumulated bonuses.

export interface TournamentFinalStanding {
  rank: number | 'DQ'
  prize: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

const PAGE = 1000

async function fetchAllTeamResults(
  supabase: ReturnType<typeof createPublicClient>,
  matchIds: string[],
): Promise<AnyRow[]> {
  if (matchIds.length === 0) return []
  const rows: AnyRow[] = []
  let page = 0
  while (true) {
    const { data: batch } = await supabase
      .from('match_team_results')
      .select('match_id, team_id, pubg_team_name, placement, total_kills')
      .in('match_id', matchIds)
      .order('id')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (!batch || batch.length === 0) break
    rows.push(...(batch as AnyRow[]))
    if (batch.length < PAGE) break
    page++
  }
  return rows
}

export const getTournamentFinalStandings = unstable_cache(
  async (tournamentId: string): Promise<Map<string, TournamentFinalStanding>> => {
    const supabase = createPublicClient()

    const [{ data: tournament }, { data: stagesData }, { data: prizeConfigData }, { data: seriesData }, { data: ttData }, { data: combinedData }, { data: combinedStageData }, { data: specialAwardsData }] = await Promise.all([
      supabase.from('tournaments').select('id, ranking_method').eq('id', tournamentId).single(),
      supabase.from('stages').select('id, type, series_id, include_in_total, scoring_rules(*), matches(id, status)').eq('tournament_id', tournamentId).order('order_num'),
      supabase.from('tournament_prize_config').select('rank, prize, stage_id, series_id, combined_scoreboard_id, stage_rank').eq('tournament_id', tournamentId).order('rank'),
      supabase.from('series').select('id').eq('tournament_id', tournamentId),
      supabase.from('tournament_teams').select('team_id, disqualified').eq('tournament_id', tournamentId),
      supabase.from('combined_scoreboards').select('id, tab_order').eq('tournament_id', tournamentId),
      supabase.from('combined_scoreboard_stages').select('combined_scoreboard_id, stage_id'),
      supabase.from('tournament_special_awards').select('team_id, prize, pgs_points, pgc_points').eq('tournament_id', tournamentId),
    ])

    if (!tournament) return new Map()

    const stagesList = (stagesData ?? []) as (AnyRow & { matches: AnyRow[] })[]
    const prizeConfig = (prizeConfigData ?? []) as AnyRow[]
    const seriesList = (seriesData ?? []) as AnyRow[]
    const rankMethod = ((tournament as AnyRow).ranking_method ?? 'stage') as 'stage' | 'prize' | 'pgs' | 'pgc'

    const allImportedMatchIds: string[] = []
    for (const stage of stagesList) {
      if ((stage as AnyRow).include_in_total === false) continue
      for (const m of stage.matches ?? []) {
        if (m.status === 'imported') allImportedMatchIds.push(m.id as string)
      }
    }

    const stageIds = stagesList.map((s) => s.id as string)
    const seriesIds = seriesList.map((sr) => sr.id as string)

    const [trData, { data: additionalPtsData }, { data: wwcdData }, { data: stageSpData }, { data: seriesSpData }] = await Promise.all([
      fetchAllTeamResults(supabase, allImportedMatchIds),
      stageIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase.from('stage_additional_points').select('stage_id, team_name, points').in('stage_id', stageIds),
      supabase.from('tournament_wwcd_rewards').select('stage_id, series_id, prize, pgs_points, pgc_points').eq('tournament_id', tournamentId),
      stageIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase.from('stage_prize_config').select('stage_id, placement, prize, pgs_points, pgc_points').in('stage_id', stageIds),
      seriesIds.length === 0
        ? Promise.resolve({ data: [] })
        : supabase.from('stage_prize_config').select('series_id, placement, prize, pgs_points, pgc_points').in('series_id', seriesIds),
    ])

    // matchId → results
    const resultsByMatch = new Map<string, AnyRow[]>()
    for (const r of trData) {
      const mid = r.match_id as string
      if (!resultsByMatch.has(mid)) resultsByMatch.set(mid, [])
      resultsByMatch.get(mid)!.push(r)
    }

    // matchId → scoring rule
    const matchToRule = new Map<string, ReturnType<typeof ruleFromStage>>()
    for (const stage of stagesList) {
      const rule = ruleFromStage(stage.scoring_rules as Parameters<typeof ruleFromStage>[0])
      for (const m of stage.matches ?? []) matchToRule.set(m.id as string, rule)
    }

    // stageId → { teamNameLower → extraPts }
    const stageAdditionalPts: Record<string, Record<string, number>> = {}
    for (const ap of (additionalPtsData ?? []) as AnyRow[]) {
      if (!stageAdditionalPts[ap.stage_id]) stageAdditionalPts[ap.stage_id] = {}
      stageAdditionalPts[ap.stage_id][(ap.team_name as string).toLowerCase()] = Number(ap.points)
    }

    type StandingsEntry = { teamId: string | null; teamName: string; placePts: number; totalPts: number }
    const stageStandingsMap = new Map<string, StandingsEntry[]>()
    for (const stage of stagesList) {
      const ptsMap = new Map<string, StandingsEntry>()
      for (const m of stage.matches ?? []) {
        if (m.status !== 'imported') continue
        for (const r of resultsByMatch.get(m.id as string) ?? []) {
          const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
          if (!ptsMap.has(key)) {
            ptsMap.set(key, {
              teamId: r.team_id ?? null,
              teamName: (r.pubg_team_name as string | null) ?? '',
              totalPts: 0, placePts: 0,
            })
          }
          const e = ptsMap.get(key)!
          const rule = matchToRule.get(m.id as string) ?? ruleFromStage(null)
          const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
          e.totalPts += pp + Math.round((r.total_kills ?? 0) * rule.kill_pts)
          e.placePts += pp
        }
      }
      const extraForStage = stageAdditionalPts[stage.id as string] ?? {}
      for (const e of ptsMap.values()) {
        e.totalPts += extraForStage[e.teamName.toLowerCase()] ?? 0
      }
      stageStandingsMap.set(stage.id as string, [...ptsMap.values()].sort((a, b) =>
        b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts
      ))
    }

    // Series cumulative standings
    const seriesStandingsMap = new Map<string, StandingsEntry[]>()
    for (const sr of seriesList) {
      const seriesStages = stagesList.filter((s) => s.series_id === sr.id)
      if (seriesStages.length === 0) continue
      const ptsMap = new Map<string, StandingsEntry>()
      for (const stage of seriesStages) {
        for (const m of stage.matches ?? []) {
          if (m.status !== 'imported') continue
          for (const r of resultsByMatch.get(m.id as string) ?? []) {
            const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
            if (!ptsMap.has(key)) {
              ptsMap.set(key, {
                teamId: r.team_id ?? null,
                teamName: (r.pubg_team_name as string | null) ?? '',
                totalPts: 0, placePts: 0,
              })
            }
            const e = ptsMap.get(key)!
            const rule = matchToRule.get(m.id as string) ?? ruleFromStage(null)
            const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
            e.totalPts += pp + Math.round((r.total_kills ?? 0) * rule.kill_pts)
            e.placePts += pp
          }
        }
        const extraForStage = stageAdditionalPts[stage.id as string] ?? {}
        for (const e of ptsMap.values()) {
          e.totalPts += extraForStage[e.teamName.toLowerCase()] ?? 0
        }
      }
      seriesStandingsMap.set(sr.id as string, [...ptsMap.values()].sort((a, b) =>
        b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts
      ))
    }

    // Combined scoreboards — same shape as series cumulative standings.
    const combinedStagesByCombined = new Map<string, Set<string>>()
    for (const r of (combinedStageData ?? []) as AnyRow[]) {
      const cid = r.combined_scoreboard_id as string
      if (!combinedStagesByCombined.has(cid)) combinedStagesByCombined.set(cid, new Set())
      combinedStagesByCombined.get(cid)!.add(r.stage_id as string)
    }
    const combinedStandingsMap = new Map<string, StandingsEntry[]>()
    for (const cb of (combinedData ?? []) as AnyRow[]) {
      const cid = cb.id as string
      const stageIds = combinedStagesByCombined.get(cid) ?? new Set()
      if (stageIds.size === 0) continue
      const ptsMap = new Map<string, StandingsEntry>()
      for (const stage of stagesList) {
        if (!stageIds.has(stage.id as string)) continue
        for (const m of stage.matches ?? []) {
          if (m.status !== 'imported') continue
          for (const r of resultsByMatch.get(m.id as string) ?? []) {
            const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
            if (!ptsMap.has(key)) {
              ptsMap.set(key, {
                teamId: r.team_id ?? null,
                teamName: (r.pubg_team_name as string | null) ?? '',
                totalPts: 0, placePts: 0,
              })
            }
            const e = ptsMap.get(key)!
            const rule = matchToRule.get(m.id as string) ?? ruleFromStage(null)
            const pp = calcPlacementPtsWithRule(r.placement ?? 99, rule)
            e.totalPts += pp + Math.round((r.total_kills ?? 0) * rule.kill_pts)
            e.placePts += pp
          }
        }
        const extraForStage = stageAdditionalPts[stage.id as string] ?? {}
        for (const e of ptsMap.values()) {
          e.totalPts += extraForStage[e.teamName.toLowerCase()] ?? 0
        }
      }
      combinedStandingsMap.set(cid, [...ptsMap.values()].sort((a, b) =>
        b.totalPts !== a.totalPts ? b.totalPts - a.totalPts : b.placePts - a.placePts
      ))
    }

    // WWCD bonus per linked team
    const wwcdRewards = (wwcdData ?? []) as AnyRow[]
    const wwcdBonusByTeamId: Record<string, { prize: number; pgs: number; pgc: number }> = {}
    if (wwcdRewards.length > 0) {
      for (const stage of stagesList) {
        for (const m of stage.matches ?? []) {
          if (m.status !== 'imported') continue
          for (const r of resultsByMatch.get(m.id as string) ?? []) {
            if ((r.placement as number) !== 1 || !r.team_id) continue
            const teamId = r.team_id as string
            for (const reward of wwcdRewards) {
              if (reward.stage_id && reward.stage_id !== stage.id) continue
              if (reward.series_id && reward.series_id !== stage.series_id) continue
              const prizePerWwcd = reward.prize != null ? Number(reward.prize) : 0
              const pgsPerWwcd = reward.pgs_points ? Number(reward.pgs_points) : 0
              const pgcPerWwcd = reward.pgc_points ? Number(reward.pgc_points) : 0
              if (!wwcdBonusByTeamId[teamId]) wwcdBonusByTeamId[teamId] = { prize: 0, pgs: 0, pgc: 0 }
              wwcdBonusByTeamId[teamId].prize += prizePerWwcd
              wwcdBonusByTeamId[teamId].pgs += pgsPerWwcd
              wwcdBonusByTeamId[teamId].pgc += pgcPerWwcd
            }
          }
        }
      }
    }

    // Stage placement prizes → fold
    const stagePrizeByStage: Record<string, AnyRow[]> = {}
    for (const row of (stageSpData ?? []) as AnyRow[]) {
      if (!stagePrizeByStage[row.stage_id]) stagePrizeByStage[row.stage_id] = []
      stagePrizeByStage[row.stage_id].push(row)
    }
    for (const stage of stagesList) {
      const sp = stagePrizeByStage[stage.id as string]
      if (!sp || sp.length === 0) continue
      const standings = stageStandingsMap.get(stage.id as string) ?? []
      for (let i = 0; i < standings.length; i++) {
        const entry = standings[i]
        if (!entry.teamId) continue
        const pc = sp.find((p) => p.placement === i + 1)
        if (!pc) continue
        if (!wwcdBonusByTeamId[entry.teamId]) wwcdBonusByTeamId[entry.teamId] = { prize: 0, pgs: 0, pgc: 0 }
        wwcdBonusByTeamId[entry.teamId].prize += pc.prize != null ? Number(pc.prize) : 0
        wwcdBonusByTeamId[entry.teamId].pgs += pc.pgs_points != null ? Number(pc.pgs_points) : 0
        wwcdBonusByTeamId[entry.teamId].pgc += pc.pgc_points != null ? Number(pc.pgc_points) : 0
      }
    }

    // Series placement prizes → fold
    const seriesPrizeBySeries: Record<string, AnyRow[]> = {}
    for (const row of (seriesSpData ?? []) as AnyRow[]) {
      if (!seriesPrizeBySeries[row.series_id]) seriesPrizeBySeries[row.series_id] = []
      seriesPrizeBySeries[row.series_id].push(row)
    }
    for (const sr of seriesList) {
      const sp = seriesPrizeBySeries[sr.id as string]
      if (!sp || sp.length === 0) continue
      const standings = seriesStandingsMap.get(sr.id as string) ?? []
      for (let i = 0; i < standings.length; i++) {
        const entry = standings[i]
        if (!entry.teamId) continue
        const pc = sp.find((p) => p.placement === i + 1)
        if (!pc) continue
        if (!wwcdBonusByTeamId[entry.teamId]) wwcdBonusByTeamId[entry.teamId] = { prize: 0, pgs: 0, pgc: 0 }
        wwcdBonusByTeamId[entry.teamId].prize += pc.prize != null ? Number(pc.prize) : 0
        wwcdBonusByTeamId[entry.teamId].pgs += pc.pgs_points != null ? Number(pc.pgs_points) : 0
        wwcdBonusByTeamId[entry.teamId].pgc += pc.pgc_points != null ? Number(pc.pgc_points) : 0
      }
    }

    // Special award prizes/points for teams → fold into bonus map
    for (const r of (specialAwardsData ?? []) as AnyRow[]) {
      const teamId = r.team_id as string | null
      if (!teamId) continue
      const prize = r.prize != null ? Number(r.prize) : 0
      const pgs = r.pgs_points != null ? Number(r.pgs_points) : 0
      const pgc = r.pgc_points != null ? Number(r.pgc_points) : 0
      if (prize === 0 && pgs === 0 && pgc === 0) continue
      if (!wwcdBonusByTeamId[teamId]) wwcdBonusByTeamId[teamId] = { prize: 0, pgs: 0, pgc: 0 }
      wwcdBonusByTeamId[teamId].prize += prize
      wwcdBonusByTeamId[teamId].pgs += pgs
      wwcdBonusByTeamId[teamId].pgc += pgc
    }

    type RankEntry = { rank: number; teamId: string | null }
    const rankBoard: RankEntry[] = []

    if (rankMethod === 'stage') {
      const hasMapping = prizeConfig.some((p) => (p.stage_id != null || p.series_id != null || p.combined_scoreboard_id != null) && p.stage_rank != null)
      if (hasMapping) {
        for (const pc of prizeConfig) {
          if (!pc.stage_rank) continue
          const standings = pc.combined_scoreboard_id
            ? (combinedStandingsMap.get(pc.combined_scoreboard_id as string) ?? [])
            : pc.series_id
            ? (seriesStandingsMap.get(pc.series_id as string) ?? [])
            : pc.stage_id
            ? (stageStandingsMap.get(pc.stage_id as string) ?? [])
            : []
          if (standings.length === 0) continue
          const entry = standings[(pc.stage_rank as number) - 1]
          if (entry) rankBoard.push({ rank: pc.rank as number, teamId: entry.teamId })
        }
        rankBoard.sort((a, b) => a.rank - b.rank)
      } else {
        const grandFinal = stagesList.find((s) => s.type === 'grand_final')
        if (grandFinal) {
          const standings = stageStandingsMap.get(grandFinal.id as string) ?? []
          standings.forEach((e, i) => rankBoard.push({ rank: i + 1, teamId: e.teamId }))
        }
      }
    } else {
      // 'prize' / 'pgs' / 'pgc' — sort all teams by accumulated bonus.
      // Tiebreaker order (PGS rules):
      //   1. total PGS/prize/PGC points  (desc)
      //   2. total match points (placement + kills, all stages)  (desc)
      //   3. total placement points only  (desc)
      //   4. total kills  (desc)
      //   5. last stage's rank  (asc — lower rank number = better)

      // placement points per team across all stages
      const placePtsByTeamId: Record<string, number> = {}
      for (const standings of stageStandingsMap.values()) {
        for (const e of standings) {
          if (!e.teamId) continue
          placePtsByTeamId[e.teamId] = (placePtsByTeamId[e.teamId] ?? 0) + e.placePts
        }
      }

      // total match points (placement + kills) per team across all stages
      const totalMatchPtsByTeamId: Record<string, number> = {}
      for (const standings of stageStandingsMap.values()) {
        for (const e of standings) {
          if (!e.teamId) continue
          totalMatchPtsByTeamId[e.teamId] = (totalMatchPtsByTeamId[e.teamId] ?? 0) + e.totalPts
        }
      }

      // total kills per team from raw match results
      const totalKillsByTeamId: Record<string, number> = {}
      for (const r of trData) {
        if (!r.team_id) continue
        totalKillsByTeamId[r.team_id as string] = (totalKillsByTeamId[r.team_id as string] ?? 0) + ((r.total_kills as number) ?? 0)
      }

      // last stage that has at least one imported match (by order_num)
      const lastStageWithMatches = [...stagesList].reverse().find(
        (s) => (s.matches ?? []).some((m: AnyRow) => m.status === 'imported')
      )
      const lastStageStandings = lastStageWithMatches
        ? (stageStandingsMap.get(lastStageWithMatches.id as string) ?? [])
        : []
      const lastStageRankByTeamId: Record<string, number> = {}
      lastStageStandings.forEach((e, i) => {
        if (e.teamId) lastStageRankByTeamId[e.teamId] = i + 1
      })

      // Enumerate every team that ever played
      const teamSet = new Map<string, { teamId: string | null; teamName: string }>()
      for (const rs of resultsByMatch.values()) {
        for (const r of rs) {
          const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
          if (!teamSet.has(key)) teamSet.set(key, {
            teamId: r.team_id ?? null,
            teamName: (r.pubg_team_name as string | null) ?? '',
          })
        }
      }

      const teamList = [...teamSet.values()].map((ts) => {
        const bonus = ts.teamId ? wwcdBonusByTeamId[ts.teamId] ?? null : null
        const total = bonus
          ? rankMethod === 'prize' ? bonus.prize
            : rankMethod === 'pgs' ? bonus.pgs
            : bonus.pgc
          : 0
        const id = ts.teamId
        return {
          teamId: id,
          total,
          totalMatchPts: id ? (totalMatchPtsByTeamId[id] ?? 0) : 0,
          placePts:      id ? (placePtsByTeamId[id] ?? 0) : 0,
          totalKills:    id ? (totalKillsByTeamId[id] ?? 0) : 0,
          lastStageRank: id ? (lastStageRankByTeamId[id] ?? 999) : 999,
        }
      })

      teamList.sort((a, b) => {
        if (b.total !== a.total)            return b.total - a.total             // 1. PGS/prize/PGC
        if (b.totalMatchPts !== a.totalMatchPts) return b.totalMatchPts - a.totalMatchPts  // 2. total points
        if (b.placePts !== a.placePts)      return b.placePts - a.placePts       // 3. placement points
        if (b.totalKills !== a.totalKills)  return b.totalKills - a.totalKills   // 4. kills
        return a.lastStageRank - b.lastStageRank                                 // 5. last stage rank
      })
      teamList.forEach((e, i) => rankBoard.push({ rank: i + 1, teamId: e.teamId }))
    }

    // DQ split + renumber
    const dqTeamIds = new Set<string>(
      ((ttData ?? []) as AnyRow[]).filter((r) => r.disqualified).map((r) => r.team_id as string),
    )
    const active = rankBoard.filter((r) => !r.teamId || !dqTeamIds.has(r.teamId))
    const dq = rankBoard.filter((r) => r.teamId && dqTeamIds.has(r.teamId))

    const prizeByOrigRank = new Map<number, number | null>()
    for (const pc of prizeConfig) {
      prizeByOrigRank.set(pc.rank as number, pc.prize != null ? Number(pc.prize) : null)
    }

    const out = new Map<string, TournamentFinalStanding>()
    active.forEach((r, i) => {
      if (!r.teamId) return
      const basePrize = prizeByOrigRank.get(r.rank) ?? null
      const bonus = wwcdBonusByTeamId[r.teamId]?.prize ?? 0
      const total = (basePrize ?? 0) + bonus
      const prize = (basePrize == null && bonus === 0) ? null : total
      out.set(r.teamId, { rank: i + 1, prize })
    })
    for (const r of dq) {
      if (!r.teamId) continue
      out.set(r.teamId, { rank: 'DQ', prize: null })
    }
    return out
  },
  ['tournament-final-standings'],
  // Same tag as TournamentContent's loader so admin saves invalidate both.
  { revalidate: 30, tags: ['tournament-data'] },
)
