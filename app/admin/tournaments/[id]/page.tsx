'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Tournament, Stage, Match, MatchTeamResult, MatchPlayerStat, TournamentStatus, TournamentType, Series } from '@/lib/types'
import ImageUpload from '@/components/admin/ImageUpload'
import SearchModal from '@/components/admin/SearchModal'
import DisplayNameModal from '@/components/admin/DisplayNameModal'
import BulkRosterModal from '@/components/admin/BulkRosterModal'
import PlayerAliasesModal from '@/components/admin/PlayerAliasesModal'
import { getMapDisplayName, stripTagPrefix } from '@/lib/pubg-api'
import { calcPlacementPtsWithRule, ruleFromStage } from '@/lib/scoring'
import type { ScoringRule } from '@/lib/types'
import { CURRENCIES, currencySymbol, fmtNumberInput, parseNumberInput, formatPrize } from '@/lib/currency'
import { revalidatePublic } from '@/lib/revalidate'

const INPUT_CLS = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400'

function navPrize(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
  const delta: Record<string, [number, number]> = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
  }
  const d = delta[e.key]
  if (!d) return
  e.preventDefault()
  const el = document.querySelector<HTMLElement>(`[data-prize-row="${rowIdx + d[0]}"][data-prize-col="${colIdx + d[1]}"]`)
  el?.focus()
}

// Arrow-key cell navigation for any of the secondary tables (stage prizes,
// WWCD rewards, special awards). Each table tags its inputs with a unique
// `table` attribute so arrows don't jump between tables. ArrowLeft/Right
// only steal focus when the caret is at a boundary, so caret movement
// inside multi-character text inputs still works.
function navTable(table: string, e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>, rowIdx: number, colIdx: number) {
  const t = e.currentTarget
  let dx = 0, dy = 0
  if (e.key === 'ArrowUp') dy = -1
  else if (e.key === 'ArrowDown') dy = 1
  else if (e.key === 'ArrowLeft') {
    if (t instanceof HTMLInputElement && t.selectionStart !== 0) return
    dx = -1
  } else if (e.key === 'ArrowRight') {
    if (t instanceof HTMLInputElement && t.selectionStart !== t.value.length) return
    dx = 1
  } else return
  e.preventDefault()
  const el = document.querySelector<HTMLElement>(
    `[data-nav-table="${table}"][data-nav-row="${rowIdx + dy}"][data-nav-col="${colIdx + dx}"]`,
  )
  el?.focus()
}

function numberToInput(stored: number | string | null | undefined): string {
  if (stored == null || stored === '') return ''
  const n = typeof stored === 'number' ? stored : Number(stored)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('en-US')
}

interface MatchFull extends Match {
  match_team_results: (MatchTeamResult & { teams: { id: string; name: string } | null })[]
  match_player_stats: (MatchPlayerStat & { players: { id: string; nickname: string } | null })[]
}

interface StageFull extends Stage {
  matches: MatchFull[]
}

