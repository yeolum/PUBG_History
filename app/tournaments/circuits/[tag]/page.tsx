import { createPublicClient } from '@/lib/supabase/server'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Tournament } from '@/lib/types'
import type { Metadata } from 'next'
import CircuitContent from './CircuitContent'
import { calcPlacementPtsWithRule, DEFAULT_RULE } from '@/lib/scoring'

export const revalidate = 30

type Props = { params: Promise<{ tag: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tag } = await params
  return { title: `${tag} History` }
}


const PAGE_SIZE = 1000
const ID_CHUNK = 80

// Page through a query in 1000-row windows. Used after the IN list is
// already constrained to a single chunk by the helpers below.
async function fetchPaged<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any,
): Promise<T[]> {
  const rows: T[] = []
  let page = 0
  while (true) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: batch, error } = await build().order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) throw new Error(`DB fetch failed: ${(error as any)?.message ?? String(error)}`)
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
  // Wrap in thunk so fetchPaged gets a fresh builder each page iteration
  const out = await Promise.all(chunks.map((c) => fetchPaged<T>(() => build(c))))
  return out.flat()
}

export interface TournamentTeamBreakdown {
  tournamentId: string
  tournamentName: string
  matches: number
  wins: number
  kills: number
  damage: number
}

export interface TournamentPlayerBreakdown {
  tournamentId: string
  tournamentName: string
  matches: number
  kills: number
  assists: number
  knocks: number
  headshotKills: number
  damage: number
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
  breakdown: TournamentTeamBreakdown[]
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
  breakdown: TournamentPlayerBreakdown[]
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

export interface KillClub100Entry {
  tournamentId: string
  tournamentName: string
  playerId: string | null
  nickname: string
  teamId: string | null
  teamName: string
  logoUrl: string | null
  kills: number
  games: number
  damage: number
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

  const tournamentById = new Map<string, Tournament>(tournaments.map((t) => [t.id, t]))
  const tournamentIds = tournaments.map((t) => t.id)

  const stages = await fetchInChunked<AnyRow>(
    (chunk) => supabase.from('stages').select('id, tournament_id').in('tournament_id', chunk),
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
            killClub100={[]}
          />
        </main>
      </>
    )
  }

