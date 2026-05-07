import { createPublicClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import CircuitContent from './CircuitContent'

export const revalidate = 30

type Props = { params: Promise<{ tag: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params
  return { title: `${tag} History` }
}

const PLACEMENT_PTS = [10, 6, 5, 4, 3, 2, 1, 1]
function calcPts(placement: number) {
  return placement >= 1 && placement <= 8 ? PLACEMENT_PTS[placement - 1] : 0
}

const PAGE_SIZE = 1000

async function fetchPaged<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
): Promise<T[]> {
  const rows: T[] = []
  let page = 0
  while (true) {
    const { data: batch } = await query.order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (!batch || batch.length === 0) break
    rows.push(...(batch as T[]))
    if (batch.length < PAGE_SIZE) break
    page++
  }
  return rows
}

export interface CircuitTeamStat {
  teamId: string | null
  teamName: string
  logoUrl: string | null
  tournaments: number
  matches: number
  wins: number
  kills: number
  damage: number
}

export interface CircuitPlayerStat {
  playerId: string | null
  nickname: string
  teamId: string | null
  teamName: string
  logoUrl: string | null
  tournaments: number
  matches: number
  kills: number
  assists: number
  knocks: number
  headshotKills: number
  damage: number
}

export interface CircuitChampion {
  tournamentId: string
  teamId: string | null
  teamName: string
  logoUrl: string | null
  totalPoints: number
  totalKills: number
  wins: number
  matches: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>

export default async function CircuitPage({ params }: Props) {
  const { tag } = await params
  const supabase = createPublicClient()

  const { data: tournamentsData } = await supabase
    .from('tournaments')
    .select('*')
    .eq('tag', tag)
    .order('start_date', { ascending: false })

  const tournaments = (tournamentsData ?? []) as Tournament[]
  if (tournaments.length === 0) notFound()

  const tournamentIds = tournaments.map((t) => t.id)

  const { data: stagesData } = await supabase
    .from('stages')
    .select('id, tournament_id, order_num, type')
    .in('tournament_id', tournamentIds)

  const stages = (stagesData ?? []) as AnyRow[]
  const stageIds = stages.map((s) => s.id as string)

  if (stageIds.length === 0) {
    return (
      <>
        <Header />
        <main className="max-w-5xl mx-auto px-4 py-10 w-full">
          <CircuitHeader tag={tag} count={tournaments.length} />
          <CircuitContent
            tag={tag}
            tournaments={tournaments}
            champions={[]}
            teamStats={[]}
            playerStats={[]}
          />
        </main>
      </>
    )
  }

  const [{ data: matchesData }, { data: ttData }] = await Promise.all([
    supabase
      .from('matches')
      .select('id, stage_id, status')
      .in('stage_id', stageIds)
      .eq('status', 'imported'),
    supabase
      .from('tournament_teams')
      .select('tournament_id, team_id, disqualified')
      .in('tournament_id', tournamentIds),
  ])

  const matches = (matchesData ?? []) as AnyRow[]
  const matchIds = matches.map((m) => m.id as string)

  // Build lookup: matchId → tournamentId, plus grand-final stage map for
  // picking each tournament's champion and DQ map for filtering them out.
  const stageToTournament = new Map<string, string>()
  for (const s of stages) stageToTournament.set(s.id as string, s.tournament_id as string)
  const matchToTournament = new Map<string, string>()
  for (const m of matches) {
    const tid = stageToTournament.get(m.stage_id as string)
    if (tid) matchToTournament.set(m.id as string, tid)
  }
  const grandFinalStageByTournament = new Map<string, string>()
  for (const s of stages) {
    if (s.type === 'grand_final') {
      grandFinalStageByTournament.set(s.tournament_id as string, s.id as string)
    }
  }
  const grandFinalMatchIds = new Set<string>()
  for (const m of matches) {
    const sid = m.stage_id as string
    const tid = stageToTournament.get(sid)
    if (tid && grandFinalStageByTournament.get(tid) === sid) grandFinalMatchIds.add(m.id as string)
  }
  const dqByTournament = new Map<string, Set<string>>()
  for (const r of (ttData ?? []) as AnyRow[]) {
    if (!r.disqualified) continue
    const tid = r.tournament_id as string
    if (!dqByTournament.has(tid)) dqByTournament.set(tid, new Set())
    dqByTournament.get(tid)!.add(r.team_id as string)
  }

  const [allTeamResults, allPlayerStats] = await Promise.all([
    matchIds.length === 0 ? Promise.resolve([]) : fetchPaged<AnyRow>(
      supabase
        .from('match_team_results')
        .select('id, match_id, team_id, pubg_team_name, placement, total_kills, total_damage, teams(id, name, logo_url)')
        .in('match_id', matchIds)
    ),
    matchIds.length === 0 ? Promise.resolve([]) : fetchPaged<AnyRow>(
      supabase
        .from('match_player_stats')
        .select('id, match_id, player_id, team_id, pubg_player_name, kills, assists, knocks, headshot_kills, damage_dealt, players(id, nickname), teams(id, name, logo_url)')
        .in('match_id', matchIds)
    ),
  ])

  type TeamAgg = {
    teamId: string | null; teamName: string; logoUrl: string | null
    matches: number; wins: number; kills: number; damage: number; totalPoints: number
  }
  // Per-tournament: tournament-wide team aggregate (used as champion fallback
  // and for the champions table's stat columns).
  const tournamentTeamMap = new Map<string, Map<string, TeamAgg>>()
  // Per-tournament: grand-final-stage-only team aggregate. Most PWS / PEC /
  // PGS-style circuits decide the champion from the Grand Finals stage, so
  // when one exists we pick #1 from there; otherwise we fall back to the
  // tournament-wide aggregate. DQ teams are filtered out of both.
  const tournamentGFMap = new Map<string, Map<string, TeamAgg>>()
  for (const tid of tournamentIds) {
    tournamentTeamMap.set(tid, new Map())
    tournamentGFMap.set(tid, new Map())
  }

  function bumpAgg(byTeam: Map<string, TeamAgg>, r: AnyRow) {
    const key = (r.team_id ?? r.pubg_team_name ?? '?') as string
    const ex = byTeam.get(key) ?? {
      teamId: (r.team_id ?? null) as string | null,
      teamName: (r.teams as AnyRow | null)?.name ?? (r.pubg_team_name as string) ?? '?',
      logoUrl: (r.teams as AnyRow | null)?.logo_url ?? null,
      matches: 0, wins: 0, kills: 0, damage: 0, totalPoints: 0,
    }
    ex.matches++
    ex.kills += (r.total_kills as number) ?? 0
    ex.damage += (r.total_damage as number) ?? 0
    ex.totalPoints += calcPts((r.placement as number) ?? 99) + ((r.total_kills as number) ?? 0)
    if (r.placement === 1) ex.wins++
    byTeam.set(key, ex)
  }

  for (const r of allTeamResults) {
    const tournamentId = matchToTournament.get(r.match_id as string)
    if (!tournamentId) continue
    bumpAgg(tournamentTeamMap.get(tournamentId)!, r)
    if (grandFinalMatchIds.has(r.match_id as string)) {
      bumpAgg(tournamentGFMap.get(tournamentId)!, r)
    }
  }

  const champions: CircuitChampion[] = []
  for (const tid of tournamentIds) {
    const dq = dqByTournament.get(tid) ?? new Set<string>()
    const isDq = (e: TeamAgg) => !!e.teamId && dq.has(e.teamId)
    // Prefer Grand Finals stage when present; fall back to tournament-wide.
    const gf = tournamentGFMap.get(tid)
    const wide = tournamentTeamMap.get(tid)
    const pool = (gf && gf.size > 0) ? gf : wide
    if (!pool || pool.size === 0) continue
    const sorted = [...pool.values()]
      .filter((e) => !isDq(e))
      .sort((a, b) => b.totalPoints - a.totalPoints)
    if (sorted.length === 0) continue
    const c = sorted[0]
    // Stat columns always reflect tournament-wide totals so the matches /
    // wins / kills / points columns aren't truncated to just the GF stage.
    const wideEntry = wide ? [...wide.values()].find((e) => e.teamId === c.teamId) : null
    const stat = wideEntry ?? c
    champions.push({
      tournamentId: tid,
      teamId: c.teamId,
      teamName: c.teamName,
      logoUrl: c.logoUrl,
      totalPoints: stat.totalPoints,
      totalKills: stat.kills,
      wins: stat.wins,
      matches: stat.matches,
    })
  }

  // Aggregate global team stats
  const globalTeamMap = new Map<string, {
    teamId: string | null; teamName: string; logoUrl: string | null
    tournamentSet: Set<string>; matches: number; wins: number; kills: number; damage: number
  }>()

  for (const r of allTeamResults) {
    const tournamentId = matchToTournament.get(r.match_id as string)
    const key = (r.team_id ?? r.pubg_team_name ?? '?') as string
    const ex = globalTeamMap.get(key) ?? {
      teamId: (r.team_id ?? null) as string | null,
      teamName: (r.teams as AnyRow | null)?.name ?? (r.pubg_team_name as string) ?? '?',
      logoUrl: (r.teams as AnyRow | null)?.logo_url ?? null,
      tournamentSet: new Set<string>(), matches: 0, wins: 0, kills: 0, damage: 0,
    }
    if (tournamentId) ex.tournamentSet.add(tournamentId)
    ex.matches++
    ex.kills += (r.total_kills as number) ?? 0
    ex.damage += (r.total_damage as number) ?? 0
    if (r.placement === 1) ex.wins++
    globalTeamMap.set(key, ex)
  }

  const teamStats: CircuitTeamStat[] = [...globalTeamMap.values()]
    .map((t) => ({ teamId: t.teamId, teamName: t.teamName, logoUrl: t.logoUrl, tournaments: t.tournamentSet.size, matches: t.matches, wins: t.wins, kills: t.kills, damage: t.damage }))
    .sort((a, b) => b.kills - a.kills)

  // Aggregate global player stats
  const globalPlayerMap = new Map<string, {
    playerId: string | null; nickname: string; teamId: string | null; teamName: string; logoUrl: string | null
    tournamentSet: Set<string>; matches: number; kills: number; assists: number; knocks: number; headshotKills: number; damage: number
  }>()

  for (const s of allPlayerStats) {
    const tournamentId = matchToTournament.get(s.match_id as string)
    const key = (s.player_id ?? s.pubg_player_name ?? '?') as string
    const ex = globalPlayerMap.get(key) ?? {
      playerId: (s.player_id ?? null) as string | null,
      nickname: (s.players as AnyRow | null)?.nickname ?? (s.pubg_player_name as string) ?? '?',
      teamId: (s.team_id ?? null) as string | null,
      teamName: (s.teams as AnyRow | null)?.name ?? '?',
      logoUrl: (s.teams as AnyRow | null)?.logo_url ?? null,
      tournamentSet: new Set<string>(), matches: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0,
    }
    if (tournamentId) ex.tournamentSet.add(tournamentId)
    ex.matches++
    ex.kills += (s.kills as number) ?? 0
    ex.assists += (s.assists as number) ?? 0
    ex.knocks += (s.knocks as number) ?? 0
    ex.headshotKills += (s.headshot_kills as number) ?? 0
    ex.damage += (s.damage_dealt as number) ?? 0
    globalPlayerMap.set(key, ex)
  }

  const playerStats: CircuitPlayerStat[] = [...globalPlayerMap.values()]
    .map((p) => ({ playerId: p.playerId, nickname: p.nickname, teamId: p.teamId, teamName: p.teamName, logoUrl: p.logoUrl, tournaments: p.tournamentSet.size, matches: p.matches, kills: p.kills, assists: p.assists, knocks: p.knocks, headshotKills: p.headshotKills, damage: p.damage }))
    .sort((a, b) => b.kills - a.kills)

  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-10 w-full">
        <CircuitHeader tag={tag} count={tournaments.length} />
        <CircuitContent
          tag={tag}
          tournaments={tournaments}
          champions={champions}
          teamStats={teamStats}
          playerStats={playerStats}
        />
      </main>
    </>
  )
}

function CircuitHeader({ tag, count }: { tag: string; count: number }) {
  return (
    <div className="mb-6">
      <Link href="/tournaments" className="text-sm text-gray-400 hover:text-gray-600">← Tournaments</Link>
      <div className="flex items-center gap-3 mt-2">
        <h1 className="text-2xl font-bold text-gray-900">{tag}</h1>
        <span className="text-sm text-gray-400">{count} tournaments</span>
      </div>
    </div>
  )
}