export default function AdminTournamentDetailPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const supabase = createClient()

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [stageList, setStageList] = useState<StageFull[]>([])
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<Tournament>>({})
  const [err, setErr] = useState('')

  const [seriesList, setSeriesList] = useState<Series[]>([])
  const [addingSeries, setAddingSeries] = useState(false)
  const [newSeriesName, setNewSeriesName] = useState('')

  const [addingStage, setAddingStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageType, setNewStageType] = useState('group')
  const [newSeriesId, setNewSeriesId] = useState('')
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editStageForm, setEditStageForm] = useState({ name: '', type: 'group', seriesId: '', scoringRuleId: '' })
  const [scoringRules, setScoringRules] = useState<ScoringRule[]>([])
  const [dragStageId, setDragStageId] = useState<string | null>(null)
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null)
  const [dragSeriesId, setDragSeriesId] = useState<string | null>(null)
  const [dragOverSeriesId, setDragOverSeriesId] = useState<string | null>(null)
  const [dragCombinedId, setDragCombinedId] = useState<string | null>(null)
  const [dragOverCombinedId, setDragOverCombinedId] = useState<string | null>(null)

  // targetKey encoded as '' (none) | 'stage:UUID' | 'series:UUID'
  type PrizeRow = { rank: number; targetKey: string; stageRank: number; prize: string; pgs: string; pgc: string }
  const [prizeRows, setPrizeRows] = useState<PrizeRow[]>([])
  const [selectedPrizeRanks, setSelectedPrizeRanks] = useState<Set<number>>(new Set())
  const [batchTargetKey, setBatchTargetKey] = useState('')
  const [savingPrize, setSavingPrize] = useState(false)
  const [prizeCurrency, setPrizeCurrency] = useState('USD')
  const [prizePoolInput, setPrizePoolInput] = useState('')

  type StagePrizeRow = { placement: number; prize: string; pgs: string; pgc: string }
  // Prize target key format: "stage:<uuid>" or "series:<uuid>"
  const [stagePrizeMap, setStagePrizeMap] = useState<Record<string, StagePrizeRow[]>>({})
  const [selectedStagePrizeId, setSelectedStagePrizeId] = useState('')
  const [savingStagePrize, setSavingStagePrize] = useState(false)

  type SeriesRulesRow = { advance: string; eliminate: string }
  const [seriesRulesMap, setSeriesRulesMap] = useState<Record<string, SeriesRulesRow>>({})
  const [savingSeriesRulesId, setSavingSeriesRulesId] = useState<string | null>(null)

  type CombinedRow = { id: string; name: string; order_num: number; advance_count: number | null; eliminate_count: number | null; stageIds: Set<string> }
  const [combinedList, setCombinedList] = useState<CombinedRow[]>([])
  const [addingCombined, setAddingCombined] = useState(false)
  const [newCombinedName, setNewCombinedName] = useState('')
  const [savingCombinedId, setSavingCombinedId] = useState<string | null>(null)
  const [combinedRulesMap, setCombinedRulesMap] = useState<Record<string, SeriesRulesRow>>({})
  const [savingCombinedRulesId, setSavingCombinedRulesId] = useState<string | null>(null)

  // Unified scoreboard tab order: each entity (series / standalone stage /
  // combined) carries its own tab_order; admin drags this list to reorder.
  type TabOrderEntry =
    | { kind: 'series'; id: string; name: string }
    | { kind: 'stage'; id: string; name: string }
    | { kind: 'combined'; id: string; name: string }
  const [tabOrderList, setTabOrderList] = useState<TabOrderEntry[]>([])
  const [tabOrderDragId, setTabOrderDragId] = useState<string | null>(null)
  const [tabOrderDragOverId, setTabOrderDragOverId] = useState<string | null>(null)
  const [savingTabOrder, setSavingTabOrder] = useState(false)

  type RosterTeam = { team_id: string; name: string; display_name: string | null; short_name: string | null; logo_url: string | null; disqualified: boolean }
  type RosterPlayer = { player_id: string; nickname: string; team_id: string | null; ambiguous: boolean; collisionCount: number }
  const [rosterTeams, setRosterTeams] = useState<RosterTeam[]>([])
  const [rosterPlayers, setRosterPlayers] = useState<RosterPlayer[]>([])
  const [rosterPickerOpen, setRosterPickerOpen] = useState<'team' | { kind: 'player'; teamId: string } | null>(null)
  const [bulkRosterOpen, setBulkRosterOpen] = useState<'team' | { kind: 'player'; teamId: string } | null>(null)
  const [editAliasesPlayer, setEditAliasesPlayer] = useState<{ id: string; nickname: string } | null>(null)
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(new Set())

  // Target encoded as '' (all stages) | 'stage:UUID' | 'series:UUID'
  type WwcdRewardRow = { id: string; targetKey: string; prize: string; pgs: string; pgc: string }
  const [wwcdRows, setWwcdRows] = useState<WwcdRewardRow[]>([])
  const [savingWwcd, setSavingWwcd] = useState(false)
  type SpecialAwardRow = { id: string; category: string; awardName: string; targetType: 'player' | 'team'; playerId: string | null; playerDisplayName: string; teamId: string | null; teamDisplayName: string; prize: string; pgs: string; pgc: string }
  const [specialRows, setSpecialRows] = useState<SpecialAwardRow[]>([])
  const [savingSpecial, setSavingSpecial] = useState(false)
  const [awardPlayerLinkIdx, setAwardPlayerLinkIdx] = useState<{ idx: number; type: 'player' | 'team' } | null>(null)

  // selected match per stage for inline linking UI
  const [selectedMatchByStage, setSelectedMatchByStage] = useState<Record<string, string | null>>({})

  const [linkModal, setLinkModal] = useState<
    | { phase: 1; type: 'team' | 'player'; pubgName: string; matchCount: number }
    | { phase: 2; type: 'team' | 'player'; pubgName: string; matchCount: number; entityId: string; entityName: string }
    | null
  >(null)

  const load = useCallback(async () => {
    // Supabase caps a single SELECT at 1000 rows server-side regardless of
    // .limit(N), so the global collision check needs to page through.
    async function fetchAllPaged<T>(
      table: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildQuery: (q: any) => any,
    ): Promise<T[]> {
      const out: T[] = []
      const PAGE = 1000
      let page = 0
      while (true) {
        const { data } = await buildQuery(supabase.from(table)).range(page * PAGE, (page + 1) * PAGE - 1)
        const batch = (data ?? []) as T[]
        out.push(...batch)
        if (batch.length < PAGE) break
        page++
      }
      return out
    }

    const [{ data: t }, { data: s }, { data: pc }, { data: ser }, { data: sr }, { data: wwcd }, { data: special }, { data: ttData }, { data: tpData }, { data: combinedData }, { data: combinedStageData }, allPlayers, allPlayerAliases] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', id).single(),
      supabase
        .from('stages')
        .select('*, scoring_rules(*), matches(*, match_team_results(*, teams(id, name)), match_player_stats(*, players(id, nickname)))')
        .eq('tournament_id', id)
        .order('order_num'),
      supabase.from('tournament_prize_config').select('rank, prize, pgs_points, pgc_points, stage_id, series_id, combined_scoreboard_id, stage_rank').eq('tournament_id', id).order('rank'),
      supabase.from('series').select('*').eq('tournament_id', id).order('order_num'),
      supabase.from('scoring_rules').select('*').order('created_at'),
      supabase.from('tournament_wwcd_rewards').select('*').eq('tournament_id', id).order('order_num'),
      supabase.from('tournament_special_awards').select('*, teams(id, name)').eq('tournament_id', id).order('order_num'),
      supabase.from('tournament_teams').select('team_id, disqualified, display_name, teams(id, name, short_name, logo_url)').eq('tournament_id', id),
      supabase.from('tournament_players').select('player_id, team_id, players(id, nickname)').eq('tournament_id', id),
      supabase.from('combined_scoreboards').select('id, name, order_num, advance_count, eliminate_count').eq('tournament_id', id).order('order_num'),
      supabase.from('combined_scoreboard_stages').select('combined_scoreboard_id, stage_id'),
      // Global collision map: a registered player whose nickname (or alias) is
      // shared with another player gets flagged so admin can re-pick if needed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAllPaged<any>('players', (q) => q.select('id, nickname').order('id')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetchAllPaged<any>('player_aliases', (q) => q.select('player_id, alias').order('id')),
    ])
    setSeriesList((ser ?? []) as Series[])
    setScoringRules((sr ?? []) as ScoringRule[])
    if (!t) { router.push('/admin/tournaments'); return }
    setTournament(t as Tournament)
    setForm(t as Tournament)

    // Currency lives at the tournament level — single source of truth
    setPrizeCurrency((t?.currency as string) ?? 'USD')
    setPrizePoolInput(numberToInput(t?.prize_pool as number | null))
    const stageData = (s ?? []) as StageFull[]
    setStageList(stageData)

    // Count distinct teams across all stages to determine row count
    const allTeamKeys = new Set<string>()
    for (const stage of stageData) {
      for (const match of stage.matches) {
        for (const r of match.match_team_results) {
          const key = r.team_id ?? `pubg:${r.pubg_team_name ?? ''}`
          allTeamKeys.add(key)
        }
      }
    }
    const totalTeams = Math.max(allTeamKeys.size, 16)

    const prizeConfig = (pc ?? []) as { rank: number; prize: number | null; pgs_points: number | null; pgc_points: number | null; stage_id: string | null; series_id: string | null; combined_scoreboard_id: string | null; stage_rank: number | null }[]
    const prizeByRank = new Map(prizeConfig.map((p) => [p.rank, p]))
    const finalStage = stageData.find((stage) => stage.type === 'grand_final')
    const defaultTargetKey = finalStage ? `stage:${finalStage.id}` : ''

    const rows: PrizeRow[] = []
    for (let rank = 1; rank <= totalTeams; rank++) {
      const existing = prizeByRank.get(rank)
      const targetKey = existing?.combined_scoreboard_id
        ? `combined:${existing.combined_scoreboard_id}`
        : existing?.series_id
        ? `series:${existing.series_id}`
        : existing?.stage_id
        ? `stage:${existing.stage_id}`
        : defaultTargetKey
      rows.push({
        rank,
        targetKey,
        stageRank: existing?.stage_rank ?? rank,
        prize: numberToInput(existing?.prize),
        pgs: existing?.pgs_points?.toString() ?? '',
        pgc: existing?.pgc_points?.toString() ?? '',
      })
    }
    setPrizeRows(rows)

    // Stage / series prize config (sequential query after we have stage / series IDs)
    const stageIds = ((s ?? []) as StageFull[]).map((stage) => stage.id)
    const seriesIds = ((ser ?? []) as Series[]).map((sr) => sr.id)
    const [{ data: spStage }, { data: spSeries }] = await Promise.all([
      stageIds.length > 0
        ? supabase.from('stage_prize_config').select('stage_id, placement, prize, pgs_points, pgc_points').in('stage_id', stageIds).order('placement')
        : Promise.resolve({ data: [] as { stage_id: string; placement: number; prize: number | null; pgs_points: number | null; pgc_points: number | null }[] }),
      seriesIds.length > 0
        ? supabase.from('stage_prize_config').select('series_id, placement, prize, pgs_points, pgc_points').in('series_id', seriesIds).order('placement')
        : Promise.resolve({ data: [] as { series_id: string; placement: number; prize: number | null; pgs_points: number | null; pgc_points: number | null }[] }),
    ])

    const spMap: Record<string, StagePrizeRow[]> = {}
    for (const sr of (ser ?? []) as Series[]) {
      spMap[`series:${sr.id}`] = Array.from({ length: 16 }, (_, i) => ({ placement: i + 1, prize: '', pgs: '', pgc: '' }))
    }
    for (const stage of (s ?? []) as StageFull[]) {
      spMap[`stage:${stage.id}`] = Array.from({ length: 16 }, (_, i) => ({ placement: i + 1, prize: '', pgs: '', pgc: '' }))
    }
    for (const r of (spStage ?? [])) {
      const row = spMap[`stage:${r.stage_id}`]?.find((row) => row.placement === r.placement)
      if (row) {
        row.prize = numberToInput(r.prize)
        row.pgs = r.pgs_points?.toString() ?? ''
        row.pgc = r.pgc_points?.toString() ?? ''
      }
    }
    for (const r of (spSeries ?? [])) {
      const row = spMap[`series:${r.series_id}`]?.find((row) => row.placement === r.placement)
      if (row) {
        row.prize = numberToInput(r.prize)
        row.pgs = r.pgs_points?.toString() ?? ''
        row.pgc = r.pgc_points?.toString() ?? ''
      }
    }
    setStagePrizeMap(spMap)
    if (!selectedStagePrizeId) {
      const firstKey = seriesIds.length > 0 ? `series:${seriesIds[0]}` : (stageIds.length > 0 ? `stage:${stageIds[0]}` : '')
      if (firstKey) setSelectedStagePrizeId(firstKey)
    }

    // Series advancement rules
    const srMap: Record<string, SeriesRulesRow> = {}
    for (const sr of (ser ?? []) as Series[]) {
      srMap[sr.id] = {
        advance: sr.advance_count?.toString() ?? '',
        eliminate: sr.eliminate_count?.toString() ?? '',
      }
    }
    setSeriesRulesMap(srMap)

    // Combined scoreboards: load list + their stage memberships
    const stagesByCombined = new Map<string, Set<string>>()
    for (const r of (combinedStageData ?? []) as { combined_scoreboard_id: string; stage_id: string }[]) {
      if (!stagesByCombined.has(r.combined_scoreboard_id)) stagesByCombined.set(r.combined_scoreboard_id, new Set())
      stagesByCombined.get(r.combined_scoreboard_id)!.add(r.stage_id)
    }
    const combinedListLoaded = ((combinedData ?? []) as { id: string; name: string; order_num: number; tab_order?: number; advance_count?: number | null; eliminate_count?: number | null }[]).map((c) => ({
      id: c.id,
      name: c.name,
      order_num: c.order_num,
      tab_order: c.tab_order ?? 0,
      advance_count: c.advance_count ?? null,
      eliminate_count: c.eliminate_count ?? null,
      stageIds: stagesByCombined.get(c.id) ?? new Set(),
    }))
    setCombinedList(combinedListLoaded)
    const cbRulesMap: Record<string, SeriesRulesRow> = {}
    for (const c of combinedListLoaded) {
      cbRulesMap[c.id] = {
        advance: c.advance_count?.toString() ?? '',
        eliminate: c.eliminate_count?.toString() ?? '',
      }
    }
    setCombinedRulesMap(cbRulesMap)

    // Build unified tab order list: series, standalone stages, combined —
    // each by their own tab_order. Newly created entities (tab_order = 0)
    // sort to the top until admin reorders them.
    const orderEntries: { entry: TabOrderEntry; key: number }[] = []
    for (const sr of (ser ?? []) as Series[]) {
      orderEntries.push({ entry: { kind: 'series', id: sr.id, name: sr.name }, key: (sr as Series & { tab_order?: number }).tab_order ?? 0 })
    }
    for (const stage of stageData) {
      if (stage.series_id) continue
      orderEntries.push({ entry: { kind: 'stage', id: stage.id, name: stage.name }, key: (stage as StageFull & { tab_order?: number }).tab_order ?? 0 })
    }
    for (const c of combinedListLoaded) {
      orderEntries.push({ entry: { kind: 'combined', id: c.id, name: c.name }, key: c.tab_order })
    }
    orderEntries.sort((a, b) => a.key - b.key)
    setTabOrderList(orderEntries.map((e) => e.entry))

    setWwcdRows((wwcd ?? []).map((r) => {
      const sid = (r.stage_id as string | null) ?? null
      const srid = (r.series_id as string | null) ?? null
      const targetKey = srid ? `series:${srid}` : sid ? `stage:${sid}` : ''
      return {
        id: r.id as string,
        targetKey,
        prize: numberToInput(r.prize as number | null),
        pgs: r.pgs_points?.toString() ?? '',
        pgc: r.pgc_points?.toString() ?? '',
      }
    }))

    setSpecialRows((special ?? []).map((r) => {
      const teamId = (r.team_id as string | null) ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const teamObj = (r as any).teams as { id: string; name: string } | null | undefined
      return {
        id: r.id as string,
        category: (r.category as string | null) ?? '',
        awardName: r.award_name as string,
        // Existing rows with a team_id default to "team" target; otherwise "player".
        targetType: (teamId ? 'team' : 'player') as 'player' | 'team',
        playerId: (r.player_id as string | null) ?? null,
        playerDisplayName: (r.player_display_name as string) ?? '',
        teamId,
        teamDisplayName: (r.team_display_name as string) ?? teamObj?.name ?? '',
        prize: numberToInput(r.prize as number | null),
        pgs: r.pgs_points?.toString() ?? '',
        pgc: r.pgc_points?.toString() ?? '',
      }
    }))

    // Tournament roster
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRosterTeams(((ttData ?? []) as any[])
      .map((r) => ({
        team_id: r.team_id as string,
        name: r.teams?.name ?? '?',
        display_name: (r.display_name as string | null) ?? null,
        short_name: (r.teams?.short_name as string | null) ?? null,
        logo_url: (r.teams?.logo_url as string | null) ?? null,
        disqualified: !!r.disqualified,
      }))
      .sort((a, b) => (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)))

    // Build name → distinct player_ids map across all players + aliases
    const nameToPlayerIds = new Map<string, Set<string>>()
    const addName = (name: string | null | undefined, playerId: string) => {
      if (!name) return
      const k = name.trim().toLowerCase()
      if (!k) return
      if (!nameToPlayerIds.has(k)) nameToPlayerIds.set(k, new Set())
      nameToPlayerIds.get(k)!.add(playerId)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of allPlayers as any[]) addName(p.nickname as string, p.id as string)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of allPlayerAliases as any[]) addName(a.alias as string, a.player_id as string)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setRosterPlayers(((tpData ?? []) as any[])
      .map((r) => {
        const nickname = r.players?.nickname ?? '?'
        const candidates = nameToPlayerIds.get(nickname.toLowerCase()) ?? new Set<string>()
        return {
          player_id: r.player_id as string,
          nickname,
          team_id: (r.team_id as string | null) ?? null,
          ambiguous: candidates.size > 1,
          collisionCount: candidates.size,
        }
      })
      .sort((a, b) => a.nickname.localeCompare(b.nickname)))
  }, [id, supabase, router])

  useEffect(() => { load() }, [load])

  // Re-fetch admin data and invalidate the public-page cache so the change
  // shows up immediately. Awaits both so the next request to the public site
  // (e.g. user switching tabs) reads the fresh value.
  const reload = useCallback(async () => {
    await Promise.all([revalidatePublic({ tournamentId: id }), load()])
  }, [id, load])

  async function saveTournament() {
    if (!form.name?.trim()) return
    setSaving(true)
    setErr('')
    const { error } = await supabase.from('tournaments').update({
      name: form.name,
      short_name: form.short_name || null,
      tag: form.tag || null,
      type: form.type,
      region: form.region || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      prize_pool: parseNumberInput(prizePoolInput),
      currency: prizeCurrency,
      status: form.status,
      description: form.description || null,
      banner_url: form.banner_url ?? null,
      has_prize: form.has_prize ?? false,
      has_pgs_points: form.has_pgs_points ?? false,
      has_pgc_points: form.has_pgc_points ?? false,
    }).eq('id', id)
    setSaving(false)
    if (error) { setErr('Save failed: ' + error.message); return }
    setEditMode(false)
    reload()
  }

  async function deleteTournament() {
    if (!confirm('Delete this tournament? All related data will be removed.')) return
    await supabase.from('tournaments').delete().eq('id', id)
    router.push('/admin/tournaments')
  }

  async function addStage() {
    if (!newStageName.trim()) return
    setErr('')
    const maxOrder = stageList.length > 0 ? Math.max(...stageList.map((s) => s.order_num)) + 1 : 0
    const { error } = await supabase.from('stages').insert([{
      tournament_id: id,
      name: newStageName.trim(),
      type: newStageType,
      order_num: maxOrder,
      series_id: newSeriesId || null,
    }])
    if (error) { setErr('Failed to add stage: ' + error.message); return }
    setAddingStage(false)
    setNewStageName('')
    setNewSeriesId('')
    await reload()
  }

  async function saveStage(stageId: string) {
    if (!editStageForm.name.trim()) return
    const { error } = await supabase.from('stages').update({
      name: editStageForm.name.trim(),
      type: editStageForm.type,
      series_id: editStageForm.seriesId || null,
      scoring_rule_id: editStageForm.scoringRuleId || null,
    }).eq('id', stageId)
    if (error) { setErr('Failed to update stage: ' + error.message); return }
    setEditingStageId(null)
    reload()
  }

  async function deleteStage(stageId: string) {
    if (!confirm('Delete this stage and all its matches?')) return
    await supabase.from('stages').delete().eq('id', stageId)
    setSelectedMatchByStage((prev) => { const n = { ...prev }; delete n[stageId]; return n })
    reload()
  }

  async function toggleStageInTotal(stageId: string, current: boolean) {
    await supabase.from('stages').update({ include_in_total: !current }).eq('id', stageId)
    await revalidatePublic()
    reload()
  }

  async function reorderStages(fromId: string, toId: string) {
    if (fromId === toId) return
    const sorted = [...stageList].sort((a, b) => a.order_num - b.order_num)
    const fromIdx = sorted.findIndex(s => s.id === fromId)
    const toIdx = sorted.findIndex(s => s.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    await Promise.all(reordered.map((s, i) =>
      supabase.from('stages').update({ order_num: i + 1 }).eq('id', s.id)
    ))
    reload()
  }

  async function reorderCombined(fromId: string, toId: string) {
    if (fromId === toId) return
    const sorted = [...combinedList].sort((a, b) => a.order_num - b.order_num)
    const fromIdx = sorted.findIndex(c => c.id === fromId)
    const toIdx = sorted.findIndex(c => c.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    // Visual-only reorder for the Combined Scoreboards list. Public scoreboard
    // tab order is controlled separately via the Scoreboard Tab Order section.
    await Promise.all(reordered.map((c, i) =>
      supabase.from('combined_scoreboards').update({ order_num: i + 1 }).eq('id', c.id)
    ))
    reload()
  }

  async function reorderSeries(fromId: string, toId: string) {
    if (fromId === toId) return
    const sorted = [...seriesList].sort((a, b) => a.order_num - b.order_num)
    const fromIdx = sorted.findIndex(s => s.id === fromId)
    const toIdx = sorted.findIndex(s => s.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    // Visual-only reorder for the Series chip list. Public scoreboard tab order
    // is controlled separately via the Scoreboard Tab Order section, which writes
    // tab_order across series / stages / combined.
    await Promise.all(reordered.map((s, i) =>
      supabase.from('series').update({ order_num: i + 1 }).eq('id', s.id)
    ))
    reload()
  }

  async function addSeries() {
    if (!newSeriesName.trim()) return
    const maxOrder = seriesList.length > 0 ? Math.max(...seriesList.map((s) => s.order_num)) + 1 : 0
    const { error } = await supabase.from('series').insert([{
      tournament_id: id,
      name: newSeriesName.trim(),
      order_num: maxOrder,
    }])
    if (error) { setErr('Failed to add series: ' + error.message); return }
    setAddingSeries(false)
    setNewSeriesName('')
    reload()
  }

  async function deleteSeries(seriesId: string, seriesName: string) {
    if (!confirm(`Delete series "${seriesName}"? Stages in this series will become standalone.`)) return
    await supabase.from('series').delete().eq('id', seriesId)
    reload()
  }

  async function savePrizeConfig() {
    setSavingPrize(true)
    setErr('')

    const { error: flagErr } = await supabase.from('tournaments').update({
      has_prize: form.has_prize ?? false,
      has_pgs_points: form.has_pgs_points ?? false,
      has_pgc_points: form.has_pgc_points ?? false,
      ranking_method: form.ranking_method ?? 'stage',
      currency: prizeCurrency,
    }).eq('id', id)
    if (flagErr) { setErr('Save failed: ' + flagErr.message); setSavingPrize(false); return }

    const rows = prizeRows
      .filter((r) => r.targetKey || r.prize || r.pgs || r.pgc)
      .map((r) => {
        const [targetType, targetId] = r.targetKey.split(':')
        return {
          tournament_id: id,
          rank: r.rank,
          stage_id: targetType === 'stage' ? targetId : null,
          series_id: targetType === 'series' ? targetId : null,
          combined_scoreboard_id: targetType === 'combined' ? targetId : null,
          stage_rank: r.stageRank || null,
          prize: parseNumberInput(r.prize),
          pgs_points: r.pgs ? parseFloat(r.pgs) : null,
          pgc_points: r.pgc ? parseFloat(r.pgc) : null,
        }
      })

    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('tournament_prize_config')
        .upsert(rows, { onConflict: 'tournament_id,rank' })
      if (upsertErr) { setErr('Save failed: ' + upsertErr.message); setSavingPrize(false); return }

      const savedRanks = rows.map((r) => r.rank)
      await supabase
        .from('tournament_prize_config')
        .delete()
        .eq('tournament_id', id)
        .not('rank', 'in', `(${savedRanks.join(',')})`)
    } else {
      await supabase.from('tournament_prize_config').delete().eq('tournament_id', id)
    }

    setSavingPrize(false)
    reload()
  }

  async function saveStagePrizes() {
    if (!selectedStagePrizeId) return
    setSavingStagePrize(true)
    setErr('')
    const [targetType, targetId] = selectedStagePrizeId.split(':')
    const targetCol = targetType === 'series' ? 'series_id' : 'stage_id'
    const rows = (stagePrizeMap[selectedStagePrizeId] ?? [])
      .filter((r) => r.prize || r.pgs || r.pgc)
      .map((r) => ({
        [targetCol]: targetId,
        placement: r.placement,
        prize: parseNumberInput(r.prize),
        pgs_points: r.pgs ? parseFloat(r.pgs) : null,
        pgc_points: r.pgc ? parseFloat(r.pgc) : null,
      }))
    const { error: delErr1 } = await supabase.from('stage_prize_config').delete().eq(targetCol, targetId)
    if (delErr1) { setErr('Save failed: ' + delErr1.message); setSavingStagePrize(false); return }
    if (rows.length > 0) {
      const { error } = await supabase.from('stage_prize_config').insert(rows)
      if (error) { setErr('Save failed: ' + error.message); setSavingStagePrize(false); return }
    }
    setSavingStagePrize(false)
    reload()
  }

  async function saveTabOrder(newList: TabOrderEntry[]) {
    setSavingTabOrder(true)
    setErr('')
    const seriesUpdates: { id: string; tab_order: number }[] = []
    const stageUpdates: { id: string; tab_order: number }[] = []
    const combinedUpdates: { id: string; tab_order: number }[] = []
    newList.forEach((entry, i) => {
      const next = i + 1
      if (entry.kind === 'series') seriesUpdates.push({ id: entry.id, tab_order: next })
      else if (entry.kind === 'stage') stageUpdates.push({ id: entry.id, tab_order: next })
      else combinedUpdates.push({ id: entry.id, tab_order: next })
    })
    const errs = await Promise.all([
      ...seriesUpdates.map((u) => supabase.from('series').update({ tab_order: u.tab_order }).eq('id', u.id)),
      ...stageUpdates.map((u) => supabase.from('stages').update({ tab_order: u.tab_order }).eq('id', u.id)),
      ...combinedUpdates.map((u) => supabase.from('combined_scoreboards').update({ tab_order: u.tab_order }).eq('id', u.id)),
    ])
    setSavingTabOrder(false)
    const firstErr = errs.find((r) => r.error)?.error as { message?: string; code?: string } | undefined
    if (firstErr) {
      const msg = firstErr.message ?? 'unknown error'
      const code = firstErr.code ?? ''
      const missingCol =
        code === 'PGRST204' || code === '42703' ||
        /tab_order/i.test(msg) && /(does not exist|could not find|column)/i.test(msg)
      const display = missingCol
        ? 'Save tab order failed: tab_order column is missing. Run the latest supabase/migration.sql in the Supabase SQL editor, then refresh.'
        : `Save tab order failed: ${msg}`
      console.error('saveTabOrder failed:', firstErr)
      setErr(display)
      alert(display)
      // Refetch so the UI reflects actual DB state instead of the failed optimistic move.
      reload()
      return
    }
    // Success: trust the optimistic update — skipping reload() avoids any race
    // where a stale read snaps the list back to its previous order.
  }

  async function addCombinedScoreboard() {
    const name = newCombinedName.trim()
    if (!name) return
    setErr('')
    const maxOrder = combinedList.length > 0 ? Math.max(...combinedList.map((c) => c.order_num)) + 1 : 0
    const { error } = await supabase.from('combined_scoreboards').insert([{ tournament_id: id, name, order_num: maxOrder }])
    if (error) { setErr('Add combined scoreboard failed: ' + error.message); return }
    setNewCombinedName('')
    setAddingCombined(false)
    reload()
  }

  async function deleteCombinedScoreboard(combinedId: string, name: string) {
    if (!confirm(`Delete combined scoreboard "${name}"?`)) return
    const { error } = await supabase.from('combined_scoreboards').delete().eq('id', combinedId)
    if (error) { setErr('Delete failed: ' + error.message); return }
    reload()
  }

  async function saveCombinedScoreboard(combinedId: string, name: string, stageIds: Set<string>) {
    setSavingCombinedId(combinedId)
    setErr('')
    const { error: updateErr } = await supabase.from('combined_scoreboards').update({ name }).eq('id', combinedId)
    if (updateErr) { setErr('Save failed: ' + updateErr.message); setSavingCombinedId(null); return }
    // Replace stages: delete all then insert chosen
    const { error: delErr } = await supabase.from('combined_scoreboard_stages').delete().eq('combined_scoreboard_id', combinedId)
    if (delErr) { setErr('Save failed: ' + delErr.message); setSavingCombinedId(null); return }
    const rows = [...stageIds].map((sid) => ({ combined_scoreboard_id: combinedId, stage_id: sid }))
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('combined_scoreboard_stages').insert(rows)
      if (insErr) { setErr('Save failed: ' + insErr.message); setSavingCombinedId(null); return }
    }
    setSavingCombinedId(null)
    reload()
  }

  async function saveSeriesAdvancement(seriesId: string) {
    const rules = seriesRulesMap[seriesId]
    if (!rules) return
    setSavingSeriesRulesId(seriesId)
    setErr('')
    const adv = parseInt(rules.advance, 10)
    const elim = parseInt(rules.eliminate, 10)
    const { error } = await supabase.from('series').update({
      advance_count: Number.isFinite(adv) && adv > 0 ? adv : null,
      eliminate_count: Number.isFinite(elim) && elim > 0 ? elim : null,
    }).eq('id', seriesId)
    setSavingSeriesRulesId(null)
    if (error) { setErr('Save failed: ' + error.message); return }
    reload()
  }

  async function saveCombinedAdvancement(combinedId: string) {
    const rules = combinedRulesMap[combinedId]
    if (!rules) return
    setSavingCombinedRulesId(combinedId)
    setErr('')
    const adv = parseInt(rules.advance, 10)
    const elim = parseInt(rules.eliminate, 10)
    const { error } = await supabase.from('combined_scoreboards').update({
      advance_count: Number.isFinite(adv) && adv > 0 ? adv : null,
      eliminate_count: Number.isFinite(elim) && elim > 0 ? elim : null,
    }).eq('id', combinedId)
    setSavingCombinedRulesId(null)
    if (error) { setErr('Save failed: ' + error.message); return }
    reload()
  }

  async function addRosterTeam(teamId: string) {
    setErr('')
    const { error } = await supabase.from('tournament_teams').upsert(
      [{ tournament_id: id, team_id: teamId }],
      { onConflict: 'tournament_id,team_id', ignoreDuplicates: true },
    )
    if (error) { setErr('Add team failed: ' + error.message); return }
    // Auto-add the team's currently rostered active players too — admin can remove
    // any stand-in or alumni manually afterwards. Pin team_id so a later transfer
    // on the player's global record doesn't move them out of this tournament's team.
    const { data: teamPlayers } = await supabase
      .from('players')
      .select('id')
      .eq('team_id', teamId)
      .eq('is_active', true)
    const rows = (teamPlayers ?? []).map((p) => ({ tournament_id: id, player_id: p.id as string, team_id: teamId }))
    if (rows.length > 0) {
      await supabase.from('tournament_players').upsert(rows, {
        onConflict: 'tournament_id,player_id', ignoreDuplicates: true,
      })
    }
    reload()
  }

  async function removeRosterTeam(teamId: string) {
    setErr('')
    const { error } = await supabase.from('tournament_teams').delete()
      .eq('tournament_id', id).eq('team_id', teamId)
    if (error) { setErr('Remove team failed: ' + error.message); return }
    reload()
  }

  async function toggleRosterTeamDQ(teamId: string, current: boolean) {
    setErr('')
    const { error } = await supabase.from('tournament_teams')
      .update({ disqualified: !current })
      .eq('tournament_id', id).eq('team_id', teamId)
    if (error) { setErr('Toggle DQ failed: ' + error.message); return }
    reload()
  }

  async function addRosterPlayer(playerId: string, teamId: string) {
    setErr('')
    // Player is always pinned to a specific team in this tournament — admin
    // selects the team first, then registers players under it. Re-adding an
    // existing player updates their team if the row already exists.
    const { error } = await supabase.from('tournament_players')
      .upsert(
        [{ tournament_id: id, player_id: playerId, team_id: teamId }],
        { onConflict: 'tournament_id,player_id' },
      )
    if (error) { setErr('Add player failed: ' + error.message); return }
    reload()
  }

  async function removeRosterPlayer(playerId: string) {
    setErr('')
    const { error } = await supabase.from('tournament_players').delete()
      .eq('tournament_id', id).eq('player_id', playerId)
    if (error) { setErr('Remove player failed: ' + error.message); return }
    reload()
  }

  async function saveWwcdRewards() {
    setSavingWwcd(true)
    setErr('')
    const rows = wwcdRows
      .filter((r) => r.targetKey || r.prize || r.pgs || r.pgc)
      .map((r, i) => {
        const [targetType, targetId] = r.targetKey.split(':')
        return {
          tournament_id: id,
          stage_id: targetType === 'stage' ? targetId : null,
          series_id: targetType === 'series' ? targetId : null,
          prize: parseNumberInput(r.prize),
          pgs_points: r.pgs ? parseFloat(r.pgs) : null,
          pgc_points: r.pgc ? parseFloat(r.pgc) : null,
          order_num: i,
        }
      })
    const { error: delErr2 } = await supabase.from('tournament_wwcd_rewards').delete().eq('tournament_id', id)
    if (delErr2) { setErr('Save failed: ' + delErr2.message); setSavingWwcd(false); return }
    if (rows.length > 0) {
      const { error } = await supabase.from('tournament_wwcd_rewards').insert(rows)
      if (error) { setErr('Save failed: ' + error.message); setSavingWwcd(false); return }
    }
    setSavingWwcd(false)
    reload()
  }

  async function saveSpecialAwards() {
    setSavingSpecial(true)
    setErr('')
    const rows = specialRows
      .filter((r) => r.awardName.trim())
      .map((r, i) => ({
        tournament_id: id,
        category: r.category.trim() || null,
        award_name: r.awardName.trim(),
        // Only persist the chosen target — clear the other side so re-loading
        // recovers the correct targetType.
        player_id: r.targetType === 'player' ? (r.playerId || null) : null,
        player_display_name: r.targetType === 'player' ? (r.playerDisplayName || null) : null,
        team_id: r.targetType === 'team' ? (r.teamId || null) : null,
        team_display_name: r.targetType === 'team' ? (r.teamDisplayName || null) : null,
        prize: parseNumberInput(r.prize),
        pgs_points: r.pgs ? parseFloat(r.pgs) : null,
        pgc_points: r.pgc ? parseFloat(r.pgc) : null,
        order_num: i,
      }))
    const { error: delErr3 } = await supabase.from('tournament_special_awards').delete().eq('tournament_id', id)
    if (delErr3) { setErr('Save failed: ' + delErr3.message); setSavingSpecial(false); return }
    if (rows.length > 0) {
      const { error } = await supabase.from('tournament_special_awards').insert(rows)
      if (error) { setErr('Save failed: ' + error.message); setSavingSpecial(false); return }
    }
    setSavingSpecial(false)
    reload()
  }

  async function linkTeam(pubgTeamName: string, teamId: string, displayName: string | null, entityName: string) {
    const allMatches = stageList.flatMap((s) => s.matches)
    const allMatchIds = allMatches.map((m) => m.id)

    const affectedRows = allMatches.flatMap((m) =>
      m.match_team_results
        .filter((r) => r.pubg_team_name === pubgTeamName)
        .map((r) => ({ matchId: m.id, placement: r.placement }))
    )

    // Update team_id first (always works even without display_name migration)
    await supabase
      .from('match_team_results')
      .update({ team_id: teamId })
      .in('match_id', allMatchIds)
      .eq('pubg_team_name', pubgTeamName)

    // Update display_name separately (requires ALTER TABLE migration to be run)
    if (displayName !== null) {
      await supabase
        .from('match_team_results')
        .update({ display_name: displayName })
        .in('match_id', allMatchIds)
        .eq('pubg_team_name', pubgTeamName)
    }

    for (const { matchId, placement } of affectedRows) {
      if (placement != null) {
        await supabase
          .from('match_player_stats')
          .update({ team_id: teamId })
          .eq('match_id', matchId)
          .eq('placement', placement)
          .is('team_id', null)
      }
    }

    // Store as "TAG - Full Name" combined alias
    const nameForAlias = displayName ?? entityName
    const combinedAlias = `${pubgTeamName} - ${nameForAlias}`
    await supabase.from('team_aliases').upsert(
      [{ team_id: teamId, alias: combinedAlias }],
      { onConflict: 'alias', ignoreDuplicates: true }
    )
    setLinkModal(null)
    reload()
  }

  async function linkPlayer(pubgPlayerName: string, playerId: string, displayName: string | null, entityName: string) {
    const allMatchIds = stageList.flatMap((s) => s.matches.map((m) => m.id))

    // Update player_id first
    await supabase
      .from('match_player_stats')
      .update({ player_id: playerId })
      .in('match_id', allMatchIds)
      .eq('pubg_player_name', pubgPlayerName)

    // Update display_name separately
    if (displayName !== null) {
      await supabase
        .from('match_player_stats')
        .update({ display_name: displayName })
        .in('match_id', allMatchIds)
        .eq('pubg_player_name', pubgPlayerName)
    }

    const aliasesToUpsert = [entityName, ...(displayName && displayName !== entityName ? [displayName] : [])]
    for (const alias of aliasesToUpsert) {
      await supabase.from('player_aliases').upsert(
        [{ player_id: playerId, alias }],
        { onConflict: 'player_id,alias', ignoreDuplicates: true }
      )
    }
    // Re-pin the player's global team to whichever match they most recently played in
    await supabase.rpc('sync_player_current_teams', { player_ids: [playerId] })
    setLinkModal(null)
    reload()
  }

  function toggleMatchTab(stageId: string, matchId: string) {
    setSelectedMatchByStage((prev) => ({
      ...prev,
      [stageId]: prev[stageId] === matchId ? null : matchId,
    }))
  }

  if (!tournament) return <div className="p-8 text-gray-400">Loading...</div>

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Link href="/admin/tournaments" className="hover:text-gray-600">Tournaments</Link>
          <span>/</span>
          <span className="text-gray-700">{tournament.name}</span>
        </div>
        <Link
          href={`/admin/tournaments/${id}/drop-locations`}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          낙하 지점 관리
        </Link>
      </div>

      {err && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center justify-between">
          {err}
          <button onClick={() => setErr('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
        </div>
      )}

      {/* Tournament info card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">{tournament.name}</h1>
          <div className="flex gap-2">
            {!editMode ? (
              <>
                <button onClick={() => setEditMode(true)}
                  className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  Edit
                </button>
                <button onClick={deleteTournament}
                  className="text-sm px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 text-red-600">
                  Delete
                </button>
              </>
            ) : (
              <>
                <button onClick={saveTournament} disabled={saving}
                  className="text-sm px-3 py-1.5 bg-yellow-400 hover:bg-yellow-300 rounded-lg text-gray-900 font-medium">
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => { setEditMode(false); setForm(tournament) }}
                  className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700">
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        {editMode ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Tournament Name</label>
              <input value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Short Name</label>
              <input value={form.short_name ?? ''} onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))} placeholder="PUBG Global Series 25" className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Tag</label>
              <input value={form.tag ?? ''} onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))} placeholder="PGS25" className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Status</label>
              <select value={form.status ?? 'upcoming'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as TournamentStatus }))} className={INPUT_CLS}>
                <option value="upcoming">Upcoming</option>
                <option value="ongoing">Ongoing</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Format</label>
              <select value={form.type ?? 'online'} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TournamentType }))} className={INPUT_CLS}>
                <option value="online">Online</option>
                <option value="lan">LAN</option>
                <option value="regional">Regional</option>
                <option value="global">Global</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Region</label>
              <input value={form.region ?? ''} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Start Date</label>
              <input type="date" value={form.start_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">End Date</label>
              <input type="date" value={form.end_date ?? ''} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} className={INPUT_CLS} />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Prize Pool</label>
              <div className="flex gap-2">
                <select
                  value={prizeCurrency}
                  onChange={(e) => setPrizeCurrency(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 shrink-0"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>
                  ))}
                </select>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">
                    {currencySymbol(prizeCurrency)}
                  </span>
                  <input
                    value={prizePoolInput}
                    onChange={(e) => setPrizePoolInput(fmtNumberInput(e.target.value))}
                    placeholder="0"
                    className={INPUT_CLS + ' pl-7'}
                  />
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 block mb-1">Description</label>
              <textarea value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} className={INPUT_CLS} />
            </div>
            <div className="col-span-2">
              <ImageUpload
                currentUrl={form.banner_url ?? null}
                storagePath={`tournaments/${id}/banner`}
                onUpdate={(url) => setForm((f) => ({ ...f, banner_url: url ?? undefined }))}
                shape="wide"
                size="lg"
                label="Tournament Logo / Banner"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {tournament.banner_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tournament.banner_url} alt="banner" className="rounded-lg max-h-40 object-contain border border-gray-100" />
            )}
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[
                ['Status', tournament.status === 'upcoming' ? 'Upcoming' : tournament.status === 'ongoing' ? 'Ongoing' : 'Completed'],
                ['Format', tournament.type],
                ['Region', tournament.region ?? '-'],
                ['Prize Pool', formatPrize(tournament.prize_pool, tournament.currency)],
                ['Period', `${tournament.start_date ?? '?'} ~ ${tournament.end_date ?? '?'}`],
                ['Short Name', tournament.short_name ?? '-'],
                ['Tag', tournament.tag ?? '-'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-gray-400 w-20 shrink-0">{k}</span>
                  <span className="text-gray-800">{v}</span>
                </div>
              ))}
              {tournament.description && (
                <div className="col-span-2 flex gap-2">
                  <span className="text-gray-400 w-20 shrink-0">Description</span>
                  <span className="text-gray-600">{tournament.description}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Participants — register teams first, then add players under each team */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Participants</h2>
          <span className="text-xs text-gray-400">
            Register teams, then expand each team to add its players. Match import only auto-links to entries here.
          </span>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm font-semibold text-gray-700">Teams</span>
            <span className="text-xs text-gray-400">{rosterTeams.length}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setBulkRosterOpen('team')}
                className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 rounded-lg px-2.5 py-1"
              >
                ⊞ Bulk Add Teams
              </button>
              <button
                onClick={() => setRosterPickerOpen('team')}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1"
              >
                + Add Team
              </button>
            </div>
          </div>

          {rosterTeams.length === 0 ? (
            <p className="text-sm text-gray-400">No teams registered yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {rosterTeams.map((rt) => {
                const teamPlayers = rosterPlayers.filter((rp) => rp.team_id === rt.team_id)
                const isExpanded = expandedTeamIds.has(rt.team_id)
                const teamHasWarning = teamPlayers.some((p) => p.ambiguous)
                return (
                  <div
                    key={rt.team_id}
                    className={`border rounded-lg overflow-hidden text-xs ${
                      rt.disqualified ? 'border-red-300 bg-red-50/40' : 'border-gray-200'
                    } ${isExpanded ? 'col-span-2 md:col-span-3 xl:col-span-4' : ''}`}
                  >
                    <button
                      onClick={() => setExpandedTeamIds((s) => {
                        const n = new Set(s)
                        if (n.has(rt.team_id)) n.delete(rt.team_id); else n.add(rt.team_id)
                        return n
                      })}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-gray-50 transition-colors ${rt.disqualified ? '' : 'bg-gray-50/60'}`}
                    >
                      <span className="text-gray-400 text-[10px] w-2 shrink-0">{isExpanded ? '▼' : '▶'}</span>
                      {rt.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={rt.logo_url} alt="" className={`w-4 h-4 rounded object-contain border border-gray-100 shrink-0 ${rt.disqualified ? 'opacity-50' : ''}`} />
                      ) : (
                        <span className="w-4 h-4 rounded-full bg-gray-200 shrink-0" />
                      )}
                      <span
                        className={`font-medium truncate ${rt.disqualified ? 'text-gray-400 line-through' : 'text-gray-800'}`}
                        title={rt.display_name && rt.display_name !== rt.name ? `Tournament label: ${rt.display_name}\nGlobal team name: ${rt.name}` : undefined}
                      >
                        {rt.display_name ?? rt.name}
                      </span>
                      <span className="text-gray-400 ml-auto shrink-0">{teamPlayers.length}</span>
                      {teamHasWarning && <span className="text-amber-600 text-[10px] font-bold shrink-0">⚠</span>}
                    </button>

                    {isExpanded && (
                      <div className="px-3 py-2 bg-white border-t border-gray-100">
                        <div className="flex items-center gap-2 mb-2">
                          {rt.short_name && <span className="text-[10px] font-mono text-gray-400">{rt.short_name}</span>}
                          <div className="ml-auto flex items-center gap-1.5">
                            <button
                              onClick={() => toggleRosterTeamDQ(rt.team_id, rt.disqualified)}
                              title={rt.disqualified ? 'Remove disqualification' : 'Mark as disqualified'}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none transition-colors ${
                                rt.disqualified
                                  ? 'bg-red-500 text-white hover:bg-red-600'
                                  : 'border border-gray-300 text-gray-400 hover:text-red-500 hover:border-red-300'
                              }`}
                            >
                              DQ
                            </button>
                            <button
                              onClick={() => removeRosterTeam(rt.team_id)}
                              className="text-gray-300 hover:text-red-500 text-sm leading-none"
                              title="Remove team from tournament"
                            >
                              ×
                            </button>
                          </div>
                        </div>

                        {teamPlayers.length === 0 ? (
                          <p className="text-[11px] text-gray-400 mb-2">No players registered for this team yet.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {teamPlayers.map((rp) => (
                              <div
                                key={rp.player_id}
                                className={`flex items-center gap-1 border rounded px-1.5 py-0.5 ${rp.ambiguous ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}
                                title={rp.ambiguous ? `Nickname "${rp.nickname}" matches ${rp.collisionCount} players in the database — verify this is the right one` : undefined}
                              >
                                {rp.ambiguous && <span className="text-[9px] text-amber-700 font-bold">⚠</span>}
                                <span className="text-[11px] text-gray-700">{rp.nickname}</span>
                                <button
                                  onClick={() => setEditAliasesPlayer({ id: rp.player_id, nickname: rp.nickname })}
                                  title="Edit aliases (PUBG in-game name etc.)"
                                  className="text-gray-300 hover:text-blue-500 text-[10px] leading-none"
                                >
                                  ✎
                                </button>
                                <button
                                  onClick={() => removeRosterPlayer(rp.player_id)}
                                  className="text-gray-300 hover:text-red-500 text-[11px] leading-none"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setBulkRosterOpen({ kind: 'player', teamId: rt.team_id })}
                            className="text-[11px] bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100 rounded px-2 py-0.5"
                          >
                            ⊞ Bulk Add
                          </button>
                          <button
                            onClick={() => setRosterPickerOpen({ kind: 'player', teamId: rt.team_id })}
                            className="text-[11px] text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-0.5"
                          >
                            + Add Player
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Orphan players: registered but no team_id (or team not in roster anymore). Surface so admin can clean up. */}
          {(() => {
            const teamIdSet = new Set(rosterTeams.map((rt) => rt.team_id))
            const orphans = rosterPlayers.filter((rp) => !rp.team_id || !teamIdSet.has(rp.team_id))
            if (orphans.length === 0) return null
            return (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-amber-700 mb-2">⚠ Unassigned ({orphans.length}) — players whose tournament team is missing</p>
                <div className="flex flex-wrap gap-1.5">
                  {orphans.map((rp) => (
                    <div key={rp.player_id} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5">
                      <span className="text-xs text-gray-700">{rp.nickname}</span>
                      <button
                        onClick={() => setEditAliasesPlayer({ id: rp.player_id, nickname: rp.nickname })}
                        className="text-gray-300 hover:text-blue-500 text-[11px] leading-none ml-0.5"
                      >✎</button>
                      <button
                        onClick={() => removeRosterPlayer(rp.player_id)}
                        className="text-gray-300 hover:text-red-500 text-xs leading-none ml-0.5"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Scoreboard Tab Order — compact unified drag list for the public scoreboard */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-lg font-semibold text-gray-800">Scoreboard Tab Order</h2>
          <span className="text-xs text-gray-400">Drag to set the order of top-level tabs (series / stages / combined) on the public scoreboard.</span>
        </div>
        {tabOrderList.length === 0 ? (
          <p className="text-sm text-gray-400">Add a series, stage, or combined scoreboard first.</p>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 p-2">
            <div className="flex flex-col gap-0.5">
              {tabOrderList.map((entry) => {
                const key = `${entry.kind}:${entry.id}`
                const isDragOver = tabOrderDragOverId === key && tabOrderDragId !== key
                const badgeStyle =
                  entry.kind === 'series' ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : entry.kind === 'combined' ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                  : 'bg-gray-50 text-gray-600 border-gray-200'
                const label =
                  entry.kind === 'series' ? 'Series'
                  : entry.kind === 'combined' ? 'Combined'
                  : 'Stage'
                return (
                  <div
                    key={key}
                    draggable={!savingTabOrder}
                    onDragStart={() => setTabOrderDragId(key)}
                    onDragOver={(e) => { e.preventDefault(); setTabOrderDragOverId(key) }}
                    onDrop={() => {
                      if (tabOrderDragId && tabOrderDragId !== key) {
                        const fromIdx = tabOrderList.findIndex((it) => `${it.kind}:${it.id}` === tabOrderDragId)
                        const toIdx = tabOrderList.findIndex((it) => `${it.kind}:${it.id}` === key)
                        if (fromIdx !== -1 && toIdx !== -1) {
                          const next = [...tabOrderList]
                          const [moved] = next.splice(fromIdx, 1)
                          next.splice(toIdx, 0, moved)
                          setTabOrderList(next)
                          saveTabOrder(next)
                        }
                      }
                      setTabOrderDragId(null); setTabOrderDragOverId(null)
                    }}
                    onDragEnd={() => { setTabOrderDragId(null); setTabOrderDragOverId(null) }}
                    className={`flex items-center gap-2 px-2 py-0.5 rounded border bg-gray-50 cursor-grab active:cursor-grabbing transition-all ${isDragOver ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'} ${savingTabOrder ? 'opacity-60' : ''}`}
                  >
                    <span className="text-gray-300 text-[10px] select-none">⠿</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0 rounded border ${badgeStyle}`}>{label}</span>
                    <span className="text-xs text-gray-800 truncate">{entry.name}</span>
                  </div>
                )
              })}
            </div>
            {savingTabOrder && <p className="mt-2 text-[11px] text-gray-400">Saving…</p>}
          </div>
        )}
      </div>

      {/* Combined Scoreboards — view-only aggregations of selected stages */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Combined Scoreboards</h2>
          <span className="text-xs text-gray-400">View-only stage aggregations — appear as a tab on the public scoreboard and selectable as a Prize &amp; Points target.</span>
          {!addingCombined && (
            <button
              onClick={() => setAddingCombined(true)}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1 ml-auto"
            >
              + Add Combined Scoreboard
            </button>
          )}
        </div>

        {addingCombined && (
          <div className="flex items-center gap-2 mb-3">
            <input
              autoFocus
              value={newCombinedName}
              onChange={(e) => setNewCombinedName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCombinedScoreboard() }}
              placeholder="Name (e.g. Weekly Finals Cumulative)"
              className="flex-1 max-w-xs border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
            <button onClick={addCombinedScoreboard} className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-medium px-3 py-1.5 rounded-lg">Add</button>
            <button onClick={() => { setAddingCombined(false); setNewCombinedName('') }} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
          </div>
        )}

        {combinedList.length === 0 && !addingCombined ? (
          <p className="text-sm text-gray-400">No combined scoreboards yet.</p>
        ) : (
          <div className="space-y-2">
            {[...combinedList].sort((a, b) => a.order_num - b.order_num).map((c) => {
              const isDragOver = dragOverCombinedId === c.id && dragCombinedId !== c.id
              const rules = combinedRulesMap[c.id] ?? { advance: '', eliminate: '' }
              const rulesDirty =
                (rules.advance || '0') !== (c.advance_count?.toString() ?? '0') ||
                (rules.eliminate || '0') !== (c.eliminate_count?.toString() ?? '0')
              return (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => setDragCombinedId(c.id)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCombinedId(c.id) }}
                  onDrop={() => {
                    if (dragCombinedId && dragCombinedId !== c.id) reorderCombined(dragCombinedId, c.id)
                    setDragCombinedId(null); setDragOverCombinedId(null)
                  }}
                  onDragEnd={() => { setDragCombinedId(null); setDragOverCombinedId(null) }}
                  className={`bg-white border rounded-lg p-3 cursor-grab active:cursor-grabbing transition-all ${isDragOver ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-gray-300 text-xs select-none">⠿</span>
                    <input
                      defaultValue={c.name}
                      onBlur={(e) => {
                        const next = e.target.value.trim()
                        if (next && next !== c.name) saveCombinedScoreboard(c.id, next, c.stageIds)
                      }}
                      className="text-sm font-medium border border-transparent hover:border-gray-200 focus:border-yellow-400 focus:bg-white rounded px-2 py-0.5 focus:outline-none"
                    />
                    <span className="text-xs text-gray-400">{c.stageIds.size} / {stageList.length} stages</span>
                    <span className="mx-1 h-4 w-px bg-gray-200" />
                    <span className="text-xs text-green-600 font-medium">▲</span>
                    <input
                      type="number"
                      min={0}
                      value={rules.advance}
                      onChange={(e) => setCombinedRulesMap((m) => ({ ...m, [c.id]: { ...rules, advance: e.target.value } }))}
                      placeholder="0"
                      className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-yellow-400"
                    />
                    <span className="text-xs text-red-500 font-medium">▼</span>
                    <input
                      type="number"
                      min={0}
                      value={rules.eliminate}
                      onChange={(e) => setCombinedRulesMap((m) => ({ ...m, [c.id]: { ...rules, eliminate: e.target.value } }))}
                      placeholder="0"
                      className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-yellow-400"
                    />
                    {rulesDirty && (
                      <button
                        onClick={() => saveCombinedAdvancement(c.id)}
                        disabled={savingCombinedRulesId === c.id}
                        className="text-xs bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-medium px-2 py-0.5 rounded"
                      >
                        {savingCombinedRulesId === c.id ? '...' : 'Save'}
                      </button>
                    )}
                    <button
                      onClick={() => deleteCombinedScoreboard(c.id, c.name)}
                      className="text-gray-300 hover:text-red-500 text-sm leading-none ml-auto"
                    >×</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stageList.map((stage) => {
                      const checked = c.stageIds.has(stage.id)
                      return (
                        <label key={stage.id} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border cursor-pointer ${checked ? 'bg-yellow-50 border-yellow-300 text-yellow-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(c.stageIds)
                              if (e.target.checked) next.add(stage.id); else next.delete(stage.id)
                              saveCombinedScoreboard(c.id, c.name, next)
                            }}
                            disabled={savingCombinedId === c.id}
                            className="sr-only"
                          />
                          {stage.name}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Series management */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Series</h2>
          {!addingSeries && (
            <button
              onClick={() => setAddingSeries(true)}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1"
            >
              + Add Series
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {seriesList.map((s) => {
            const rules = seriesRulesMap[s.id] ?? { advance: '', eliminate: '' }
            const dirty =
              (rules.advance || '0') !== (s.advance_count?.toString() ?? '0') ||
              (rules.eliminate || '0') !== (s.eliminate_count?.toString() ?? '0')
            return (
              <div
                key={s.id}
                draggable
                onDragStart={() => setDragSeriesId(s.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverSeriesId(s.id) }}
                onDrop={() => {
                  if (dragSeriesId && dragSeriesId !== s.id) reorderSeries(dragSeriesId, s.id)
                  setDragSeriesId(null); setDragOverSeriesId(null)
                }}
                onDragEnd={() => { setDragSeriesId(null); setDragOverSeriesId(null) }}
                className={`flex items-center gap-1.5 bg-white border rounded-lg px-3 py-1.5 cursor-grab active:cursor-grabbing transition-all ${dragOverSeriesId === s.id && dragSeriesId !== s.id ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'}`}
              >
                <span className="text-gray-300 text-xs select-none">⠿</span>
                <span className="text-sm text-gray-700">{s.name}</span>
                <span className="mx-1 h-4 w-px bg-gray-200" />
                <span className="text-xs text-green-600 font-medium">▲</span>
                <input
                  type="number"
                  min={0}
                  value={rules.advance}
                  onChange={(e) => setSeriesRulesMap((m) => ({ ...m, [s.id]: { ...rules, advance: e.target.value } }))}
                  placeholder="0"
                  className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-yellow-400"
                />
                <span className="text-xs text-red-500 font-medium">▼</span>
                <input
                  type="number"
                  min={0}
                  value={rules.eliminate}
                  onChange={(e) => setSeriesRulesMap((m) => ({ ...m, [s.id]: { ...rules, eliminate: e.target.value } }))}
                  placeholder="0"
                  className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-yellow-400"
                />
                {dirty && (
                  <button
                    onClick={() => saveSeriesAdvancement(s.id)}
                    disabled={savingSeriesRulesId === s.id}
                    className="text-xs bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-medium px-2 py-0.5 rounded"
                  >
                    {savingSeriesRulesId === s.id ? '...' : 'Save'}
                  </button>
                )}
                <button
                  onClick={() => deleteSeries(s.id, s.name)}
                  className="text-gray-300 hover:text-red-500 text-sm leading-none ml-1"
                >
                  ×
                </button>
              </div>
            )
          })}
          {addingSeries && (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newSeriesName}
                onChange={(e) => setNewSeriesName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSeries() }}
                placeholder="Series name"
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 w-40"
              />
              <button onClick={addSeries}
                className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-medium px-3 py-1.5 rounded-lg">
                Add
              </button>
              <button onClick={() => { setAddingSeries(false); setNewSeriesName('') }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2">
                Cancel
              </button>
            </div>
          )}
          {seriesList.length === 0 && !addingSeries && (
            <p className="text-sm text-gray-400">No series — stages will appear as a flat list</p>
          )}
        </div>
      </div>

      {/* Stages with inline match linking */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Stages</h2>

        <div className="space-y-1.5">
          {stageList.length === 0 && !addingStage && (
            <p className="text-sm text-gray-400 text-center py-2">No stages yet.</p>
          )}

          {stageList
            .slice()
            .sort((a, b) => a.order_num - b.order_num)
            .map((stage) => {
              const isDragOver = dragOverStageId === stage.id && dragStageId !== stage.id
              const sortedMatches = [...stage.matches].sort((a, b) => a.order_num - b.order_num)
              const importedMatches = sortedMatches.filter((m) => m.status === 'imported')
              const selectedMatchId = selectedMatchByStage[stage.id] ?? null
              const selectedMatch = sortedMatches.find((m) => m.id === selectedMatchId) ?? null

              const stageRule = ruleFromStage(stage.scoring_rules)
              const perMatchStandings = selectedMatch
                ? [...selectedMatch.match_team_results]
                    .map((r) => {
                      const placementPts = calcPlacementPtsWithRule(r.placement ?? 99, stageRule)
                      const killPts = Math.round((r.total_kills ?? 0) * stageRule.kill_pts)
                      return { ...r, placementPts, killPts, matchPts: placementPts + killPts }
                    })
                    .sort((a, b) =>
                      b.matchPts !== a.matchPts
                        ? b.matchPts - a.matchPts
                        : (a.placement ?? 99) - (b.placement ?? 99)
                    )
                : []

              const unlinkedTeams = selectedMatch
                ? selectedMatch.match_team_results.filter((r) => !r.team_id).length
                : 0
              const unlinkedPlayers = selectedMatch
                ? selectedMatch.match_player_stats.filter((s) => !s.player_id).length
                : 0

              return (
                <div
                  key={stage.id}
                  draggable
                  onDragStart={() => setDragStageId(stage.id)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStageId(stage.id) }}
                  onDrop={() => {
                    if (dragStageId && dragStageId !== stage.id) reorderStages(dragStageId, stage.id)
                    setDragStageId(null); setDragOverStageId(null)
                  }}
                  onDragEnd={() => { setDragStageId(null); setDragOverStageId(null) }}
                  className={`bg-white rounded-xl border overflow-hidden cursor-grab active:cursor-grabbing transition-all ${isDragOver ? 'border-yellow-400 ring-1 ring-yellow-400' : 'border-gray-200'}`}
                >
                  {/* Stage header row */}
                  {editingStageId === stage.id ? (
                    <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-100 flex-wrap">
                      <input
                        autoFocus
                        value={editStageForm.name}
                        onChange={(e) => setEditStageForm((f) => ({ ...f, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveStage(stage.id) }}
                        className="flex-1 min-w-0 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-400"
                      />
                      <select
                        value={editStageForm.type}
                        onChange={(e) => setEditStageForm((f) => ({ ...f, type: e.target.value }))}
                        className="text-xs border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="group">Group</option>
                        <option value="playoff">Playoff</option>
                        <option value="grand_final">Final</option>
                      </select>
                      {seriesList.length > 0 && (
                        <select
                          value={editStageForm.seriesId}
                          onChange={(e) => setEditStageForm((f) => ({ ...f, seriesId: e.target.value }))}
                          className="text-xs border border-gray-300 rounded px-2 py-1"
                        >
                          <option value="">No Series</option>
                          {seriesList.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      )}
                      <select
                        value={editStageForm.scoringRuleId}
                        onChange={(e) => setEditStageForm((f) => ({ ...f, scoringRuleId: e.target.value }))}
                        className="text-xs border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="">SUPER v2 (기본)</option>
                        {scoringRules.map((r) => (
                          <option key={r.id} value={r.id}>{r.name} ({r.type === 'chicken' ? 'Chicken' : r.type === 'super_v1' ? 'SUPER v1' : 'SUPER v2'})</option>
                        ))}
                      </select>
                      <button onClick={() => saveStage(stage.id)}
                        className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-medium px-2 py-1 rounded">
                        Save
                      </button>
                      <button onClick={() => setEditingStageId(null)}
                        className="text-xs text-gray-400 hover:text-gray-600 px-1">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => router.push(`/admin/tournaments/${id}/stages/${stage.id}`)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{stage.name}</span>
                        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {stage.type === 'group' ? 'Group' : stage.type === 'playoff' ? 'Playoff' : 'Final'}
                        </span>
                        {stage.series_id && (
                          <span className="text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">
                            {seriesList.find((s) => s.id === stage.series_id)?.name ?? 'Series'}
                          </span>
                        )}
                        {stage.scoring_rules ? (
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${stage.scoring_rules.type === 'chicken' ? 'bg-blue-50 text-blue-600' : 'bg-yellow-50 text-yellow-600'}`}>
                            {stage.scoring_rules.name}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300 bg-gray-50 px-1.5 py-0.5 rounded">SUPER v2</span>
                        )}
                        <span className="text-xs text-gray-400">{stage.matches.length} matches</span>
                      </div>
                      <div className="flex gap-3 items-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleStageInTotal(stage.id, stage.include_in_total ?? true) }}
                          className={`text-xs px-1.5 py-0.5 rounded font-medium border transition-colors ${
                            (stage.include_in_total ?? true)
                              ? 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
                              : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {(stage.include_in_total ?? true) ? 'ON' : 'OFF'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingStageId(stage.id); setEditStageForm({ name: stage.name, type: stage.type, seriesId: stage.series_id ?? '', scoringRuleId: stage.scoring_rule_id ?? '' }) }}
                          className="text-xs text-blue-500 hover:text-blue-700"
                        >
                          Edit
                        </button>
                        <span className="text-xs font-medium text-yellow-600">Import →</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteStage(stage.id) }}
                          className="text-xs text-red-400 hover:text-red-600"
                        >Delete</button>
                      </div>
                    </div>
                  )}

                  {/* Match tabs + inline linking */}
                  {importedMatches.length > 0 && (
                    <div className="px-3 py-2">
                      {/* Match buttons */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {sortedMatches.map((match, mi) => (
                          <button
                            key={match.id}
                            onClick={() => toggleMatchTab(stage.id, match.id)}
                            disabled={match.status !== 'imported'}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-default ${
                              selectedMatchId === match.id
                                ? 'bg-yellow-400 border-yellow-400 text-gray-900'
                                : 'bg-white border-gray-200 text-gray-700 hover:border-yellow-400'
                            }`}
                          >
                            M{mi + 1}
                            {match.map && (
                              <span className="opacity-60">{getMapDisplayName(match.map)}</span>
                            )}
                          </button>
                        ))}
                      </div>

                      {/* Selected match: team results + player stats side by side */}
                      {selectedMatch && selectedMatch.status === 'imported' && (
                        <div className="border border-gray-100 rounded-lg overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
                            <span className="text-xs font-medium text-gray-600">
                              Match {sortedMatches.findIndex((m) => m.id === selectedMatch.id) + 1}
                              {selectedMatch.map && ` — ${getMapDisplayName(selectedMatch.map)}`}
                            </span>
                            <div className="flex gap-2">
                              {unlinkedTeams > 0 && (
                                <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">
                                  {unlinkedTeams} team{unlinkedTeams > 1 ? 's' : ''} unlinked
                                </span>
                              )}
                              {unlinkedPlayers > 0 && (
                                <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium">
                                  {unlinkedPlayers} player{unlinkedPlayers > 1 ? 's' : ''} unlinked
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="grid lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
                            {/* Team Results */}
                            <div className="p-3">
                              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Teams</p>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400 border-b border-gray-100">
                                    <th className="text-left pb-1">#</th>
                                    <th className="text-left pb-1">Team</th>
                                    <th className="text-right pb-1">Plc Pts</th>
                                    <th className="text-right pb-1">Kills</th>
                                    <th className="text-right pb-1 font-bold text-gray-500">Total</th>
                                    <th className="pb-1 w-10" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {perMatchStandings.map((r, i) => (
                                    <tr key={r.id} className="border-b border-gray-50 last:border-0">
                                      <td className="py-1 text-gray-400 font-mono">{i + 1}</td>
                                      <td className="py-1">
                                        <span className={`font-medium ${r.team_id ? 'text-gray-800' : 'text-orange-600'}`}>
                                          {stripTagPrefix(r.display_name ?? r.teams?.name ?? r.pubg_team_name ?? '-')}
                                        </span>
                                        {r.team_id && r.teams?.name && (
                                          <span className="ml-1 text-[10px] text-gray-400">→ {r.teams.name}</span>
                                        )}
                                      </td>
                                      <td className="py-1 text-right text-gray-500">{r.placementPts}</td>
                                      <td className="py-1 text-right text-gray-500">{r.killPts}</td>
                                      <td className="py-1 text-right font-bold text-gray-900">{r.matchPts}</td>
                                      <td className="py-1 text-right">
                                        <button
                                          onClick={() => {
                                            const pubgName = r.pubg_team_name ?? r.teams?.name ?? ''
                                            const matchCount = stageList.flatMap((s) => s.matches).filter((m) =>
                                              m.match_team_results.some((tr) => tr.pubg_team_name === pubgName)
                                            ).length
                                            setLinkModal({ phase: 1, type: 'team', pubgName, matchCount })
                                          }}
                                          className="text-[10px] text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 border border-gray-200 hover:border-yellow-400 rounded"
                                        >
                                          Edit
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Player Stats */}
                            <div className="p-3">
                              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Players</p>
                              <div className="max-h-60 overflow-y-auto">
                                <table className="w-full text-xs">
                                  <thead className="sticky top-0 bg-white">
                                    <tr className="text-gray-400 border-b border-gray-100">
                                      <th className="text-left pb-1">PUBG Name</th>
                                      <th className="text-right pb-1">Kills</th>
                                      <th className="text-right pb-1">Dmg</th>
                                      <th className="pb-1 w-12" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {[
                                      ...selectedMatch.match_player_stats.filter((s) => !s.player_id),
                                      ...selectedMatch.match_player_stats.filter((s) => s.player_id),
                                    ]
                                      .sort((a, b) => (b.damage_dealt ?? 0) - (a.damage_dealt ?? 0))
                                      .map((s) => (
                                        <tr key={s.id} className={`border-b border-gray-50 last:border-0 ${!s.player_id ? 'bg-orange-50' : ''}`}>
                                          <td className="py-1">
                                            <span className={`font-medium ${s.player_id ? 'text-gray-800' : 'text-orange-700'}`}>
                                              {s.pubg_player_name ?? '-'}
                                            </span>
                                            {s.player_id && s.players?.nickname !== s.pubg_player_name && (
                                              <span className="ml-1 text-gray-400">→ {s.players?.nickname}</span>
                                            )}
                                          </td>
                                          <td className="py-1 text-right text-gray-500">{s.kills}</td>
                                          <td className="py-1 text-right text-gray-500">{Number(s.damage_dealt).toFixed(0)}</td>
                                          <td className="py-1 text-right">
                                            <button
                                              onClick={() => {
                                                const pubgName = s.pubg_player_name ?? ''
                                                const matchCount = stageList.flatMap((st) => st.matches).filter((m) =>
                                                  m.match_player_stats.some((ps) => ps.pubg_player_name === pubgName)
                                                ).length
                                                setLinkModal({ phase: 1, type: 'player', pubgName, matchCount })
                                              }}
                                              className="text-[10px] text-gray-400 hover:text-yellow-600 px-1.5 py-0.5 border border-gray-200 hover:border-yellow-400 rounded"
                                            >
                                              {s.player_id ? 'Edit' : 'Link'}
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

          {addingStage ? (
            <div className="border border-dashed border-gray-300 rounded-lg p-3 flex gap-2 flex-wrap bg-white">
              <input
                autoFocus
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="Stage name"
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm min-w-0"
                onKeyDown={(e) => { if (e.key === 'Enter') addStage() }}
              />
              <select value={newStageType} onChange={(e) => setNewStageType(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="group">Group</option>
                <option value="playoff">Playoff</option>
                <option value="grand_final">Final</option>
              </select>
              {seriesList.length > 0 && (
                <select value={newSeriesId} onChange={(e) => setNewSeriesId(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm">
                  <option value="">No Series</option>
                  {seriesList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
              <button onClick={addStage}
                className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 text-xs font-medium px-3 py-1 rounded">
                Add
              </button>
              <button onClick={() => { setAddingStage(false); setNewStageName(''); setNewSeriesId('') }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setAddingStage(true); setNewStageName(''); setNewStageType('group') }}
              className="w-full border border-dashed border-gray-300 rounded-lg py-2.5 text-sm text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors bg-white"
            >
              + Add Stage
            </button>
          )}
        </div>
      </div>

      {/* Prize & Points Configuration */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-800">Prize &amp; Points</h2>
          {prizeRows.length > 0 && (
            <button
              onClick={savePrizeConfig}
              disabled={savingPrize}
              className="text-sm px-3 py-1 bg-yellow-400 hover:bg-yellow-300 rounded-lg text-gray-900 font-medium disabled:opacity-50"
            >
              {savingPrize ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Column toggles + ranking method */}
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 flex items-center gap-6 flex-wrap">
            {([
              { key: 'has_prize' as const, label: 'Prize Money' },
              { key: 'has_pgs_points' as const, label: 'PGS Points' },
              { key: 'has_pgc_points' as const, label: 'PGC Points' },
            ] as const).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                  className="rounded"
                />
                {label}
              </label>
            ))}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Final Standings by</label>
              <select
                value={form.ranking_method ?? 'stage'}
                onChange={(e) => setForm((f) => ({ ...f, ranking_method: e.target.value as Tournament['ranking_method'] }))}
                className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-400"
              >
                <option value="stage">Stage Rankings</option>
                <option value="prize">Total Prize</option>
                <option value="pgs">Total PGS</option>
                <option value="pgc">Total PGC</option>
              </select>
            </div>
            {form.has_prize && (
              <div className="ml-auto flex items-center gap-2">
                <label className="text-xs text-gray-500">Currency</label>
                <select
                  value={prizeCurrency}
                  onChange={(e) => setPrizeCurrency(e.target.value)}
                  className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-400"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {selectedPrizeRanks.size > 0 && (
            <div className="px-3 py-1 bg-yellow-50 border-b border-yellow-200 flex items-center gap-3 flex-wrap">
              <span className="text-xs font-medium text-yellow-700">{selectedPrizeRanks.size} rows selected</span>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">Set Target:</label>
                <select
                  value={batchTargetKey}
                  onChange={(e) => setBatchTargetKey(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-400"
                >
                  <option value="">— none —</option>
                  {seriesList.length > 0 && (
                    <optgroup label="Series">
                      {seriesList.map((sr) => (
                        <option key={sr.id} value={`series:${sr.id}`}>{sr.name} (Series)</option>
                      ))}
                    </optgroup>
                  )}
                  {combinedList.length > 0 && (
                    <optgroup label="Combined Scoreboards">
                      {combinedList.map((c) => (
                        <option key={c.id} value={`combined:${c.id}`}>{c.name} (Combined)</option>
                      ))}
                    </optgroup>
                  )}
                  {stageList.length > 0 && (
                    <optgroup label="Stages">
                      {stageList.map((s) => (
                        <option key={s.id} value={`stage:${s.id}`}>{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  onClick={() => {
                    setPrizeRows((rows) => rows.map((r) =>
                      selectedPrizeRanks.has(r.rank) ? { ...r, targetKey: batchTargetKey } : r
                    ))
                    setSelectedPrizeRanks(new Set())
                  }}
                  className="text-xs bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-medium px-3 py-1 rounded"
                >
                  Apply
                </button>
              </div>
              <button onClick={() => setSelectedPrizeRanks(new Set())} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">Clear</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={prizeRows.length > 0 && selectedPrizeRanks.size === prizeRows.length}
                      onChange={(e) => setSelectedPrizeRanks(e.target.checked ? new Set(prizeRows.map(r => r.rank)) : new Set())}
                      className="rounded"
                    />
                  </th>
                  <th className="text-left px-3 py-1 w-10">#</th>
                  {(form.ranking_method ?? 'stage') === 'stage' && <th className="text-left px-3 py-1">Target</th>}
                  {(form.ranking_method ?? 'stage') === 'stage' && <th className="text-left px-3 py-1 w-24">Rank</th>}
                  {form.has_prize && <th className="text-right px-3 py-1">Prize ({currencySymbol(prizeCurrency)})</th>}
                  {form.has_pgs_points && <th className="text-right px-3 py-1">PGS</th>}
                  {form.has_pgc_points && <th className="text-right px-3 py-1">PGC</th>}
                </tr>
              </thead>
              <tbody>
                {prizeRows.map((row, i) => {
                  const colStart = 0
                  return (
                  <tr key={row.rank} className={`border-b border-gray-50 last:border-0 ${selectedPrizeRanks.has(row.rank) ? 'bg-yellow-50/60' : ''}`}>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedPrizeRanks.has(row.rank)}
                        onChange={(e) => setSelectedPrizeRanks((s) => {
                          const n = new Set(s)
                          e.target.checked ? n.add(row.rank) : n.delete(row.rank)
                          return n
                        })}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-1 text-gray-400 font-mono text-xs">{row.rank}</td>
                    {(form.ranking_method ?? 'stage') === 'stage' && (
                      <td className="px-3 py-1">
                        <select
                          value={row.targetKey}
                          onChange={(e) => setPrizeRows((rows) => rows.map((r, j) => j === i ? { ...r, targetKey: e.target.value } : r))}
                          data-prize-row={i} data-prize-col={colStart}
                          onKeyDown={(e) => navPrize(e, i, colStart)}
                          className="w-44 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        >
                          <option value="">— none —</option>
                          {seriesList.length > 0 && (
                            <optgroup label="Series">
                              {seriesList.map((sr) => (
                                <option key={sr.id} value={`series:${sr.id}`}>{sr.name} (Series)</option>
                              ))}
                            </optgroup>
                          )}
                          {combinedList.length > 0 && (
                            <optgroup label="Combined Scoreboards">
                              {combinedList.map((c) => (
                                <option key={c.id} value={`combined:${c.id}`}>{c.name} (Combined)</option>
                              ))}
                            </optgroup>
                          )}
                          {stageList.length > 0 && (
                            <optgroup label="Stages">
                              {stageList.map((stage) => (
                                <option key={stage.id} value={`stage:${stage.id}`}>{stage.name}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </td>
                    )}
                    {(form.ranking_method ?? 'stage') === 'stage' && (
                      <td className="px-3 py-1">
                        <input
                          type="number"
                          min={1}
                          value={row.stageRank}
                          onChange={(e) => setPrizeRows((rows) => rows.map((r, j) => j === i ? { ...r, stageRank: parseInt(e.target.value) || 1 } : r))}
                          data-prize-row={i} data-prize-col={colStart + 1}
                          onKeyDown={(e) => navPrize(e, i, colStart + 1)}
                          className="w-20 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </td>
                    )}
                    {form.has_prize && (
                      <td className="px-3 py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-xs text-gray-400 shrink-0">{currencySymbol(prizeCurrency)}</span>
                          <input
                            value={row.prize}
                            onChange={(e) => setPrizeRows((rows) => rows.map((r, j) => j === i ? { ...r, prize: fmtNumberInput(e.target.value) } : r))}
                            placeholder="0"
                            data-prize-row={i} data-prize-col={colStart + 2}
                            onKeyDown={(e) => navPrize(e, i, colStart + 2)}
                            className="text-right w-28 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                          />
                        </div>
                      </td>
                    )}
                    {form.has_pgs_points && (
                      <td className="px-3 py-1 text-right">
                        <input
                          type="number"
                          value={row.pgs}
                          onChange={(e) => setPrizeRows((rows) => rows.map((r, j) => j === i ? { ...r, pgs: e.target.value } : r))}
                          placeholder="0"
                          data-prize-row={i} data-prize-col={colStart + 3}
                          onKeyDown={(e) => navPrize(e, i, colStart + 3)}
                          className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </td>
                    )}
                    {form.has_pgc_points && (
                      <td className="px-3 py-1 text-right">
                        <input
                          type="number"
                          value={row.pgc}
                          onChange={(e) => setPrizeRows((rows) => rows.map((r, j) => j === i ? { ...r, pgc: e.target.value } : r))}
                          placeholder="0"
                          data-prize-row={i} data-prize-col={colStart + 4}
                          onKeyDown={(e) => navPrize(e, i, colStart + 4)}
                          className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Stage Prizes */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Stage Prizes</h2>
            <p className="text-xs text-gray-500 mt-0.5">Placement prizes and points awarded by stage or by series cumulative standings</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedStagePrizeId}
              onChange={(e) => setSelectedStagePrizeId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            >
              {seriesList.length > 0 && (
                <optgroup label="Series">
                  {seriesList.map((sr) => <option key={sr.id} value={`series:${sr.id}`}>{sr.name} (Series)</option>)}
                </optgroup>
              )}
              {stageList.length > 0 && (
                <optgroup label="Stages">
                  {stageList.map((s) => <option key={s.id} value={`stage:${s.id}`}>{s.name}</option>)}
                </optgroup>
              )}
            </select>
            <button
              onClick={saveStagePrizes}
              disabled={savingStagePrize || !selectedStagePrizeId}
              className="text-sm px-3 py-1 bg-yellow-400 hover:bg-yellow-300 rounded-lg text-gray-900 font-medium disabled:opacity-50"
            >
              {savingStagePrize ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        {selectedStagePrizeId && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-3 py-1 w-10">#</th>
                    {form.has_prize && <th className="text-right px-3 py-1">Prize ({currencySymbol(prizeCurrency)})</th>}
                    {form.has_pgs_points && <th className="text-right px-3 py-1">PGS</th>}
                    {form.has_pgc_points && <th className="text-right px-3 py-1">PGC</th>}
                  </tr>
                </thead>
                <tbody>
                  {(stagePrizeMap[selectedStagePrizeId] ?? []).map((row, i) => (
                    <tr key={row.placement} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-0.5 text-gray-400 font-mono text-xs">{row.placement}</td>
                      {form.has_prize && (
                        <td className="px-3 py-0.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-xs text-gray-400">{currencySymbol(prizeCurrency)}</span>
                            <input
                              value={row.prize}
                              data-nav-table="stage-prize" data-nav-row={i} data-nav-col={0}
                              onKeyDown={(e) => navTable('stage-prize', e, i, 0)}
                              onChange={(e) => setStagePrizeMap((m) => ({
                                ...m,
                                [selectedStagePrizeId]: m[selectedStagePrizeId].map((r, j) => j === i ? { ...r, prize: fmtNumberInput(e.target.value) } : r),
                              }))}
                              placeholder="0"
                              className="text-right w-28 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                            />
                          </div>
                        </td>
                      )}
                      {form.has_pgs_points && (
                        <td className="px-3 py-0.5 text-right">
                          <input
                            type="number"
                            value={row.pgs}
                            data-nav-table="stage-prize" data-nav-row={i} data-nav-col={1}
                            onKeyDown={(e) => navTable('stage-prize', e, i, 1)}
                            onChange={(e) => setStagePrizeMap((m) => ({
                              ...m,
                              [selectedStagePrizeId]: m[selectedStagePrizeId].map((r, j) => j === i ? { ...r, pgs: e.target.value } : r),
                            }))}
                            placeholder="0"
                            className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                          />
                        </td>
                      )}
                      {form.has_pgc_points && (
                        <td className="px-3 py-0.5 text-right">
                          <input
                            type="number"
                            value={row.pgc}
                            data-nav-table="stage-prize" data-nav-row={i} data-nav-col={2}
                            onKeyDown={(e) => navTable('stage-prize', e, i, 2)}
                            onChange={(e) => setStagePrizeMap((m) => ({
                              ...m,
                              [selectedStagePrizeId]: m[selectedStagePrizeId].map((r, j) => j === i ? { ...r, pgc: e.target.value } : r),
                            }))}
                            placeholder="0"
                            className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                          />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* WWCD Rewards */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">WWCD Rewards</h2>
            <p className="text-xs text-gray-500 mt-0.5">Per-WWCD prize/points, scoped to a stage, a series, or applied across all stages</p>
          </div>
          <button
            onClick={saveWwcdRewards}
            disabled={savingWwcd}
            className="text-sm px-3 py-1 bg-yellow-400 hover:bg-yellow-300 rounded-lg text-gray-900 font-medium disabled:opacity-50"
          >
            {savingWwcd ? 'Saving...' : 'Save'}
          </button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {wwcdRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-3 py-1">Target</th>
                    {form.has_prize && <th className="text-right px-3 py-1">Prize ({currencySymbol(prizeCurrency)}) / WWCD</th>}
                    {form.has_pgs_points && <th className="text-right px-3 py-1">PGS / WWCD</th>}
                    {form.has_pgc_points && <th className="text-right px-3 py-1">PGC / WWCD</th>}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {wwcdRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-1">
                        <select
                          value={row.targetKey}
                          data-nav-table="wwcd" data-nav-row={i} data-nav-col={0}
                          onKeyDown={(e) => navTable('wwcd', e, i, 0)}
                          onChange={(e) => setWwcdRows((rows) => rows.map((r, j) => j === i ? { ...r, targetKey: e.target.value } : r))}
                          className="w-52 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        >
                          <option value="">— all stages —</option>
                          {seriesList.length > 0 && (
                            <optgroup label="Series">
                              {seriesList.map((sr) => <option key={sr.id} value={`series:${sr.id}`}>{sr.name} (Series)</option>)}
                            </optgroup>
                          )}
                          {stageList.length > 0 && (
                            <optgroup label="Stages">
                              {stageList.map((s) => <option key={s.id} value={`stage:${s.id}`}>{s.name}</option>)}
                            </optgroup>
                          )}
                        </select>
                      </td>
                      {form.has_prize && (
                        <td className="px-3 py-1 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-xs text-gray-400">{currencySymbol(prizeCurrency)}</span>
                            <input
                              value={row.prize}
                              data-nav-table="wwcd" data-nav-row={i} data-nav-col={1}
                              onKeyDown={(e) => navTable('wwcd', e, i, 1)}
                              onChange={(e) => setWwcdRows((rows) => rows.map((r, j) => j === i ? { ...r, prize: fmtNumberInput(e.target.value) } : r))}
                              placeholder="0"
                              className="text-right w-28 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                            />
                          </div>
                        </td>
                      )}
                      {form.has_pgs_points && (
                        <td className="px-3 py-1 text-right">
                          <input
                            type="number"
                            value={row.pgs}
                            data-nav-table="wwcd" data-nav-row={i} data-nav-col={2}
                            onKeyDown={(e) => navTable('wwcd', e, i, 2)}
                            onChange={(e) => setWwcdRows((rows) => rows.map((r, j) => j === i ? { ...r, pgs: e.target.value } : r))}
                            placeholder="0"
                            className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                          />
                        </td>
                      )}
                      {form.has_pgc_points && (
                        <td className="px-3 py-1 text-right">
                          <input
                            type="number"
                            value={row.pgc}
                            data-nav-table="wwcd" data-nav-row={i} data-nav-col={3}
                            onKeyDown={(e) => navTable('wwcd', e, i, 3)}
                            onChange={(e) => setWwcdRows((rows) => rows.map((r, j) => j === i ? { ...r, pgc: e.target.value } : r))}
                            placeholder="0"
                            className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setWwcdRows((rows) => rows.filter((_, j) => j !== i))}
                          className="text-gray-300 hover:text-red-400 text-sm"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-3 py-1.5 border-t border-gray-100">
            <button
              onClick={() => setWwcdRows((rows) => [...rows, { id: '', targetKey: '', prize: '', pgs: '', pgc: '' }])}
              className="text-sm text-yellow-600 hover:text-yellow-700 font-medium"
            >
              + Add Row
            </button>
          </div>
        </div>
      </div>

      {/* Special Awards */}
      <div className="mt-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Special Awards</h2>
            <p className="text-xs text-gray-500 mt-0.5">MVP, Best Fragger, and other individual prizes shown below Final Standings</p>
          </div>
          <button
            onClick={saveSpecialAwards}
            disabled={savingSpecial}
            className="text-sm px-3 py-1 bg-yellow-400 hover:bg-yellow-300 rounded-lg text-gray-900 font-medium disabled:opacity-50"
          >
            {savingSpecial ? 'Saving...' : 'Save'}
          </button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {specialRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-3 py-1">Category</th>
                    <th className="text-left px-3 py-1">Award Name</th>
                    <th className="text-left px-3 py-1">Type</th>
                    <th className="text-left px-3 py-1">Recipient</th>
                    {form.has_prize && <th className="text-right px-3 py-1">Prize ({currencySymbol(prizeCurrency)})</th>}
                    {form.has_pgs_points && <th className="text-right px-3 py-1">PGS</th>}
                    {form.has_pgc_points && <th className="text-right px-3 py-1">PGC</th>}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {specialRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-1">
                        <input
                          value={row.category}
                          data-nav-table="special" data-nav-row={i} data-nav-col={0}
                          onKeyDown={(e) => navTable('special', e, i, 0)}
                          onChange={(e) => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, category: e.target.value } : r))}
                          placeholder="e.g. Awards"
                          className="w-32 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </td>
                      <td className="px-3 py-1">
                        <input
                          value={row.awardName}
                          data-nav-table="special" data-nav-row={i} data-nav-col={1}
                          onKeyDown={(e) => navTable('special', e, i, 1)}
                          onChange={(e) => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, awardName: e.target.value } : r))}
                          placeholder="e.g. MVP"
                          className="w-36 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                        />
                      </td>
                      <td className="px-3 py-1">
                        <select
                          value={row.targetType}
                          data-nav-table="special" data-nav-row={i} data-nav-col={2}
                          onKeyDown={(e) => navTable('special', e, i, 2)}
                          onChange={(e) => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, targetType: e.target.value as 'player' | 'team' } : r))}
                          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-400 bg-white"
                        >
                          <option value="player">Player</option>
                          <option value="team">Team</option>
                        </select>
                      </td>
                      <td className="px-3 py-1">
                        {row.targetType === 'player' ? (
                          row.playerId ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-700 font-medium">{row.playerDisplayName || '?'}</span>
                              <button
                                onClick={() => setAwardPlayerLinkIdx({ idx: i, type: 'player' })}
                                className="text-xs text-blue-500 hover:text-blue-700"
                              >Change</button>
                              <button
                                onClick={() => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, playerId: null, playerDisplayName: '' } : r))}
                                className="text-xs text-gray-300 hover:text-red-400"
                              >✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAwardPlayerLinkIdx({ idx: i, type: 'player' })}
                              className="text-xs border border-gray-300 rounded px-2 py-0.5 text-gray-600 hover:bg-gray-50"
                            >
                              Link Player
                            </button>
                          )
                        ) : (
                          row.teamId ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-700 font-medium">{row.teamDisplayName || '?'}</span>
                              <button
                                onClick={() => setAwardPlayerLinkIdx({ idx: i, type: 'team' })}
                                className="text-xs text-blue-500 hover:text-blue-700"
                              >Change</button>
                              <button
                                onClick={() => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, teamId: null, teamDisplayName: '' } : r))}
                                className="text-xs text-gray-300 hover:text-red-400"
                              >✕</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAwardPlayerLinkIdx({ idx: i, type: 'team' })}
                              className="text-xs border border-gray-300 rounded px-2 py-0.5 text-gray-600 hover:bg-gray-50"
                            >
                              Link Team
                            </button>
                          )
                        )}
                      </td>
                      {form.has_prize && (
                        <td className="px-3 py-1 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-xs text-gray-400">{currencySymbol(prizeCurrency)}</span>
                            <input
                              value={row.prize}
                              data-nav-table="special" data-nav-row={i} data-nav-col={3}
                              onKeyDown={(e) => navTable('special', e, i, 3)}
                              onChange={(e) => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, prize: fmtNumberInput(e.target.value) } : r))}
                              placeholder="0"
                              className="text-right w-28 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                            />
                          </div>
                        </td>
                      )}
                      {form.has_pgs_points && (
                        <td className="px-3 py-1 text-right">
                          <input
                            type="number"
                            value={row.pgs}
                            data-nav-table="special" data-nav-row={i} data-nav-col={4}
                            onKeyDown={(e) => navTable('special', e, i, 4)}
                            onChange={(e) => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, pgs: e.target.value } : r))}
                            placeholder="0"
                            className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                          />
                        </td>
                      )}
                      {form.has_pgc_points && (
                        <td className="px-3 py-1 text-right">
                          <input
                            type="number"
                            value={row.pgc}
                            data-nav-table="special" data-nav-row={i} data-nav-col={5}
                            onKeyDown={(e) => navTable('special', e, i, 5)}
                            onChange={(e) => setSpecialRows((rows) => rows.map((r, j) => j === i ? { ...r, pgc: e.target.value } : r))}
                            placeholder="0"
                            className="text-right w-24 border border-gray-200 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setSpecialRows((rows) => rows.filter((_, j) => j !== i))}
                          className="text-gray-300 hover:text-red-400 text-sm"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-3 py-1.5 border-t border-gray-100">
            <button
              onClick={() => setSpecialRows((rows) => [...rows, { id: '', category: rows[rows.length - 1]?.category ?? '', awardName: '', targetType: 'player', playerId: null, playerDisplayName: '', teamId: null, teamDisplayName: '', prize: '', pgs: '', pgc: '' }])}
              className="text-sm text-yellow-600 hover:text-yellow-700 font-medium"
            >
              + Add Award
            </button>
          </div>
        </div>
      </div>

      {rosterPickerOpen && (
        <SearchModal
          type={rosterPickerOpen === 'team' ? 'team' : 'player'}
          targetName={
            rosterPickerOpen === 'team'
              ? (tournament.short_name ?? tournament.name)
              : (rosterTeams.find((rt) => rt.team_id === (rosterPickerOpen as { teamId: string }).teamId)?.name ?? 'Team')
          }
          subtext="Pick one to register; the picker stays open for the next pick — close when done."
          onConfirm={async (entityId) => {
            if (rosterPickerOpen === 'team') {
              await addRosterTeam(entityId)
            } else {
              await addRosterPlayer(entityId, rosterPickerOpen.teamId)
            }
          }}
          onClose={() => setRosterPickerOpen(null)}
        />
      )}

      {bulkRosterOpen && (
        <BulkRosterModal
          kind={bulkRosterOpen === 'team' ? 'team' : 'player'}
          tournamentId={id}
          forTeamId={bulkRosterOpen === 'team' ? undefined : bulkRosterOpen.teamId}
          existingIds={new Set(
            bulkRosterOpen === 'team'
              ? rosterTeams.map((rt) => rt.team_id)
              : rosterPlayers.map((rp) => rp.player_id)
          )}
          onClose={() => setBulkRosterOpen(null)}
          onSaved={() => reload()}
        />
      )}

      {editAliasesPlayer && (
        <PlayerAliasesModal
          playerId={editAliasesPlayer.id}
          playerNickname={editAliasesPlayer.nickname}
          onClose={() => setEditAliasesPlayer(null)}
          onChanged={() => reload()}
        />
      )}

      {awardPlayerLinkIdx !== null && (() => {
        // Only allow picking from this tournament's pre-registered participants.
        const teamNameById = new Map(rosterTeams.map((rt) => [rt.team_id, rt.display_name ?? rt.name]))
        const restrict = awardPlayerLinkIdx.type === 'team'
          ? rosterTeams.map((rt) => ({ id: rt.team_id, label: rt.display_name ?? rt.name, sublabel: rt.short_name ?? undefined }))
          : rosterPlayers.map((rp) => ({ id: rp.player_id, label: rp.nickname, sublabel: rp.team_id ? teamNameById.get(rp.team_id) ?? undefined : undefined }))
        return (
          <SearchModal
            type={awardPlayerLinkIdx.type}
            targetName={specialRows[awardPlayerLinkIdx.idx]?.awardName || 'Award'}
            subtext="Restricted to this tournament's participants — register more in the Participants section."
            restrictTo={restrict}
            onConfirm={(entityId, entityName) => {
              const { idx, type } = awardPlayerLinkIdx
              setSpecialRows((rows) => rows.map((r, j) => j === idx
                ? type === 'player'
                  ? { ...r, playerId: entityId, playerDisplayName: entityName }
                  : { ...r, teamId: entityId, teamDisplayName: entityName }
                : r
              ))
              setAwardPlayerLinkIdx(null)
            }}
            onClose={() => setAwardPlayerLinkIdx(null)}
          />
        )
      })()}

      {linkModal?.phase === 1 && (
        <SearchModal
          type={linkModal.type}
          targetName={linkModal.pubgName}
          subtext={linkModal.matchCount > 1 ? `Will link across all ${linkModal.matchCount} matches in this tournament` : undefined}
          onConfirm={(entityId, entityName) => {
            setLinkModal({ ...linkModal, phase: 2, entityId, entityName })
          }}
          onClose={() => setLinkModal(null)}
        />
      )}

      {linkModal?.phase === 2 && (
        <DisplayNameModal
          type={linkModal.type}
          entityId={linkModal.entityId}
          entityName={linkModal.entityName}
          pubgName={linkModal.pubgName}
          matchCount={linkModal.matchCount}
          onConfirm={(displayName) => {
            if (linkModal.type === 'team') {
              linkTeam(linkModal.pubgName, linkModal.entityId, displayName, linkModal.entityName)
            } else {
              linkPlayer(linkModal.pubgName, linkModal.entityId, displayName, linkModal.entityName)
            }
          }}
          onClose={() => setLinkModal(null)}
        />
      )}
    </div>
  )
}
