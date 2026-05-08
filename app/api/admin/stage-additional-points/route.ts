import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { revalidateTag } from 'next/cache'

async function getAuthUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

function serviceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let body: { stageId?: string; rows?: { teamName: string; teamId?: string | null; points: number }[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { stageId, rows } = body
  if (!stageId) return NextResponse.json({ error: 'stageId required' }, { status: 400 })

  const db = serviceClient()

  const { error: delErr } = await db
    .from('stage_additional_points')
    .delete()
    .eq('stage_id', stageId)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  const toInsert = (rows ?? [])
    .filter(r => r.teamName.trim() && r.points !== 0)
    .map(r => ({ stage_id: stageId, team_id: r.teamId ?? null, team_name: r.teamName.trim(), points: r.points }))

  if (toInsert.length > 0) {
    const { error: insErr } = await db.from('stage_additional_points').insert(toInsert)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  revalidateTag('tournament-data', 'default')
  return NextResponse.json({ ok: true, saved: toInsert.length })
}
