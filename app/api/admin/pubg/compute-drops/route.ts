import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { computeDropLocations } from '@/lib/compute-drops'

export const maxDuration = 300 // 5분 — 텔레메트리 일괄 다운로드 허용

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

  let body: { tournamentId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { tournamentId } = body
  if (!tournamentId) return NextResponse.json({ error: 'tournamentId required' }, { status: 400 })

  const db = serviceClient()
  const stats = await computeDropLocations(tournamentId, db)

  return NextResponse.json({
    success: true,
    newlyProcessed: stats.newlyProcessed,
    skipped: stats.skipped,
    stageDropsUpdated: stats.stageDropsUpdated,
    tournamentDropsUpdated: stats.tournamentDropsUpdated,
    errors: stats.errors,
  })
}
