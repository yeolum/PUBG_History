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

  const [matches, ttData, prizeConfigData] = await Promise.all([
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('matches').select('id, stage_id, status').in('stage_id', chunk).eq('status', 'imported'),
      stageIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('tournament_teams').select('tournament_id, team_id, disqualified, display_name').in('tournament_id', chunk),
      tournamentIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('tournament_prize_config').select('tournament_id, rank, stage_id, series_id, combined_scoreboard_id, stage_rank').in('tournament_id', chunk),
      tournamentIds,
    ),
  ])
  // Per-tournament team label override (rebrands / roster sales). Falls
  // back to the team's current global name when no override is set.
  const teamDisplayNameByTournament = new Map<string, string>() // key: `${tournamentId}:${teamId}`
  for (const r of ttData) {
    const tid = r.tournament_id as string
    const teamId = r.team_id as string | null
    const dn = r.display_name as string | null
    if (teamId && dn) teamDisplayNameByTournament.set(`${tid}:${teamId}`, dn)
  }
  const matchIds = matches.map((m) => m.id as string)

  const stageToTournament = new Map<string, string>()
  for (const s of stages) stageToTournament.set(s.id as string, s.tournament_id as string)
  const matchToTournament = new Map<string, string>()
  for (const m of matches) {
    const tid = stageToTournament.get(m.stage_id as string)
    if (tid) matchToTournament.set(m.id as string, tid)
  }
  // Per-tournament: which stage decides the champion. Priority order
  // mirrors what TournamentContent's Final Standings logic uses for
  // ranking_method='stage' (the typical PWS / PEC / PGC setup):
  //   1) prize_config row with rank=1 + stage_rank=1 → its mapped stage
  //   2) grand_final stage type
  // No deciding stage → fall back to tournament-wide aggregate.
  const decidingStageByTournament = new Map<string, string>()
  // First pass: prize_config rank=1, stage_rank=1 → stage_id (only stage
  // targets used here; series/combined-scoreboard targets need richer
  // aggregation that's out of scope for this index).
  for (const pc of prizeConfigData) {
    if (pc.rank !== 1 || pc.stage_rank !== 1) continue
    if (!pc.stage_id) continue
    const tid = pc.tournament_id as string
    if (!decidingStageByTournament.has(tid)) decidingStageByTournament.set(tid, pc.stage_id as string)
  }
  // Second pass: fall back to grand_final stage type for tournaments not
  // already decided by prize_config.
  for (const s of stages) {
    if (s.type !== 'grand_final') continue
    const tid = s.tournament_id as string
    if (!decidingStageByTournament.has(tid)) decidingStageByTournament.set(tid, s.id as string)
  }
  const decidingMatchIds = new Set<string>()
  for (const m of matches) {
    const sid = m.stage_id as string
    const tid = stageToTournament.get(sid)
    if (tid && decidingStageByTournament.get(tid) === sid) decidingMatchIds.add(m.id as string)
  }
  const dqByTournament = new Map<string, Set<string>>()
  for (const r of ttData) {
    if (!r.disqualified) continue
    const tid = r.tournament_id as string
    if (!dqByTournament.has(tid)) dqByTournament.set(tid, new Set())
    dqByTournament.get(tid)!.add(r.team_id as string)
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
  // Two per-tournament aggregates: one for the deciding stage only (used to
  // pick the champion) and one tournament-wide (used for the champions
  // table's stat columns).
  const decidingMap = new Map<string, Map<string, TeamAgg>>()
  const tournamentTeamMap = new Map<string, Map<string, TeamAgg>>()
  for (const tid of tournamentIds) {
    decidingMap.set(tid, new Map())
    tournamentTeamMap.set(tid, new Map())
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
    if (decidingMatchIds.has(r.match_id as string)) {
      bumpAgg(decidingMap.get(tournamentId)!, r)
    }
  }

  const champions: CircuitChampion[] = []
  // Track each champion's PUBG tag at the time so we can resolve the
  // period-correct logo from team_aliases below.
  const championPubgTagByTournament = new Map<string, string>()
  for (const tid of tournamentIds) {
    const dq = dqByTournament.get(tid) ?? new Set<string>()
    const isDq = (e: TeamAgg) => !!e.teamId && dq.has(e.teamId)
    const wide = tournamentTeamMap.get(tid)
    const deciding = decidingMap.get(tid)
    // Pick from the deciding stage when present (matches Final Standings
    // top spot for ranking_method='stage' tournaments, which is the typical
    // PWS / PEC / PGC layout), otherwise fall back to tournament-wide.
    const pool = (deciding && deciding.size > 0) ? deciding : wide
    if (!pool || pool.size === 0) continue
    const sorted = [...pool.values()]
      .filter((e) => !isDq(e))
      .sort((a, b) => b.totalPoints - a.totalPoints)
    if (sorted.length === 0) continue
    const c = sorted[0]
    // Stat columns reflect tournament-wide totals so matches / wins /
    // kills / points read the same as before.
    const wideEntry = wide ? [...wide.values()].find((e) => e.teamId === c.teamId) : null
    const stat = wideEntry ?? c
    // Snapshot the team's in-game tag from one of their match results in
    // this tournament — used to look up the period logo from team_aliases.
    if (c.teamId) {
      for (const r of allTeamResults) {
        if (matchToTournament.get(r.match_id as string) !== tid) continue
        if (r.team_id !== c.teamId) continue
        if (r.pubg_team_name) {
          championPubgTagByTournament.set(tid, r.pubg_team_name as string)
          break
        }
      }
    }
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

  // Period-correct name + logo override for each champion. The match data
  // joined to teams.name / teams.logo_url returns the team's *current*
  // identity, so a team that's since rebranded (KWANGDONG FREECS →
  // DN SOOPers) would otherwise show its new name on a 2-year-old win.
  // tournament_teams.display_name is the per-tournament label admin
  // entered when bulk-adding the team; team_aliases.logo_url is the
  // historical logo keyed by the tag the team used in-game that period.
  const championTeamIds = [...new Set(champions.map((c) => c.teamId).filter((x): x is string => !!x))]
  if (championTeamIds.length > 0) {
    const aliasRows = await fetchInChunked<AnyRow>(
      (chunk) => supabase.from('team_aliases').select('team_id, alias, logo_url').in('team_id', chunk),
      championTeamIds,
    )
    const aliasLogo = new Map<string, string>() // key: `${teamId}:${aliasLower}`
    for (const a of aliasRows) {
      const teamId = a.team_id as string
      const alias = (a.alias as string).toLowerCase()
      const logo = a.logo_url as string | null
      if (logo) aliasLogo.set(`${teamId}:${alias}`, logo)
    }
    for (const c of champions) {
      if (!c.teamId) continue
      const dn = teamDisplayNameByTournament.get(`${c.tournamentId}:${c.teamId}`)
      if (dn) c.teamName = dn
      const tag = championPubgTagByTournament.get(c.tournamentId)
      if (tag) {
        const periodLogo = aliasLogo.get(`${c.teamId}:${tag.toLowerCase()}`)
        if (periodLogo) c.logoUrl = periodLogo
      }
    }
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

  // Aggregate global player stats. The team column shows the player's
  // *current* team from the players table (players.team_id), not a team
  // pulled from match data — admin maintains this via the player profile
  // / Sync Teams workflow, so it's the canonical answer.
  const globalPlayerMap = new Map<string, {
    playerId: string | null; nickname: string
    tournamentSet: Set<string>; matches: number; kills: number; assists: number; knocks: number; headshotKills: number; damage: number
  }>()

  for (const s of allPlayerStats) {
    const tournamentId = matchToTournament.get(s.match_id as string)
    const key = (s.player_id ?? s.pubg_player_name ?? '?') as string
    let ex = globalPlayerMap.get(key)
    if (!ex) {
      ex = {
        playerId: (s.player_id ?? null) as string | null,
        nickname: (s.players as AnyRow | null)?.nickname ?? (s.pubg_player_name as string) ?? '?',
        tournamentSet: new Set<string>(), matches: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0,
      }
      globalPlayerMap.set(key, ex)
    }
    if (tournamentId) ex.tournamentSet.add(tournamentId)
    ex.matches++
    ex.kills += (s.kills as number) ?? 0
    ex.assists += (s.assists as number) ?? 0
    ex.knocks += (s.knocks as number) ?? 0
    ex.headshotKills += (s.headshot_kills as number) ?? 0
    ex.damage += (s.damage_dealt as number) ?? 0
  }

  // Pull each linked player's current team from the players table — this
  // is the canonical "소속팀" admin sets via the player profile, not
  // anything inferred from match data. Players with team_id = NULL show
  // as no team.
  const linkedPlayerIds = [...new Set(
    [...globalPlayerMap.values()].map((p) => p.playerId).filter((x): x is string => !!x),
  )]
  const playerCurrentTeam = new Map<string, { teamId: string | null; teamName: string | null; logoUrl: string | null }>()
  if (linkedPlayerIds.length > 0) {
    const rows = await fetchInChunked<AnyRow>(
      (chunk) => supabase.from('players').select('id, team_id, teams(id, name, logo_url)').in('id', chunk),
      linkedPlayerIds,
    )
    for (const r of rows) {
      const teamRel = (r.teams as AnyRow | null) ?? null
      playerCurrentTeam.set(r.id as string, {
        teamId: (r.team_id as string | null) ?? null,
        teamName: (teamRel?.name as string | null) ?? null,
        logoUrl: (teamRel?.logo_url as string | null) ?? null,
      })
    }
  }

  const playerStats: CircuitPlayerStat[] = [...globalPlayerMap.values()]
    .map((p) => {
      const current = p.playerId ? playerCurrentTeam.get(p.playerId) : null
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        teamId: current?.teamId ?? null,
        teamName: current?.teamName ?? '',
        logoUrl: current?.logoUrl ?? null,
        tournaments: p.tournamentSet.size,
        matches: p.matches,
        kills: p.kills, assists: p.assists, knocks: p.knocks, headshotKills: p.headshotKills, damage: p.damage,
      }
    })
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
