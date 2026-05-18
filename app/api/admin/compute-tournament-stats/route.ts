import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { revalidateTag } from 'next/cache'
import { cookies } from 'next/headers'
import { computeTournamentStats } from '@/lib/compute-stats'
import { computeDropLocations } from '@/lib/compute-drops'

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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { tournamentId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { tournamentId } = body
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })

  const db = serviceClient()
  try {
    await computeTournamentStats(tournamentId, db)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[compute-tournament-stats]', tournamentId, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  try {
    // 새로고침 시에는 텔레메트리 재다운로드 없이 기존 착지 데이터만 재집계
    await computeDropLocations(tournamentId, db, { skipTelemetryFetch: true })
  } catch (err) {
    console.error('[compute-tournament-stats] computeDropLocations failed:', err)
  }

  revalidateTag('tournament-data', 'default')
  return NextResponse.json({ ok: true })
}
