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
  if (fromId === targetId) return NextResponse.json({ error: 'Cannot merge player into itself' }, { status: 400 })

  const svc = serviceClient()

  // 1. Add old nickname as alias on target player
  await svc.from('player_aliases').upsert(
    [{ player_id: targetId, alias: fromName }],
    { onConflict: 'player_id,alias', ignoreDuplicates: true },
  )

  // 2. Update match_player_stats
  await svc.from('match_player_stats').update({ player_id: targetId }).eq('player_id', fromId)

  // 3. Handle tournament_players (composite PK: tournament_id, player_id)
  const { data: playerTournaments } = await svc
    .from('tournament_players')
    .select('tournament_id')
    .eq('player_id', fromId)

  if (playerTournaments && playerTournaments.length > 0) {
    const allTids = playerTournaments.map((r) => r.tournament_id)

    const { data: targetOverlap } = await svc
      .from('tournament_players')
      .select('tournament_id')
      .eq('player_id', targetId)
      .in('tournament_id', allTids)

    const conflictTids = new Set((targetOverlap ?? []).map((r) => r.tournament_id))
    const conflictList = [...conflictTids]
    const nonConflictList = allTids.filter((tid) => !conflictTids.has(tid))

    // Delete fromId rows where target already participates
    if (conflictList.length > 0) {
      await svc.from('tournament_players').delete().eq('player_id', fromId).in('tournament_id', conflictList)
    }
    // Update remaining rows to targetId
    if (nonConflictList.length > 0) {
      await svc.from('tournament_players').update({ player_id: targetId }).eq('player_id', fromId).in('tournament_id', nonConflictList)
    }
  }

  // 4. Update pre-computed stats tables (player_id reference)
  await svc.from('tournament_player_stats').update({ player_id: targetId }).eq('player_id', fromId)
  await svc.from('stage_player_stats').update({ player_id: targetId }).eq('player_id', fromId)
  await svc.from('kill_club_100').update({ player_id: targetId }).eq('player_id', fromId)

  // 5. Delete the old player (cascade removes player_aliases)
  const { error: delErr } = await svc.from('players').delete().eq('id', fromId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
