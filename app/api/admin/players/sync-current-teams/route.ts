import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

async function getAuthUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const PAGE = 1000

async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const all: T[] = []
  let p = 0
  while (true) {
    const { data, error } = await query(p * PAGE, (p + 1) * PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as T[]
    all.push(...batch)
    if (batch.length < PAGE) break
    p++
  }
  return all
}

export async function POST() {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const db = serviceClient()
  const year = new Date().getFullYear()
  const yearStart = `${year}-01-01`
  const yearEnd = `${year + 1}-01-01`

  // Tournaments held this year — by start_date when present, otherwise end_date.
  // Fetch the union; we only need (id, sort_date) to pick the most recent participation.
  const [byStart, byEndOnly] = await Promise.all([
    fetchAll<{ id: string; start_date: string | null; end_date: string | null }>((from, to) =>
      db.from('tournaments')
        .select('id, start_date, end_date')
        .gte('start_date', yearStart)
        .lt('start_date', yearEnd)
        .range(from, to),
    ),
    fetchAll<{ id: string; start_date: string | null; end_date: string | null }>((from, to) =>
      db.from('tournaments')
        .select('id, start_date, end_date')
        .is('start_date', null)
        .gte('end_date', yearStart)
        .lt('end_date', yearEnd)
        .range(from, to),
    ),
  ])
  const tournamentSortDate = new Map<string, string>()
  for (const t of [...byStart, ...byEndOnly]) {
    const d = t.start_date ?? t.end_date
    if (d) tournamentSortDate.set(t.id, d)
  }
  const tournamentIds = [...tournamentSortDate.keys()]

  // Walk tournament_players for those tournaments. Filtering by IN can break
  // when the list is huge, so chunk the IN list.
  const ID_CHUNK = 200
  const tps: { tournament_id: string; player_id: string; team_id: string | null }[] = []
  for (let i = 0; i < tournamentIds.length; i += ID_CHUNK) {
    const chunk = tournamentIds.slice(i, i + ID_CHUNK)
    if (chunk.length === 0) continue
    const rows = await fetchAll<{ tournament_id: string; player_id: string; team_id: string | null }>((from, to) =>
      db.from('tournament_players')
        .select('tournament_id, player_id, team_id')
        .in('tournament_id', chunk)
        .range(from, to),
    )
    tps.push(...rows)
  }

  // For each player, pick the team_id from the tournament with the latest sort_date.
  const mostRecent = new Map<string, { date: string; teamId: string | null }>()
  for (const tp of tps) {
    const date = tournamentSortDate.get(tp.tournament_id)
    if (!date) continue
    const cur = mostRecent.get(tp.player_id)
    if (!cur || date > cur.date) mostRecent.set(tp.player_id, { date, teamId: tp.team_id })
  }

  // Pull every player's current team to skip no-op writes.
  const players = await fetchAll<{ id: string; team_id: string | null }>((from, to) =>
    db.from('players').select('id, team_id').range(from, to),
  )

  const setTeam: { id: string; team_id: string }[] = []
  const clearTeam: string[] = []
  for (const p of players) {
    const desired = mostRecent.has(p.id) ? mostRecent.get(p.id)!.teamId : null
    if (desired === p.team_id) continue
    if (desired === null) clearTeam.push(p.id)
    else setTeam.push({ id: p.id, team_id: desired })
  }

  // Apply updates in parallel batches.
  const BATCH = 25
  const errors: string[] = []
  for (let i = 0; i < setTeam.length; i += BATCH) {
    const slice = setTeam.slice(i, i + BATCH)
    const results = await Promise.all(
      slice.map((u) => db.from('players').update({ team_id: u.team_id }).eq('id', u.id)),
    )
    for (const r of results) if (r.error) errors.push(r.error.message)
  }
  if (clearTeam.length > 0) {
    for (let i = 0; i < clearTeam.length; i += 200) {
      const slice = clearTeam.slice(i, i + 200)
      const { error } = await db.from('players').update({ team_id: null }).in('id', slice)
      if (error) errors.push(error.message)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({
      error: `${errors.length} update(s) failed: ${errors[0]}`,
      year,
      tournaments: tournamentIds.length,
      assigned: setTeam.length,
      cleared: clearTeam.length,
    }, { status: 500 })
  }

  return NextResponse.json({
    year,
    tournaments: tournamentIds.length,
    participants: mostRecent.size,
    assigned: setTeam.length,
    cleared: clearTeam.length,
    unchanged: players.length - setTeam.length - clearTeam.length,
  })
}
