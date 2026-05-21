'use client'

import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import Link from 'next/link'
import { getMapDisplayName } from '@/lib/pubg-api'
import { createClient } from '@/lib/supabase/client'
import { calcPlacementPtsWithRule, ruleFromStage, DEFAULT_RULE } from '@/lib/scoring'
import type { Stage, Match, PlanePath } from '@/lib/types'
import FlightPathOverlay from './FlightPathOverlay'
import type { PlayerStatRow, PlayerMatchStat } from './PlayerStatsTable'

export interface TeamStatRow {
  teamId: string | null
  teamName: string
  logoUrl: string | null
  games: number
  wwcd: number
  totalKills: number
  totalDamage: number
  totalPoints: number
  placementsSum: number
  gamesWithPlacement: number
}

export interface DropLocationRow {
  id: string
  teamId: string
  teamName: string
  logoUrl: string | null
  mapName: string
  x: number
  y: number
  clusterCount?: number
  clusterIndex?: number
  clusterSize?: number
  totalMatches?: number
}

export interface TeamExtRow {
  teamId: string | null
  kills: number
  assists: number
  knocks: number
  headshotKills: number
  damage: number
  survivalTime: number
  deaths: number
  longestKill: number
  knockDamageSum: number
  engagementDistSum: number
  engagementDistCount: number
  stealKills: number
  stolenKills: number
  grenadesThrown: number
  smokesThrown: number
  flashbangsThrown: number
  molotovsThrown: number
  bzGrenadesThrown: number
  decoyGrenadesThrown: number
  grenadeDamage: number
  molotovDamage: number
  bzGrenadeDamage: number
  grenadeHitEvents: number
  damageTaken: number
  blueZoneDamage: number
  healsUsed: number
  boostsUsed: number
  totalHealAmount: number
  revives: number
  blueZoneTime: number
  walkDistance: number
  rideDistance: number
  swimDistance: number
  vehicleTime: number
  revivesGiven: number
  assistDamage: number
  tradeKills: number
  tradeableDeaths: number
  zoneEdgeSamples: number
  zoneTotalSamples: number
  zoneOutsideSamples: number
  zoneDistSum: number
  playerEntries: number
}

function emptyExt(teamId: string | null): TeamExtRow {
  return {
    teamId, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0, survivalTime: 0,
    deaths: 0, longestKill: 0, knockDamageSum: 0, engagementDistSum: 0, engagementDistCount: 0,
    stealKills: 0, stolenKills: 0,
    grenadesThrown: 0, smokesThrown: 0, flashbangsThrown: 0, molotovsThrown: 0,
    bzGrenadesThrown: 0, decoyGrenadesThrown: 0,
    grenadeDamage: 0, molotovDamage: 0, bzGrenadeDamage: 0, grenadeHitEvents: 0,
    damageTaken: 0, blueZoneDamage: 0, healsUsed: 0, boostsUsed: 0, totalHealAmount: 0, revives: 0, blueZoneTime: 0,
    walkDistance: 0, rideDistance: 0, swimDistance: 0, vehicleTime: 0,
    revivesGiven: 0, assistDamage: 0, tradeKills: 0, tradeableDeaths: 0,
    zoneEdgeSamples: 0, zoneTotalSamples: 0, zoneOutsideSamples: 0, zoneDistSum: 0,
    playerEntries: 0,
  }
}

function aggregateFromPlayerRows(rows: PlayerStatRow[]): Map<string, TeamExtRow> {
  const map = new Map<string, TeamExtRow>()
  for (const p of rows) {
    if (!p.teamId) continue
    if (!map.has(p.teamId)) map.set(p.teamId, emptyExt(p.teamId))
    const e = map.get(p.teamId)!
    e.playerEntries++
    e.kills += p.kills
    e.assists += p.assists
    e.knocks += p.knocks
    e.headshotKills += p.headshotKills
    e.damage += p.damage
    e.survivalTime += p.survivalTime
    e.deaths += p.deaths ?? 0
    e.longestKill = Math.max(e.longestKill, p.longestKill ?? 0)
    e.knockDamageSum += p.knockDamageSum ?? 0
    e.engagementDistSum += p.engagementDistSum ?? 0
    e.engagementDistCount += p.engagementDistCount ?? 0
    e.stealKills += p.stealKills ?? 0
    e.stolenKills += p.stolenKills ?? 0
    e.grenadesThrown += p.grenadesThrown ?? 0
    e.smokesThrown += p.smokesThrown ?? 0
    e.flashbangsThrown += p.flashbangsThrown ?? 0
    e.molotovsThrown += p.molotovsThrown ?? 0
    e.bzGrenadesThrown += p.bzGrenadesThrown ?? 0
    e.decoyGrenadesThrown += p.decoyGrenadesThrown ?? 0
    e.grenadeDamage += p.grenadeDamage ?? 0
    e.molotovDamage += p.molotovDamage ?? 0
    e.bzGrenadeDamage += p.bzGrenadeDamage ?? 0
    e.grenadeHitEvents += p.grenadeHitEvents ?? 0
    e.damageTaken += p.damageTaken ?? 0
    e.blueZoneDamage += p.blueZoneDamage ?? 0
    e.healsUsed += p.healsUsed ?? 0
    e.boostsUsed += p.boostsUsed ?? 0
    e.totalHealAmount += p.totalHealAmount ?? 0
    e.revives += p.revives ?? 0
    e.blueZoneTime += p.blueZoneTime ?? 0
    e.walkDistance += p.walkDistance ?? 0
    e.rideDistance += p.rideDistance ?? 0
    e.swimDistance += p.swimDistance ?? 0
    e.vehicleTime += p.vehicleTime ?? 0
    e.revivesGiven += p.revivesGiven ?? 0
    e.assistDamage += p.assistDamage ?? 0
    e.tradeKills += p.tradeKills ?? 0
    e.tradeableDeaths += p.tradeableDeaths ?? 0
    e.zoneEdgeSamples += p.zoneEdgeSamples ?? 0
    e.zoneTotalSamples += p.zoneTotalSamples ?? 0
    e.zoneOutsideSamples += p.zoneOutsideSamples ?? 0
    e.zoneDistSum += p.zoneDistSum ?? 0
  }
  return map
}

function aggregateFromMatchStats(matchIds: Set<string>, psByMatch: Record<string, PlayerMatchStat[]>): Map<string, TeamExtRow> {
  const map = new Map<string, TeamExtRow>()
  for (const [matchId, stats] of Object.entries(psByMatch)) {
    if (!matchIds.has(matchId)) continue
    for (const p of stats) {
      if (!p.teamId) continue
      if (!map.has(p.teamId)) map.set(p.teamId, emptyExt(p.teamId))
      const e = map.get(p.teamId)!
      e.playerEntries++
      e.kills += p.kills
      e.assists += p.assists
      e.knocks += p.knocks
      e.headshotKills += p.headshotKills
      e.damage += p.damage
      e.survivalTime += p.survivalTime
      e.walkDistance += p.walkDistance ?? 0
      e.rideDistance += p.rideDistance ?? 0
      e.swimDistance += p.swimDistance ?? 0
      e.longestKill = Math.max(e.longestKill, p.longestKill ?? 0)
      e.revives += p.revives ?? 0
      e.healsUsed += p.healsUsed ?? 0
      e.boostsUsed += p.boostsUsed ?? 0
    }
  }
  return map
}