  const [matches, ttData, finalStandingsData] = await Promise.all([
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('matches').select('id, stage_id, status').in('stage_id', chunk).eq('status', 'imported'),
      stageIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('tournament_teams').select('tournament_id, team_id, disqualified, display_name').in('tournament_id', chunk),
      tournamentIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('tournament_final_standings').select('tournament_id, rank, team_id, team_name').in('tournament_id', chunk).eq('rank', 1),
      tournamentIds,
    ),
  ])
  // Per-tournament team label override (rebrands / roster sales).
  const teamDisplayNameByTournament = new Map<string, string>() // key: `${tournamentId}:${teamId}`
  for (const r of ttData) {
    const tid = r.tournament_id as string
    const teamId = r.team_id as string | null
    const dn = r.display_name as string | null
    if (teamId && dn) teamDisplayNameByTournament.set(`${tid}:${teamId}`, dn)
  }
  const matchIds = matches.map((m) => m.id as string)

  const stageToTournament = new Map<string, string>()
  for (const s of stages) {
    stageToTournament.set(s.id as string, s.tournament_id as string)
  }
  const matchToTournament = new Map<string, string>()
  for (const m of matches) {
    const tid = stageToTournament.get(m.stage_id as string)
    if (tid) matchToTournament.set(m.id as string, tid)
  }

  // Champion (rank=1) from pre-computed final standings
  const championByTournament = new Map<string, AnyRow>()
  for (const s of finalStandingsData) {
    if (s.rank === 1) championByTournament.set(s.tournament_id as string, s)
  }

  const dqByTournament = new Map<string, Set<string>>()
  for (const r of ttData) {
    if (!r.disqualified) continue
    const tid = r.tournament_id as string
    if (!dqByTournament.has(tid)) dqByTournament.set(tid, new Set())
    dqByTournament.get(tid)!.add(r.team_id as string)
  }

  const [allTeamResults, ttsRows, tpsRows, kcRows] = await Promise.all([
    fetchInChunked<AnyRow>(
      (chunk) => supabase
        .from('match_team_results')
        .select('id, match_id, team_id, pubg_team_name, placement, total_kills, total_damage, teams(id, name, logo_url)')
        .in('match_id', chunk),
      matchIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('tournament_team_stats').select('*').in('tournament_id', chunk),
      tournamentIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('tournament_player_stats').select('*').in('tournament_id', chunk),
      tournamentIds,
    ),
    fetchInChunked<AnyRow>(
      (chunk) => supabase.from('kill_club_100').select('*').in('tournament_id', chunk),
      tournamentIds,
    ),
  ])

  type TeamAgg = {
    teamId: string | null; teamName: string; logoUrl: string | null
    matches: number; wins: number; kills: number; damage: number; totalPoints: number
  }
  const tournamentTeamMap = new Map<string, Map<string, TeamAgg>>()
  for (const tid of tournamentIds) tournamentTeamMap.set(tid, new Map())

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
    ex.totalPoints += calcPlacementPtsWithRule((r.placement as number) ?? 99, DEFAULT_RULE) + Math.round(((r.total_kills as number) ?? 0) * DEFAULT_RULE.kill_pts)
    if (r.placement === 1) ex.wins++
    byTeam.set(key, ex)
  }

  for (const r of allTeamResults) {
    const tournamentId = matchToTournament.get(r.match_id as string)
    if (!tournamentId) continue
    bumpAgg(tournamentTeamMap.get(tournamentId)!, r)
  }

  const champions: CircuitChampion[] = []
  // Track each champion's PUBG tag at the time so we can resolve the
  // period-correct logo from team_aliases below.
  const championPubgTagByTournament = new Map<string, string>()
  for (const tid of tournamentIds) {
    const standing = championByTournament.get(tid)
    if (!standing || !standing.team_id) continue
    const dq = dqByTournament.get(tid) ?? new Set<string>()
    if (dq.has(standing.team_id as string)) continue

    const wide = tournamentTeamMap.get(tid)
    const wideEntry = wide ? [...wide.values()].find((e) => e.teamId === standing.team_id) : null
    const stat = wideEntry ?? { totalPoints: 0, kills: 0, wins: 0, matches: 0, damage: 0 }

    // Snapshot the team's in-game tag for period-correct logo resolution
    if (standing.team_id) {
      for (const r of allTeamResults) {
        if (matchToTournament.get(r.match_id as string) !== tid) continue
        if (r.team_id !== standing.team_id) continue
        if (r.pubg_team_name) { championPubgTagByTournament.set(tid, r.pubg_team_name as string); break }
      }
    }
    champions.push({
      tournamentId: tid,
      teamId: standing.team_id as string | null,
      teamName: standing.team_name as string,
      logoUrl: wideEntry?.logoUrl ?? null,
      totalPoints: stat.totalPoints,
      totalKills: stat.kills,
      wins: stat.wins,
      matches: stat.matches,
    })
  }

  // Period-correct name + logo override for each champion. Same priority
  // the public tournament page uses in resolveTeamName / resolveLogoUrl:
  //   name:  tournament_teams.display_name
  //          → team_aliases (\"TAG - Name\" entry → name part) keyed by
  //            the in-game pubg_team_name the team used that tournament
  //          → fallback to global teams.name
  //   logo:  team_aliases.logo_url keyed by the in-game tag (full alias
  //          OR the tag part of a \"TAG - Name\" entry)
  //          → fallback to global teams.logo_url
  const championTeamIds = [...new Set(champions.map((c) => c.teamId).filter((x): x is string => !!x))]
  if (championTeamIds.length > 0) {
    const aliasRows = await fetchInChunked<AnyRow>(
      (chunk) => supabase.from('team_aliases').select('team_id, alias, logo_url').in('team_id', chunk),
      championTeamIds,
    )
    const aliasLogo = new Map<string, string>()       // key: `${teamId}:${aliasOrTagLower}` → logo_url
    const aliasTagToName = new Map<string, string>()  // key: `${teamId}:${tagLower}`        → name part
    for (const a of aliasRows) {
      const teamId = a.team_id as string
      const alias = a.alias as string
      const logo = a.logo_url as string | null
      const aliasLower = alias.toLowerCase()
      if (logo) aliasLogo.set(`${teamId}:${aliasLower}`, logo)
      // "TAG - Name" entries: extract the tag (logo / tag→name lookup)
      // and the name (tag→name fallback).
      const dashIdx = alias.indexOf(' - ')
      if (dashIdx !== -1) {
        const tagPart = alias.slice(0, dashIdx).trim()
        const namePart = alias.slice(dashIdx + 3).trim()
        const tagLower = tagPart.toLowerCase()
        if (tagPart && logo) {
          const tagKey = `${teamId}:${tagLower}`
          if (!aliasLogo.has(tagKey)) aliasLogo.set(tagKey, logo)
        }
        if (tagPart && namePart) {
          const k = `${teamId}:${tagLower}`
          if (!aliasTagToName.has(k)) aliasTagToName.set(k, namePart)
        }
      }
    }
    for (const c of champions) {
      if (!c.teamId) continue
      const tag = championPubgTagByTournament.get(c.tournamentId) ?? null
      const tagLower = tag?.toLowerCase() ?? ''
      // Name override: tournament-scoped first, then alias-derived name
      // mapped from the team's pubg tag that period.
      const dn = teamDisplayNameByTournament.get(`${c.tournamentId}:${c.teamId}`)
      const aliasName = tagLower ? aliasTagToName.get(`${c.teamId}:${tagLower}`) : undefined
      if (dn) c.teamName = dn
      else if (aliasName) c.teamName = aliasName
      // Logo override.
      if (tagLower) {
        const periodLogo = aliasLogo.get(`${c.teamId}:${tagLower}`)
        if (periodLogo) c.logoUrl = periodLogo
      }
    }
  }

  // Build team stats from pre-computed tournament_team_stats table
  const globalTeamMap = new Map<string, {
    teamId: string | null; teamName: string; logoUrl: string | null
    tournamentSet: Set<string>; matches: number; wins: number; kills: number; damage: number
  }>()
  const breakdownByTeam = new Map<string, TournamentTeamBreakdown[]>()

  for (const r of ttsRows) {
    const tid = r.tournament_id as string
    const key = (r.team_id ?? r.team_name ?? '?') as string
    const ex = globalTeamMap.get(key) ?? {
      teamId: (r.team_id ?? null) as string | null,
      teamName: r.team_name as string,
      logoUrl: (r.logo_url ?? null) as string | null,
      tournamentSet: new Set<string>(), matches: 0, wins: 0, kills: 0, damage: 0,
    }
    ex.tournamentSet.add(tid)
    ex.matches += (r.games as number) ?? 0
    ex.wins += (r.wwcd as number) ?? 0
    ex.kills += (r.total_kills as number) ?? 0
    ex.damage += Number(r.total_damage ?? 0)
    globalTeamMap.set(key, ex)

    if (!breakdownByTeam.has(key)) breakdownByTeam.set(key, [])
    breakdownByTeam.get(key)!.push({
      tournamentId: tid,
      tournamentName: tournamentById.get(tid)?.name ?? tid,
      matches: (r.games as number) ?? 0,
      wins: (r.wwcd as number) ?? 0,
      kills: (r.total_kills as number) ?? 0,
      damage: Number(r.total_damage ?? 0),
    })
  }

  const teamStats: CircuitTeamStat[] = [...globalTeamMap.entries()]
    .map(([key, t]) => {
      const breakdown = (breakdownByTeam.get(key) ?? []).sort((a, b) => {
        const ta = tournamentById.get(a.tournamentId)?.start_date ?? ''
        const tb = tournamentById.get(b.tournamentId)?.start_date ?? ''
        return tb > ta ? 1 : tb < ta ? -1 : 0
      })
      return { teamId: t.teamId, teamName: t.teamName, logoUrl: t.logoUrl, tournaments: t.tournamentSet.size, matches: t.matches, wins: t.wins, kills: t.kills, damage: t.damage, breakdown }
    })
    .sort((a, b) => b.kills - a.kills)

  // Build player stats from pre-computed tournament_player_stats table.
  // Current team shown from players.team_id (canonical, admin-maintained).
  const globalPlayerMap = new Map<string, {
    playerId: string | null; nickname: string
    tournamentSet: Set<string>; matches: number; kills: number; assists: number; knocks: number; headshotKills: number; damage: number
  }>()
  const breakdownByPlayer = new Map<string, TournamentPlayerBreakdown[]>()

  for (const r of tpsRows) {
    const tid = r.tournament_id as string
    const key = (r.player_id ?? `pubg:${(r.nickname as string ?? '').toLowerCase()}`) as string
    const ex = globalPlayerMap.get(key) ?? {
      playerId: (r.player_id ?? null) as string | null,
      nickname: r.nickname as string,
      tournamentSet: new Set<string>(), matches: 0, kills: 0, assists: 0, knocks: 0, headshotKills: 0, damage: 0,
    }
    ex.tournamentSet.add(tid)
    ex.matches += (r.games as number) ?? 0
    ex.kills += (r.kills as number) ?? 0
    ex.assists += (r.assists as number) ?? 0
    ex.knocks += (r.knocks as number) ?? 0
    ex.headshotKills += (r.headshot_kills as number) ?? 0
    ex.damage += Number(r.damage ?? 0)
    globalPlayerMap.set(key, ex)

    if (!breakdownByPlayer.has(key)) breakdownByPlayer.set(key, [])
    breakdownByPlayer.get(key)!.push({
      tournamentId: tid,
      tournamentName: tournamentById.get(tid)?.name ?? tid,
      matches: (r.games as number) ?? 0,
      kills: (r.kills as number) ?? 0,
      assists: (r.assists as number) ?? 0,
      knocks: (r.knocks as number) ?? 0,
      headshotKills: (r.headshot_kills as number) ?? 0,
      damage: Number(r.damage ?? 0),
    })
  }

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

  const playerStats: CircuitPlayerStat[] = [...globalPlayerMap.entries()]
    .map(([key, p]) => {
      const current = p.playerId ? playerCurrentTeam.get(p.playerId) : null
      const breakdown = (breakdownByPlayer.get(key) ?? []).sort((a, b) => {
        const ta = tournamentById.get(a.tournamentId)?.start_date ?? ''
        const tb = tournamentById.get(b.tournamentId)?.start_date ?? ''
        return tb > ta ? 1 : tb < ta ? -1 : 0
      })
      return {
        playerId: p.playerId, nickname: p.nickname,
        teamId: current?.teamId ?? null, teamName: current?.teamName ?? '', logoUrl: current?.logoUrl ?? null,
        tournaments: p.tournamentSet.size, matches: p.matches, kills: p.kills, assists: p.assists, knocks: p.knocks, headshotKills: p.headshotKills, damage: p.damage,
        breakdown,
      }
    })
    .sort((a, b) => b.kills - a.kills)

  const killClub100: KillClub100Entry[] = kcRows
    .map((r) => ({
      tournamentId: r.tournament_id as string,
      tournamentName: tournamentById.get(r.tournament_id as string)?.name ?? (r.tournament_id as string),
      playerId: (r.player_id ?? null) as string | null,
      nickname: r.nickname as string,
      teamId: (r.team_id ?? null) as string | null,
      teamName: (r.team_name ?? '') as string,
      logoUrl: (r.logo_url ?? null) as string | null,
      kills: (r.kills as number) ?? 0,
      games: (r.games as number) ?? 0,
      damage: Number(r.damage ?? 0),
    }))
    .sort((a, b) => {
      const da = tournamentById.get(a.tournamentId)?.start_date ?? ''
      const db = tournamentById.get(b.tournamentId)?.start_date ?? ''
      return db > da ? 1 : db < da ? -1 : b.kills - a.kills
    })

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
          killClub100={killClub100}
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
