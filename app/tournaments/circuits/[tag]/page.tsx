import { createPublicClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import CircuitContent from './CircuitContent'
import { getTournamentFinalStandings } from '@/lib/tournament-standings'

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
const ID_CHUNK = 80

// Page through a query in 1000-row windows. Used after the IN list is
// already constrained to a single chunk by the helpers below.
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

// Chunk an IN-list filter so the URL stays under PostgREST / proxy limits;
// big circuits (PWS has 10 phases × ~16 stages × ~10 matches each) used to
// blow past the URL ceiling and the query silently came back empty.
async function fetchInChunked<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (chunk: string[]) => any,
  ids: string[],
): Promise<T[]> {
  if (ids.length === 0) return []
  const chunks: string[][] = []
  for (let off = 0; off < ids.length; off += ID_CHUNK) chunks.push(ids.slice(off, off + ID_CHUNK))
  const out = await Promise.all(chunks.map((c) => fetchPaged<T>(build(c))))
  return out.flat()
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

  const stages = await fetchInChunked<AnyRow>(
    (chunk) => supabase.from('stages').select('id, tournament_id, order_num, type').in('tournament_id', chunk),
    tournamentIds,
  )
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

  const matches = await fetchInChunked<AnyRow>(
    (chunk) => supabase.from('matches').select('id, stage_id, status').in('stage_id', chunk).eq('status', 'imported'),
    stageIds,
  )
  const matchIds = matches.map((m) => m.id as string)

  // Build lookup: matchId → tournamentId. (DQ filtering happens inside
  // getTournamentFinalStandings — it's already factored into rank=1.)
  const stageToTournament = new Map<string, string>()
  for (const s of stages) stageToTournament.set(s.id as string, s.tournament_id as string)
  const matchToTournament = new Map<string, string>()
  for (const m of matches) {
    const tid = stageToTournament.get(m.stage_id as string)
    if (tid) matchToTournament.set(m.id as string, tid)
  }

  const [allTeamResults, allPlayerStats] = await Promise.all([
    fetchInChunked<AnyRow>(
      (chunk) => supabase
        .from('match_team_results')
        .select('id, match_id, team_id, pubg_team_name, placement, total_kills, total_damage, teams(id, name, logo_url)')
        .in('match_id', chunk),
      matchIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase
        .from('match_player_stats')
        .select('id, match_id, player_id, team_id, pubg_player_name, kills, assists, knocks, headshot_kills, damage_dealt, players(id, nickname), teams(id, name, logo_url)')
        .in('match_id', chunk),
      matchIds,
    ),
  ])

  type TeamAgg = {
    teamId: string | null; teamName: string; logoUrl: string | null
    matches: number; wins: number; kills: number; damage: number; totalPoints: number
  }
  // Per-tournament tournament-wide team aggregate — only used to fill the
  // champions table's stat columns (matches / wins / kills / points) for the
  // team that getTournamentFinalStandings returns as #1.
  const tournamentTeamMap = new Map<string, Map<string, TeamAgg>>()
  for (const tid of tournamentIds) tournamentTeamMap.set(tid, new Map())

  for (const r of allTeamResults) {
    const tournamentId = matchToTournament.get(r.match_id as string)
    if (!tournamentId) continue
    const byTeam = tournamentTeamMap.get(tournamentId)!
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

  // Pull each tournament's Final Standings via the same helper the public
  // tournament page uses, so the champion shown here matches the
  // scoreboard's #1 (honors ranking_method, prize_config, scoring rule, DQ).
  // Calls run in small batches so big circuits (PWS = 10+ tournaments)
  // don't burst the Supabase connection budget and 500 the page.
  const FINAL_STANDINGS_CONCURRENCY = 4
  const finalStandingsList: { tid: string; map: Map<string, { rank: number | 'DQ'; prize: number | null }> }[] = []
  for (let i = 0; i < tournaments.length; i += FINAL_STANDINGS_CONCURRENCY) {
    const slice = tournaments.slice(i, i + FINAL_STANDINGS_CONCURRENCY)
    const results = await Promise.all(slice.map(async (t) => {
      try {
        return { tid: t.id, map: await getTournamentFinalStandings(t.id) }
      } catch (err) {
        console.error(`getTournamentFinalStandings failed for ${t.id}:`, err)
        return { tid: t.id, map: new Map() }
      }
    }))
    finalStandingsList.push(...results)
  }

  const champions: CircuitChampion[] = []
  for (const { tid, map } of finalStandingsList) {
    let championTeamId: string | null = null
    for (const [teamId, entry] of map) {
      if (entry.rank === 1) { championTeamId = teamId; break }
    }
    if (!championTeamId) continue
    const byTeam = tournamentTeamMap.get(tid)
    if (!byTeam) continue
    const stat = [...byTeam.values()].find((e) => e.teamId === championTeamId)
    if (!stat) continue
    champions.push({
      tournamentId: tid,
      teamId: stat.teamId,
      teamName: stat.teamName,
      logoUrl: stat.logoUrl,
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