function fmt(n: number | undefined, decimals = 0): string {
  if (n == null || n === 0) return '—'
  return decimals > 0 ? n.toFixed(decimals) : Math.round(n).toLocaleString()
}

function fmtDist(m: number | undefined): string {
  if (!m || m === 0) return '—'
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}

function formatSurvival(totalSec: number, games: number): string {
  if (games === 0 || totalSec === 0) return '—'
  const avg = totalSec / games
  const m = Math.floor(avg / 60)
  const s = Math.round(avg % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

type Category = 'combat' | 'utility' | 'survival' | 'movement' | 'teamplay' | 'positioning' | 'drops'
type ExtSortKey =
  | 'teamName' | 'games' | 'wwcd' | 'totalPoints' | 'avgPlacement'
  | 'kills' | 'kpg' | 'deaths' | 'kd' | 'assists' | 'knocks' | 'kkRatio' | 'dpk'
  | 'headshotKills' | 'hsPercent' | 'damage' | 'adr' | 'longestKill' | 'avgEngDist'
  | 'stealKills' | 'stolenKills'
  | 'grenadesThrown' | 'smokesThrown' | 'flashbangsThrown' | 'molotovsThrown'
  | 'bzGrenadesThrown' | 'decoyGrenadesThrown'
  | 'grenadeDamage' | 'molotovDamage' | 'bzGrenadeDamage' | 'utilityDamage' | 'grenadeHitRate'
  | 'avgSurvival' | 'damageTaken' | 'blueZoneDamage' | 'blueZoneTimePerGame'
  | 'dtr' | 'healsUsed' | 'boostsUsed' | 'healEfficiency' | 'revives'
  | 'walkDistance' | 'rideDistance' | 'swimDistance' | 'totalDistance' | 'vehicleTimePerGame'
  | 'revivesGiven' | 'assistDamagePerGame' | 'tradeKillRate'
  | 'zoneEdgePct' | 'avgDistToZone' | 'zoneOutsidePct'

type StageWithMatches = Stage & { matches: Pick<Match, 'id' | 'status' | 'order_num' | 'map'>[] }
interface SeriesItem { id: string; name: string; order_num: number; tab_order: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

const T_COL_RANK  = 32   // w-8
const T_COL_TEAM  = 180  // w-[180px]
const T_COL_GAMES = 80   // w-20
const T_LEFT_RANK  = 0
const T_LEFT_TEAM  = T_COL_RANK
const T_LEFT_GAMES = T_COL_RANK + T_COL_TEAM
const T_STICKY_HEAD = 'sticky z-20 bg-white'
const T_STICKY_BODY = 'sticky z-10 bg-white group-hover:bg-gray-50'

function mapImageUrl(mapKey: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/map-images/${encodeURIComponent(mapKey)}.jpg`
}

function findAllClusters(points: { x: number; y: number }[], radius = 0.07): { x: number; y: number; size: number }[] {
  if (points.length === 0) return []
  const remaining = [...points]
  const clusters: { x: number; y: number; size: number }[] = []
  while (remaining.length > 0) {
    let bestNbrs: typeof remaining = [remaining[0]]
    for (const p of remaining) {
      const nbrs = remaining.filter((q) => { const dx = q.x - p.x; const dy = q.y - p.y; return dx * dx + dy * dy <= radius * radius })
      if (nbrs.length > bestNbrs.length) bestNbrs = nbrs
    }
    const cx = bestNbrs.reduce((s, p) => s + p.x, 0) / bestNbrs.length
    const cy = bestNbrs.reduce((s, p) => s + p.y, 0) / bestNbrs.length
    clusters.push({ x: cx, y: cy, size: bestNbrs.length })
    for (const n of bestNbrs) { const idx = remaining.indexOf(n); if (idx !== -1) remaining.splice(idx, 1) }
  }
  return clusters.sort((a, b) => b.size - a.size)
}

const CAT_DEFAULT_SORT: Record<Category, ExtSortKey> = {
  combat: 'kills',
  utility: 'grenadeDamage',
  survival: 'damageTaken',
  movement: 'totalDistance',
  teamplay: 'revivesGiven',
  positioning: 'zoneEdgePct',
  drops: 'teamName',
}

export default function TeamStatsTable({
  teamStats,
  dropLocations,
  mapKeys,
  stages = [],
  series = [],
  resultsByMatch = {},
  playerStats = [],
  stagePlayerStats = {},
  seriesPlayerStats = {},
  playerStatsByMatch = {},
  stageTeamStats = {},
  seriesTeamStats = {},
}: {
  teamStats: TeamStatRow[]
  dropLocations: DropLocationRow[]
  mapKeys: string[]
  stages?: StageWithMatches[]
  series?: SeriesItem[]
  resultsByMatch?: Record<string, AnyRow[]>
  playerStats?: PlayerStatRow[]
  stagePlayerStats?: Record<string, PlayerStatRow[]>
  seriesPlayerStats?: Record<string, PlayerStatRow[]>
  playerStatsByMatch?: Record<string, PlayerMatchStat[]>
  stageTeamStats?: Record<string, TeamExtRow[]>
  seriesTeamStats?: Record<string, TeamExtRow[]>
}) {
  const [category, setCategory] = useState<Category>('combat')
  const [sortKey, setSortKey] = useState<ExtSortKey>('kills')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)

  // Drop tab state
  const [selectedMap, setSelectedMap] = useState<string>(mapKeys[0] ?? '')
  const [visibleTeams, setVisibleTeams] = useState<Set<string> | null>(null)
  const [dropScopeKey, setDropScopeKey] = useState<string>('total')
  const [dropStageId, setDropStageId] = useState<string | null>(null)
  const [rawCentroidsCache, setRawCentroidsCache] = useState<Map<string, { teamId: string; mapName: string; x: number; y: number }[]>>(new Map())
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [matchDropCache, setMatchDropCache] = useState<Map<string, DropLocationRow[]>>(new Map())
  const [flightPathCache, setFlightPathCache] = useState<Map<string, PlanePath | null>>(new Map())

  const teamTableRef = useRef<HTMLTableElement>(null)
  const [teamColLefts, setTeamColLefts] = useState({ team: T_LEFT_TEAM, games: T_LEFT_GAMES })

  useLayoutEffect(() => {
    if (!teamTableRef.current) return
    const ths = teamTableRef.current.querySelectorAll('thead tr:first-child th')
    if (ths.length < 3) return
    const rankW = (ths[0] as HTMLElement).offsetWidth
    const teamW = (ths[1] as HTMLElement).offsetWidth
    setTeamColLefts({ team: rankW, games: rankW + teamW })
  }, [category, search])

  function toggleSort(key: ExtSortKey) {
    if (sortKey === key) setSortDir((d) => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function selectCategory(cat: Category) {
    setCategory(cat)
    if (cat !== 'drops') {
      setSortKey(CAT_DEFAULT_SORT[cat])
      setSortDir('desc')
    }
  }

  function selectTotal() { setSelectedSeriesId(null); setSelectedStageId(null); setSelectedMatchId(null) }
  function selectSeries(id: string) {
    setSelectedSeriesId(prev => prev === id ? null : id)
    setSelectedStageId(null); setSelectedMatchId(null)
  }
  function selectStage(stageId: string, seriesId: string | null = null) {
    setSelectedSeriesId(seriesId)
    setSelectedStageId(prev => prev === stageId ? null : stageId)
    setSelectedMatchId(null)
  }
  function toggleMatch(id: string) { setSelectedMatchId(prev => prev === id ? null : id) }

  const activeMatchIds = useMemo(() => {
    if (selectedMatchId) return new Set([selectedMatchId])
    if (selectedStageId) {
      const stage = stages.find(s => s.id === selectedStageId)
      return new Set(stage?.matches.filter(m => m.status === 'imported').map(m => m.id) ?? [])
    }
    if (selectedSeriesId) {
      const ids = stages
        .filter(s => s.series_id === selectedSeriesId)
        .flatMap(s => s.matches.filter(m => m.status === 'imported').map(m => m.id))
      return new Set(ids)
    }
    return null
  }, [selectedMatchId, selectedStageId, selectedSeriesId, stages])

  const logoById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const t of teamStats) { if (t.teamId) m.set(t.teamId, t.logoUrl) }
    return m
  }, [teamStats])

  const matchToRule = useMemo(() => {
    const map = new Map<string, ReturnType<typeof ruleFromStage>>()
    for (const s of stages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rule = ruleFromStage((s as any).scoring_rules)
      for (const m of s.matches) map.set(m.id, rule)
    }
    return map
  }, [stages])

  const displayTeamStats = useMemo((): TeamStatRow[] => {
    if (!activeMatchIds) return teamStats
    const map = new Map<string, TeamStatRow>()
    for (const [matchId, rows] of Object.entries(resultsByMatch)) {
      if (!activeMatchIds.has(matchId)) continue
      const rule = matchToRule.get(matchId) ?? DEFAULT_RULE
      for (const r of rows) {
        const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
        const teamName = r._resolvedName ?? r.teams?.name ?? r.pubg_team_name ?? '?'
        if (!map.has(key)) {
          map.set(key, {
            teamId: r.team_id ?? null, teamName,
            logoUrl: (r.team_id ? logoById.get(r.team_id) : null) ?? r.teams?.logo_url ?? null,
            games: 0, wwcd: 0, totalKills: 0, totalDamage: 0, totalPoints: 0, placementsSum: 0, gamesWithPlacement: 0,
          })
        }
        const e = map.get(key)!
        e.games++
        if (r.placement === 1) e.wwcd++
        e.totalKills += r.total_kills ?? 0
        e.totalDamage += Number(r.total_damage ?? 0)
        e.totalPoints += calcPlacementPtsWithRule(r.placement ?? 99, rule) + Math.round((r.total_kills ?? 0) * rule.kill_pts)
        if (r.placement) { e.placementsSum += r.placement; e.gamesWithPlacement++ }
      }
    }
    return [...map.values()].sort((a, b) => b.totalPoints - a.totalPoints)
  }, [activeMatchIds, teamStats, resultsByMatch, logoById, matchToRule])

  // Aggregate player stats by team for the current scope
  const displayExtStats = useMemo((): Map<string, TeamExtRow> => {
    if (selectedMatchId) {
      return aggregateFromMatchStats(new Set([selectedMatchId]), playerStatsByMatch)
    }
    if (selectedStageId) {
      const preTeam = stageTeamStats[selectedStageId]
      if (preTeam && preTeam.length > 0) {
        const m = new Map<string, TeamExtRow>()
        for (const r of preTeam) { if (r.teamId) m.set(r.teamId, r) }
        return m
      }
      const pre = stagePlayerStats[selectedStageId]
      if (pre && pre.length > 0) return aggregateFromPlayerRows(pre)
      const stage = stages.find(s => s.id === selectedStageId)
      const ids = new Set(stage?.matches.filter(m => m.status === 'imported').map(m => m.id) ?? [])
      return aggregateFromMatchStats(ids, playerStatsByMatch)
    }
    if (selectedSeriesId) {
      const preTeam = seriesTeamStats[selectedSeriesId]
      if (preTeam && preTeam.length > 0) {
        const m = new Map<string, TeamExtRow>()
        for (const r of preTeam) { if (r.teamId) m.set(r.teamId, r) }
        return m
      }
      const pre = seriesPlayerStats[selectedSeriesId]
      if (pre && pre.length > 0) return aggregateFromPlayerRows(pre)
      const ids = new Set(stages.filter(s => s.series_id === selectedSeriesId).flatMap(s => s.matches.filter(m => m.status === 'imported').map(m => m.id)))
      return aggregateFromMatchStats(ids, playerStatsByMatch)
    }
    return aggregateFromPlayerRows(playerStats)
  }, [selectedMatchId, selectedStageId, selectedSeriesId, playerStats, stagePlayerStats, seriesPlayerStats, playerStatsByMatch, stageTeamStats, seriesTeamStats, stages])

  // Merge displayTeamStats (games/wwcd/points) + displayExtStats (player-aggregated) per team
  const enrichedRows = useMemo(() => {
    const q = search.toLowerCase()
    const rows = displayTeamStats.map(t => {
      const ext = t.teamId ? displayExtStats.get(t.teamId) ?? emptyExt(t.teamId) : emptyExt(t.teamId)
      const g = Math.max(t.games, 1)
      const kills = ext.kills || t.totalKills
      const damage = ext.damage || t.totalDamage
      const knocks = ext.knocks
      return {
        teamId: t.teamId, teamName: t.teamName, logoUrl: t.logoUrl,
        games: t.games, wwcd: t.wwcd, totalPoints: t.totalPoints,
        avgPlacement: t.gamesWithPlacement > 0 ? t.placementsSum / t.gamesWithPlacement : 99,
        kills, kpg: kills / g, damage, adr: damage / g,
        deaths: ext.deaths, kd: ext.deaths > 0 ? kills / ext.deaths : kills,
        assists: ext.assists, knocks,
        kkRatio: knocks > 0 ? kills / knocks : 0,
        dpk: knocks > 0 ? ext.knockDamageSum / knocks : 0,
        headshotKills: ext.headshotKills,
        hsPercent: kills > 0 ? (ext.headshotKills / kills) * 100 : 0,
        longestKill: ext.longestKill,
        avgEngDist: ext.engagementDistCount > 0 ? ext.engagementDistSum / ext.engagementDistCount : 0,
        stealKills: ext.stealKills, stolenKills: ext.stolenKills,
        grenadesThrown: ext.grenadesThrown, smokesThrown: ext.smokesThrown,
        flashbangsThrown: ext.flashbangsThrown, molotovsThrown: ext.molotovsThrown,
        bzGrenadesThrown: ext.bzGrenadesThrown, decoyGrenadesThrown: ext.decoyGrenadesThrown,
        grenadeDamage: ext.grenadeDamage, molotovDamage: ext.molotovDamage,
        bzGrenadeDamage: ext.bzGrenadeDamage,
        utilityDamage: ext.grenadeDamage + ext.molotovDamage + ext.bzGrenadeDamage,
        grenadeHitRate: (ext.grenadesThrown + ext.molotovsThrown + ext.flashbangsThrown) > 0
          ? (ext.grenadeHitEvents / (ext.grenadesThrown + ext.molotovsThrown + ext.flashbangsThrown)) * 100 : 0,
        avgSurvival: ext.playerEntries > 0 ? ext.survivalTime / ext.playerEntries : 0,
        damageTaken: ext.damageTaken, blueZoneDamage: ext.blueZoneDamage,
        blueZoneTimePerGame: ext.blueZoneTime / g,
        dtr: ext.damageTaken > 0 ? damage / ext.damageTaken : 0,
        healsUsed: ext.healsUsed, boostsUsed: ext.boostsUsed,
        healEfficiency: ext.healsUsed > 0 ? ext.totalHealAmount / ext.healsUsed : 0,
        revives: ext.revives,
        walkDistance: ext.walkDistance, rideDistance: ext.rideDistance, swimDistance: ext.swimDistance,
        totalDistance: ext.walkDistance + ext.rideDistance + ext.swimDistance,
        vehicleTimePerGame: ext.vehicleTime / g,
        revivesGiven: ext.revivesGiven,
        assistDamagePerGame: ext.assistDamage / g,
        tradeKillRate: kills > 0 ? (ext.tradeKills / kills) * 100 : 0,
        zoneEdgePct: ext.zoneTotalSamples > 0 ? (ext.zoneEdgeSamples / ext.zoneTotalSamples) * 100 : 0,
        avgDistToZone: ext.zoneTotalSamples > 0 ? ext.zoneDistSum / ext.zoneTotalSamples : 0,
        zoneOutsidePct: ext.zoneTotalSamples > 0 ? (ext.zoneOutsideSamples / ext.zoneTotalSamples) * 100 : 0,
      }
    }).filter(t => !q || t.teamName.toLowerCase().includes(q))

    return [...rows].sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1
      const av = (a as Record<string, number | string>)[sortKey]
      const bv = (b as Record<string, number | string>)[sortKey]
      if (typeof av === 'string') return dir * av.localeCompare(bv as string)
      if (sortKey === 'avgPlacement') return -dir * ((av as number) - (bv as number))
      return dir * ((av as number) - (bv as number))
    })
  }, [displayTeamStats, displayExtStats, sortKey, sortDir, search])

  // Drop tab effects
  const teamInfoById = useMemo(() => {
    const map = new Map<string, { teamName: string; logoUrl: string | null }>()
    for (const d of dropLocations) map.set(d.teamId, { teamName: d.teamName, logoUrl: d.logoUrl })
    for (const t of teamStats) {
      if (t.teamId && !map.has(t.teamId)) map.set(t.teamId, { teamName: t.teamName, logoUrl: t.logoUrl })
    }
    return map
  }, [dropLocations, teamStats])

  useEffect(() => {
    if (category !== 'drops') return
    if (dropScopeKey === 'total' || dropScopeKey.startsWith('match:')) return
    if (rawCentroidsCache.has(dropScopeKey)) return
    let matchIds: string[] = []
    if (dropScopeKey.startsWith('stage:')) {
      const stageId = dropScopeKey.slice(6)
      const stage = stages.find((s) => s.id === stageId)
      matchIds = stage?.matches.filter((m) => m.status === 'imported').map((m) => m.id) ?? []
    } else if (dropScopeKey.startsWith('series:')) {
      const seriesId = dropScopeKey.slice(7)
      matchIds = stages.filter((s) => s.series_id === seriesId).flatMap((s) => s.matches.filter((m) => m.status === 'imported').map((m) => m.id))
    }
    if (matchIds.length === 0) { setRawCentroidsCache((prev) => new Map(prev).set(dropScopeKey, [])); return }
    const supabase = createClient()
    supabase.from('match_team_drop_locations').select('team_id, map_name, x, y').in('match_id', matchIds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (data ?? []).map((d: any) => ({ teamId: d.team_id as string, mapName: d.map_name as string, x: d.x as number, y: d.y as number }))
        setRawCentroidsCache((prev) => new Map(prev).set(dropScopeKey, rows))
      })
  }, [category, dropScopeKey, rawCentroidsCache, stages])

  useEffect(() => {
    if (!dropScopeKey.startsWith('match:')) return
    const matchId = dropScopeKey.slice(6)
    if (matchDropCache.has(matchId)) return
    const supabase = createClient()
    supabase.from('match_team_drop_locations').select('team_id, map_name, x, y').eq('match_id', matchId)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: DropLocationRow[] = (data ?? []).map((d: any) => {
          const info = teamInfoById.get(d.team_id)
          return { id: `${matchId}_${d.team_id}`, teamId: d.team_id, teamName: info?.teamName ?? d.team_id, logoUrl: info?.logoUrl ?? null, mapName: d.map_name, x: d.x, y: d.y }
        })
        setMatchDropCache((prev) => new Map(prev).set(matchId, rows))
      })
  }, [dropScopeKey, matchDropCache, teamInfoById])

  useEffect(() => {
    if (!dropScopeKey.startsWith('match:')) return
    const matchId = dropScopeKey.slice(6)
    if (flightPathCache.has(matchId)) return
    const supabase = createClient()
    supabase.from('match_flight_paths').select('points').eq('match_id', matchId).single()
      .then(({ data }) => {
        const fp = (data?.points as PlanePath | null) ?? null
        setFlightPathCache((prev) => new Map(prev).set(matchId, fp?.jumps && fp.jumps.length >= 2 ? fp : null))
      })
  }, [dropScopeKey, flightPathCache])

  const dropsForScope = useMemo((): DropLocationRow[] => {
    if (dropScopeKey === 'total') return dropLocations
    if (dropScopeKey.startsWith('match:')) {
      const matchId = dropScopeKey.slice(6)
      return matchDropCache.get(matchId) ?? []
    }
    const rawCentroids = rawCentroidsCache.get(dropScopeKey)
    if (!rawCentroids) return []
    const grouped = new Map<string, { x: number[]; y: number[] }>()
    for (const c of rawCentroids) {
      const key = `${c.teamId}\0${c.mapName}`
      if (!grouped.has(key)) grouped.set(key, { x: [], y: [] })
      grouped.get(key)!.x.push(c.x); grouped.get(key)!.y.push(c.y)
    }
    const result: DropLocationRow[] = []
    for (const [key, coords] of grouped.entries()) {
      const sep = key.indexOf('\0')
      const teamId = key.slice(0, sep); const mapName = key.slice(sep + 1)
      const info = teamInfoById.get(teamId)
      const points = coords.x.map((x, i) => ({ x, y: coords.y[i] }))
      const clusters = findAllClusters(points)
      clusters.forEach((cluster, idx) => {
        result.push({
          id: `${dropScopeKey}_${teamId}_${mapName}_${idx}`, teamId,
          teamName: info?.teamName ?? teamId, logoUrl: info?.logoUrl ?? null,
          mapName, x: cluster.x, y: cluster.y,
          clusterCount: clusters.length, clusterIndex: idx, clusterSize: cluster.size, totalMatches: points.length,
        })
      })
    }
    return result
  }, [dropScopeKey, dropLocations, rawCentroidsCache, matchDropCache, teamInfoById])

  const mapsWithDrops = useMemo(() => [...new Set(dropLocations.map((d) => d.mapName))].filter((m) => mapKeys.includes(m)), [dropLocations, mapKeys])
  const allDropMaps = useMemo(() => [...new Set([...mapKeys, ...mapsWithDrops])], [mapKeys, mapsWithDrops])
  useEffect(() => { for (const k of allDropMaps) { const img = new window.Image(); img.src = mapImageUrl(k) } }, [allDropMaps])

  const currentMapDrops = dropsForScope.filter((d) => d.mapName === selectedMap)
  const uniqueTeamsForMap = (() => {
    const seen = new Set<string>(); const result: DropLocationRow[] = []
    for (const d of currentMapDrops) { if (!seen.has(d.teamId)) { seen.add(d.teamId); result.push(d) } }
    return result.sort((a, b) => { const aS = (a.clusterCount ?? 1) > 1; const bS = (b.clusterCount ?? 1) > 1; if (aS !== bS) return aS ? -1 : 1; return 0 })
  })()
  const visibleDrops = currentMapDrops.filter((drop) => {
    if ((drop.clusterIndex ?? 0) > 0) return expandedTeams.has(drop.teamId)
    return visibleTeams === null || visibleTeams.has(drop.teamId)
  })

  // Spread overlapping logos into a circle so all logos are visible
  const OVERLAP_THRESHOLD = 0.02
  const SPREAD_RADIUS = 0.016
  const displayDrops: (DropLocationRow & { displayX: number; displayY: number })[] = (() => {
    const visited = new Set<string>()
    const result: (DropLocationRow & { displayX: number; displayY: number })[] = []
    for (const drop of visibleDrops) {
      if (visited.has(drop.id)) continue
      const group: DropLocationRow[] = [drop]
      visited.add(drop.id)
      let gi = 0
      while (gi < group.length) {
        const cur = group[gi]
        for (const other of visibleDrops) {
          if (visited.has(other.id)) continue
          const dx = cur.x - other.x
          const dy = cur.y - other.y
          if (Math.sqrt(dx * dx + dy * dy) < OVERLAP_THRESHOLD) {
            group.push(other)
            visited.add(other.id)
          }
        }
        gi++
      }
      if (group.length === 1) {
        result.push({ ...drop, displayX: drop.x, displayY: drop.y })
      } else {
        group.sort((a, b) => a.teamId.localeCompare(b.teamId))
        const cx = group.reduce((s, d) => s + d.x, 0) / group.length
        const cy = group.reduce((s, d) => s + d.y, 0) / group.length
        group.forEach((d, idx) => {
          const angle = (idx / group.length) * 2 * Math.PI - Math.PI / 2
          result.push({
            ...d,
            displayX: Math.max(0.015, Math.min(0.985, cx + Math.cos(angle) * SPREAD_RADIUS)),
            displayY: Math.max(0.015, Math.min(0.985, cy + Math.sin(angle) * SPREAD_RADIUS)),
          })
        })
      }
    }
    return result
  })()

  function toggleTeamVisibility(teamId: string) {
    const isSpread = currentMapDrops.some((d) => d.teamId === teamId && (d.clusterCount ?? 1) > 1)
    if (isSpread) {
      setExpandedTeams((prev) => { const next = new Set(prev); if (next.has(teamId)) next.delete(teamId); else next.add(teamId); return next })
    } else {
      setVisibleTeams((prev) => {
        if (prev === null) { const all = new Set(currentMapDrops.filter((d) => (d.clusterCount ?? 1) === 1).map((d) => d.teamId)); all.delete(teamId); return all }
        const next = new Set(prev); if (next.has(teamId)) next.delete(teamId); else next.add(teamId); return next
      })
    }
  }

  const topScopes = useMemo(() => {
    const items: ({ kind: 'series'; series: SeriesItem; key: number } | { kind: 'stage'; stage: StageWithMatches; key: number })[] = []
    for (const sr of series) items.push({ kind: 'series', series: sr, key: sr.tab_order })
    for (const s of stages) { if (s.series_id) continue; items.push({ kind: 'stage', stage: s, key: s.tab_order }) }
    return items.sort((a, b) => a.key - b.key)
  }, [series, stages])

  const teamFixedHeaders = (
    <>
      <th className={`${T_STICKY_HEAD} w-8 px-3 py-2 text-center text-[11px] font-semibold text-gray-400`} style={{ left: T_LEFT_RANK }}>#</th>
      <th className={`${T_STICKY_HEAD} w-[180px] px-3 py-2 text-left text-[11px] font-semibold text-gray-400 uppercase tracking-wide`} style={{ left: teamColLefts.team }}>Team</th>
      <th
        onClick={() => toggleSort('games')}
        className={`${T_STICKY_HEAD} w-20 px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 transition-colors border-r border-gray-200 ${sortKey === 'games' ? 'text-yellow-600' : 'text-gray-400'}`}
        style={{ left: teamColLefts.games }}
      >
        Matches{sortKey === 'games' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
      </th>
    </>
  )

  function teamFixedCells(t: typeof enrichedRows[0], i: number) {
    return (
      <>
        <td className={`${T_STICKY_BODY} w-8 px-3 py-2 text-center text-gray-400 text-xs`} style={{ left: T_LEFT_RANK }}>{i + 1}</td>
        <td className={`${T_STICKY_BODY} w-[180px] px-3 py-2`} style={{ left: teamColLefts.team }}>
          <div className="flex items-center gap-1.5">
            {t.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.logoUrl} alt="" className="w-4 h-4 rounded object-contain border border-gray-100 shrink-0" />
            ) : <span className="w-4 h-4 rounded bg-gray-100 shrink-0" />}
            <span className="font-medium text-gray-800 text-xs truncate">
              {t.teamId ? <Link href={`/teams/${t.teamId}`} className="hover:text-yellow-600">{t.teamName}</Link> : t.teamName}
            </span>
          </div>
        </td>
        <td className={`${T_STICKY_BODY} w-20 px-3 py-2 text-right text-gray-500 text-xs border-r border-gray-200`} style={{ left: teamColLefts.games }}>{t.games}</td>
      </>
    )
  }

  const currentStage = selectedStageId ? stages.find(s => s.id === selectedStageId) : null
  const currentStageMatches = currentStage
    ? [...currentStage.matches].filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num)
    : []

  const scopeBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-lg border transition-colors ${active ? 'bg-yellow-400 border-yellow-400 text-gray-900 font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`
  const matchBtn = (active: boolean) =>
    `min-w-[28px] px-2 py-1 text-xs font-mono rounded border transition-colors ${active ? 'bg-gray-800 border-gray-800 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`
  const catBtn = (cat: Category) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${category === cat ? 'border-yellow-400 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`

  function thR(key: ExtSortKey, main: string, sub?: string) {
    const active = sortKey === key
    const ind = active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''
    return (
      <th onClick={() => toggleSort(key)}
        className={`px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 transition-colors whitespace-nowrap ${active ? 'text-yellow-600' : 'text-gray-400'}`}
      >
        {sub ? (
          <span className="inline-flex flex-col items-end leading-none gap-0.5">
            <span className="whitespace-nowrap">{main}{ind}</span>
            <span className="text-[9px] font-normal normal-case tracking-normal whitespace-nowrap opacity-60">{sub}</span>
          </span>
        ) : <span className="whitespace-nowrap">{main}{ind}</span>}
      </th>
    )
  }

  const scopeNav = (
    <>
      {stages.length > 0 && (
        <div className="px-4 py-3 bg-gray-50/80 border-b border-gray-200 space-y-2">
          <div className="flex flex-wrap gap-1.5 items-center">
            <button onClick={selectTotal} className={scopeBtn(!selectedSeriesId && !selectedStageId && !selectedMatchId)}>Total</button>
            {topScopes.map(item => item.kind === 'series' ? (
              <button key={`series:${item.series.id}`} onClick={() => selectSeries(item.series.id)} className={scopeBtn(selectedSeriesId === item.series.id && !selectedStageId)}>
                {item.series.name}
              </button>
            ) : (
              <button key={`stage:${item.stage.id}`} onClick={() => selectStage(item.stage.id, null)} className={scopeBtn(selectedStageId === item.stage.id)}>
                {item.stage.name}
              </button>
            ))}
          </div>
          {selectedSeriesId && (
            <div className="flex flex-wrap gap-1.5 pl-3 border-l-2 border-yellow-300">
              {stages.filter(s => s.series_id === selectedSeriesId).map(s => (
                <button key={s.id} onClick={() => selectStage(s.id, selectedSeriesId)} className={scopeBtn(selectedStageId === s.id)}>{s.name}</button>
              ))}
            </div>
          )}
          {currentStageMatches.length > 0 && (
            <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-gray-200">
              {currentStageMatches.map((m, i) => (
                <button key={m.id} onClick={() => toggleMatch(m.id)} className={matchBtn(selectedMatchId === m.id)}>M{i + 1}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Category tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50/50 px-2 gap-1 overflow-x-auto">
        <button onClick={() => selectCategory('combat')} className={catBtn('combat')}>Combat</button>
        <button onClick={() => selectCategory('utility')} className={catBtn('utility')}>Utility</button>
        <button onClick={() => selectCategory('survival')} className={catBtn('survival')}>Survival</button>
        <button onClick={() => selectCategory('movement')} className={catBtn('movement')}>Movement</button>
        <button onClick={() => selectCategory('teamplay')} className={catBtn('teamplay')}>Teamplay</button>
        <button onClick={() => selectCategory('positioning')} className={catBtn('positioning')}>Positioning</button>
        <button onClick={() => selectCategory('drops')} className={catBtn('drops')}>낙하 지점</button>
        {category !== 'drops' && (
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="ml-auto border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 w-32 shrink-0 my-1.5"
          />
        )}
      </div>

      {category !== 'drops' ? (
        teamStats.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">No team data available</div>
        ) : (
          <>
            {scopeNav}
            <div className="overflow-x-auto">
              <table ref={teamTableRef} className="w-full text-xs border-collapse">
                <thead>
                  {category === 'combat' && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {teamFixedHeaders}
                      {thR('wwcd', 'WWCD')}
                      {thR('totalPoints', 'Pts', 'Total')}
                      {thR('avgPlacement', 'Avg Plc', 'Placement')}
                      {thR('kills', 'Kills')}
                      {thR('kpg', 'KPG', 'Kills per Game')}
                      {thR('deaths', 'Deaths')}
                      {thR('kd', 'K/D', 'Kill / Death')}
                      {thR('assists', 'Assists')}
                      {thR('knocks', 'Knocks')}
                      {thR('kkRatio', 'K/K', 'Kill / Knock')}
                      {thR('dpk', 'DPK', 'Dmg per Knock')}
                      {thR('headshotKills', 'HS Kills', 'Headshot')}
                      {thR('hsPercent', 'HS%', 'Headshot Rate')}
                      {thR('damage', 'Damage')}
                      {thR('adr', 'ADR', 'Avg per Round')}
                      {thR('longestKill', 'Longest Kill')}
                      {thR('avgEngDist', 'Avg Eng Dist', 'Engagement Dist')}
                      {thR('stealKills', 'Steal Kills', 'Finished Ally Knock')}
                      {thR('stolenKills', 'Stolen Kills', 'Knock Taken by Ally')}
                    </tr>
                  )}
                  {category === 'utility' && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {teamFixedHeaders}
                      {thR('grenadesThrown', 'Grenades', 'Thrown')}
                      {thR('smokesThrown', 'Smokes', 'Thrown')}
                      {thR('flashbangsThrown', 'Flashes', 'Thrown')}
                      {thR('molotovsThrown', 'Molotovs', 'Thrown')}
                      {thR('bzGrenadesThrown', 'BZ Nade', 'Thrown')}
                      {thR('decoyGrenadesThrown', 'Decoy', 'Thrown')}
                      {thR('grenadeDamage', 'Grenade', 'Damage')}
                      {thR('molotovDamage', 'Molotov', 'Damage')}
                      {thR('bzGrenadeDamage', 'BZ Dmg', 'BZ Grenade')}
                      {thR('utilityDamage', 'Utility', 'Total Damage')}
                      {thR('grenadeHitRate', 'Hit Rate', 'Throw → Hit %')}
                    </tr>
                  )}
                  {category === 'survival' && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {teamFixedHeaders}
                      {thR('avgSurvival', 'Avg Survival', 'Sum / Game')}
                      {thR('deaths', 'Deaths')}
                      {thR('damageTaken', 'Dmg Taken', 'Damage Taken')}
                      {thR('blueZoneDamage', 'BZ Damage', 'Blue Zone')}
                      {thR('blueZoneTimePerGame', 'BZ Time', 'per Game')}
                      {thR('dtr', 'DD/DT', 'Dealt / Taken')}
                      {thR('healsUsed', 'Heals', 'Used')}
                      {thR('boostsUsed', 'Boosts', 'Used')}
                      {thR('healEfficiency', 'Heal Eff', 'HP per Use')}
                      {thR('revives', 'Revived')}
                    </tr>
                  )}
                  {category === 'movement' && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {teamFixedHeaders}
                      {thR('walkDistance', 'Walk', 'Total')}
                      {thR('rideDistance', 'Ride', 'Total')}
                      {thR('swimDistance', 'Swim', 'Total')}
                      {thR('totalDistance', 'Total Dist', 'All Movement')}
                      {thR('vehicleTimePerGame', 'Vehicle', 'Time per Game')}
                    </tr>
                  )}
                  {category === 'teamplay' && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {teamFixedHeaders}
                      {thR('assists', 'Assists')}
                      {thR('knocks', 'Knocks')}
                      {thR('tradeKillRate', 'Trade Kill', 'Rate %')}
                      {thR('revivesGiven', 'Revives', 'Given')}
                      {thR('revives', 'Revived')}
                      {thR('assistDamagePerGame', 'Assist Dmg', 'per Game')}
                    </tr>
                  )}
                  {category === 'positioning' && (
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {teamFixedHeaders}
                      {thR('zoneEdgePct', 'Zone Edge', 'Time % at Edge')}
                      {thR('avgDistToZone', 'Avg Dist', 'to Zone Center')}
                      {thR('zoneOutsidePct', 'Outside Zone', 'Time % outside')}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {enrichedRows.length === 0 && (
                    <tr><td colSpan={20} className="px-3 py-10 text-center text-gray-400 text-sm">No data for this scope</td></tr>
                  )}
                  {enrichedRows.map((t, i) => (
                    <tr key={t.teamId ?? t.teamName} className="group border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      {teamFixedCells(t, i)}
                      {category === 'combat' && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.wwcd}</td>
                          <td className="px-3 py-2 text-right font-bold text-gray-900 text-xs">{t.totalPoints}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.avgPlacement < 99 ? t.avgPlacement.toFixed(1) : '—'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-gray-800 text-xs">{t.kills}</td>
                          <td className="px-3 py-2 text-right text-gray-600 text-xs">{t.kpg.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.deaths > 0 ? t.deaths : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-600 text-xs">{t.deaths > 0 ? t.kd.toFixed(2) : t.kills}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.assists}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.knocks}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.knocks > 0 ? t.kkRatio.toFixed(2) : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.dpk > 0 ? Math.round(t.dpk).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.headshotKills > 0 ? t.headshotKills : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.kills > 0 ? t.hsPercent.toFixed(1) + '%' : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{Math.round(t.damage).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-700 text-xs">{Math.round(t.adr).toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.longestKill > 0 ? `${Math.round(t.longestKill)}m` : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.avgEngDist > 0 ? `${Math.round(t.avgEngDist)}m` : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.stealKills > 0 ? t.stealKills : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.stolenKills > 0 ? t.stolenKills : '—'}</td>
                        </>
                      )}
                      {category === 'utility' && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium text-xs">{fmt(t.grenadesThrown)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.smokesThrown)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.flashbangsThrown)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.molotovsThrown)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.bzGrenadesThrown)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.decoyGrenadesThrown)}</td>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium text-xs">{t.grenadeDamage > 0 ? Math.round(t.grenadeDamage).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.molotovDamage > 0 ? Math.round(t.molotovDamage).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.bzGrenadeDamage > 0 ? Math.round(t.bzGrenadeDamage).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.utilityDamage > 0 ? Math.round(t.utilityDamage).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.grenadeHitRate > 0 ? t.grenadeHitRate.toFixed(1) + '%' : '—'}</td>
                        </>
                      )}
                      {category === 'survival' && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium text-xs">{formatSurvival(t.avgSurvival, 1)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.deaths > 0 ? t.deaths : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.damageTaken > 0 ? Math.round(t.damageTaken).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.blueZoneDamage > 0 ? Math.round(t.blueZoneDamage).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.blueZoneTimePerGame > 0 ? Math.round(t.blueZoneTimePerGame) + 's' : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.damageTaken > 0 ? t.dtr.toFixed(2) : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.healsUsed)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.boostsUsed)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.healEfficiency > 0 ? Math.round(t.healEfficiency).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmt(t.revives)}</td>
                        </>
                      )}
                      {category === 'movement' && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmtDist(t.walkDistance)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmtDist(t.rideDistance)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{fmtDist(t.swimDistance)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-700 text-xs">{fmtDist(t.totalDistance)}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.vehicleTimePerGame > 0 ? Math.round(t.vehicleTimePerGame) + 's' : '—'}</td>
                        </>
                      )}
                      {category === 'teamplay' && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium text-xs">{t.assists}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.knocks}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.tradeKillRate > 0 ? t.tradeKillRate.toFixed(1) + '%' : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium text-xs">{t.revivesGiven > 0 ? t.revivesGiven : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.revives > 0 ? t.revives : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.assistDamagePerGame > 0 ? Math.round(t.assistDamagePerGame).toLocaleString() : '—'}</td>
                        </>
                      )}
                      {category === 'positioning' && (
                        <>
                          <td className="px-3 py-2 text-right text-gray-700 font-medium text-xs">{t.zoneEdgePct > 0 ? t.zoneEdgePct.toFixed(1) + '%' : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.avgDistToZone > 0 ? fmtDist(t.avgDistToZone) : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-500 text-xs">{t.zoneOutsidePct > 0 ? t.zoneOutsidePct.toFixed(1) + '%' : '—'}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : (
        /* Drop Points tab */
        <div className="p-4">
          {allDropMaps.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-10">
              낙하 지점 데이터가 없습니다.<br />
              <span className="text-xs text-gray-300">어드민에서 낙하 지점을 입력해주세요.</span>
            </div>
          ) : (
            <>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {allDropMaps.map((mapKey) => (
                  <button key={mapKey}
                    onClick={() => {
                      setSelectedMap(mapKey); setVisibleTeams(null); setExpandedTeams(new Set())
                      if (dropScopeKey.startsWith('match:')) setDropScopeKey(dropStageId ? `stage:${dropStageId}` : 'total')
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${selectedMap === mapKey ? 'bg-yellow-400 border-yellow-400 text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-300'}`}
                  >
                    {getMapDisplayName(mapKey)}
                  </button>
                ))}
              </div>
              {topScopes.length > 0 && (
                <div className="space-y-2 mb-4">
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => { setDropScopeKey('total'); setDropStageId(null); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={scopeBtn(dropScopeKey === 'total')}>Total</button>
                    {topScopes.map((item) => {
                      if (item.kind === 'series') {
                        const key = `series:${item.series.id}`
                        return (
                          <button key={key} onClick={() => { setDropScopeKey(key); setDropStageId(null); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={scopeBtn(dropScopeKey === key)}>
                            {item.series.name}
                          </button>
                        )
                      }
                      const stageKey = `stage:${item.stage.id}`
                      const isActive = stageKey === dropScopeKey || (dropScopeKey.startsWith('match:') && dropStageId === item.stage.id)
                      return (
                        <button key={stageKey} onClick={() => { setDropScopeKey(stageKey); setDropStageId(item.stage.id); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={scopeBtn(isActive)}>
                          {item.stage.name}
                        </button>
                      )
                    })}
                  </div>
                  {dropScopeKey.startsWith('series:') && (() => {
                    const seriesId = dropScopeKey.slice(7)
                    const subStages = stages.filter(s => s.series_id === seriesId)
                    if (subStages.length === 0) return null
                    return (
                      <div className="flex flex-wrap gap-1.5 pl-3 border-l-2 border-yellow-300">
                        {subStages.map(s => {
                          const isActive = `stage:${s.id}` === dropScopeKey || (dropScopeKey.startsWith('match:') && dropStageId === s.id)
                          return (
                            <button key={s.id} onClick={() => { setDropScopeKey(`stage:${s.id}`); setDropStageId(s.id); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={scopeBtn(isActive)}>
                              {s.name}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
                  {dropStageId && (() => {
                    const stage = stages.find(s => s.id === dropStageId)
                    const allImported = stage?.matches.filter(m => m.status === 'imported').sort((a, b) => a.order_num - b.order_num) ?? []
                    if (allImported.filter(m => !m.map || m.map === selectedMap).length === 0) return null
                    return (
                      <div className="flex flex-wrap gap-1 pl-3 border-l-2 border-gray-200">
                        {allImported.map((m, i) => {
                          if (m.map && m.map !== selectedMap) return null
                          return (
                            <button key={m.id} onClick={() => { setDropScopeKey(`match:${m.id}`); setVisibleTeams(null); setExpandedTeams(new Set()) }} className={matchBtn(dropScopeKey === `match:${m.id}`)}>
                              M{i + 1}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}
              <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 176px' }}>
                <div className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-100" style={{ aspectRatio: '1' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mapImageUrl(selectedMap)} alt={getMapDisplayName(selectedMap)} className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <div className="absolute inset-0 grid-pattern opacity-30" />
                  {currentMapDrops.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-gray-400 text-xs bg-white/80 px-3 py-2 rounded-lg">이 맵의 낙하 지점 데이터가 없습니다</p>
                    </div>
                  )}
                  {((dropScopeKey !== 'total' && !dropScopeKey.startsWith('match:') && !rawCentroidsCache.has(dropScopeKey)) || (dropScopeKey.startsWith('match:') && !matchDropCache.has(dropScopeKey.slice(6)))) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                      <span className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {dropScopeKey.startsWith('match:') && (() => {
                    const fp = flightPathCache.get(dropScopeKey.slice(6))
                    return fp ? <FlightPathOverlay path={fp} /> : null
                  })()}
                  {displayDrops.map((drop) => {
                    const isSpread = (drop.clusterCount ?? 1) > 1
                    const isPrimary = (drop.clusterIndex ?? 0) === 0
                    return (
                      <div key={drop.id} className="absolute -translate-x-1/2 -translate-y-1/2 group" style={{ left: `${drop.displayX * 100}%`, top: `${drop.displayY * 100}%` }}>
                        {drop.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={drop.logoUrl} alt={drop.teamName} className={`rounded border-2 shadow-md object-contain ${isSpread ? isPrimary ? 'w-8 h-8 border-orange-400' : 'w-6 h-6 border-orange-300 opacity-70' : 'w-8 h-8 border-white'}`} />
                        ) : (
                          <div className={`rounded border-2 shadow-md flex items-center justify-center text-white font-bold ${isSpread ? isPrimary ? 'w-8 h-8 border-orange-400 bg-orange-600 text-[10px]' : 'w-6 h-6 border-orange-300 bg-orange-400 opacity-70 text-[9px]' : 'w-8 h-8 border-white bg-gray-600 text-[10px]'}`}>
                            {drop.teamName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap bg-gray-900/90 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          {drop.teamName}{isSpread ? ` (${drop.clusterSize}/${drop.totalMatches}경기)` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-2 shrink-0">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Teams</p>
                    <button onClick={() => { setVisibleTeams(null); setExpandedTeams(new Set()) }} className="text-[11px] text-gray-400 hover:text-gray-600">All</button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
                    {uniqueTeamsForMap.length === 0 ? (
                      <p className="text-xs text-gray-400">낙하 지점 없음</p>
                    ) : uniqueTeamsForMap.map((drop) => {
                      const isSpread = (drop.clusterCount ?? 1) > 1
                      const isActive = isSpread ? expandedTeams.has(drop.teamId) : (visibleTeams === null || visibleTeams.has(drop.teamId))
                      return (
                        <button key={drop.teamId} onClick={() => toggleTeamVisibility(drop.teamId)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors ${isSpread ? isActive ? 'bg-orange-100 text-orange-800 border border-orange-300' : 'bg-orange-50 text-orange-500 border border-orange-200' : isActive ? 'bg-gray-100 text-gray-800' : 'bg-white text-gray-400 border border-gray-200'}`}
                        >
                          {drop.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={drop.logoUrl} alt="" className="w-5 h-5 rounded object-contain shrink-0" />
                          ) : <span className={`w-5 h-5 rounded shrink-0 ${isSpread ? 'bg-orange-300' : 'bg-gray-300'}`} />}
                          <span className="truncate font-medium">{drop.teamName}</span>
                          {isSpread && <span className="ml-auto text-[10px] shrink-0 opacity-70">{drop.clusterCount}곳</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
