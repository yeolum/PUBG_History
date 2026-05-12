import { NextRequest, NextResponse } from 'next/server'
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

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let body: { fromId: string; targetId: string; fromName: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { fromId, targetId, fromName } = body
  if (!fromId || !targetId || !fromName) return NextResponse.json({ error: 'fromId, targetId, fromName required' }, { status: 400 })
  if (fromId === targetId) return NextResponse.json({ error: 'Cannot merge team into itself' }, { status: 400 })

  const svc = serviceClient()

  // 1. Add old team name as alias on target team
  await svc.from('team_aliases').upsert(
    [{ team_id: targetId, alias: fromName }],
    { onConflict: 'alias', ignoreDuplicates: true },
  )

  // 2. Update match-level tables
  await svc.from('match_team_results').update({ team_id: targetId }).eq('team_id', fromId)
  await svc.from('match_player_stats').update({ team_id: targetId }).eq('team_id', fromId)
  await svc.from('players').update({ team_id: targetId }).eq('team_id', fromId)

  // 3. Handle tournament_teams (composite PK: tournament_id, team_id)
  const { data: teamTournaments } = await svc
    .from('tournament_teams')
    .select('tournament_id, disqualified, display_name')
    .eq('team_id', fromId)

  if (teamTournaments && teamTournaments.length > 0) {
    const allTids = teamTournaments.map((r) => r.tournament_id)

    const { data: targetOverlap } = await svc
      .from('tournament_teams')
      .select('tournament_id')
      .eq('team_id', targetId)
      .in('tournament_id', allTids)

    const conflictTids = new Set((targetOverlap ?? []).map((r) => r.tournament_id))
    const conflictList = [...conflictTids]
    const nonConflictList = allTids.filter((tid) => !conflictTids.has(tid))

    // Delete fromId rows where target already participates in same tournament
    if (conflictList.length > 0) {
      await svc.from('tournament_teams').delete().eq('team_id', fromId).in('tournament_id', conflictList)
    }
    // Update remaining rows to targetId
    if (nonConflictList.length > 0) {
      await svc.from('tournament_teams').update({ team_id: targetId }).eq('team_id', fromId).in('tournament_id', nonConflictList)
    }
  }

  // 4. Update tournament_players.team_id (tournament-scoped team assignment)
  await svc.from('tournament_players').update({ team_id: targetId }).eq('team_id', fromId)

  // 5. Update pre-computed stats tables (team_id reference)
  await svc.from('tournament_player_stats').update({ team_id: targetId }).eq('team_id', fromId)
  await svc.from('tournament_team_stats').update({ team_id: targetId }).eq('team_id', fromId)
  await svc.from('stage_player_stats').update({ team_id: targetId }).eq('team_id', fromId)
  await svc.from('kill_club_100').update({ team_id: targetId }).eq('team_id', fromId)
  await svc.from('tournament_final_standings').update({ team_id: targetId }).eq('team_id', fromId)

  // 6. Update other team-linked tables
  await svc.from('team_drop_locations').update({ team_id: targetId }).eq('team_id', fromId)
  await svc.from('stage_additional_points').update({ team_id: targetId }).eq('team_id', fromId)

  // 7. Delete the old team (cascade removes team_aliases)
  const { error: delErr } = await svc.from('teams').delete().eq('id', fromId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
