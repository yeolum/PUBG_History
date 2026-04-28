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

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let body: {
    id?: string; nickname?: string; real_name?: string | null; nationality?: string | null
    nationality_code?: string | null; birth_date?: string | null; team_id?: string | null; profile_pic?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const db = serviceClient()

  let result = await db.from('players').update(fields).eq('id', id)

  if (result.error?.message?.includes('nationality_code')) {
    const { nationality_code: _nc, ...fieldsBase } = fields
    void _nc
    result = await db.from('players').update(fieldsBase).eq('id', id)
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  let body: { nickname?: string; real_name?: string; nationality?: string; nationality_code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { nickname, real_name, nationality, nationality_code } = body
  if (!nickname?.trim()) return NextResponse.json({ error: 'Nickname is required' }, { status: 400 })

  const db = serviceClient()

  // First try with nationality_code; if the column doesn't exist yet, retry without it
  const insertFull = {
    nickname: nickname.trim(),
    real_name: real_name?.trim() || null,
    nationality: nationality?.trim() || null,
    nationality_code: nationality_code?.trim().toUpperCase() || null,
  }

  let result = await db
    .from('players')
    .insert([insertFull])
    .select('*, player_aliases(*), teams(id, name, short_name)')
    .single()

  if (result.error?.message?.includes('nationality_code')) {
    // Column not migrated yet — insert without it
    const { nationality_code: _nc, ...insertBase } = insertFull
    void _nc
    result = await db
      .from('players')
      .insert([insertBase])
      .select('*, player_aliases(*), teams(id, name, short_name)')
      .single()
  }

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

  // Auto-insert nickname as alias
  if (result.data?.id) {
    await db.from('player_aliases').insert([{ player_id: result.data.id, alias: nickname.trim() }])
    const { data: refreshed } = await db
      .from('players')
      .select('*, player_aliases(*), teams(id, name, short_name)')
      .eq('id', result.data.id)
      .single()
    return NextResponse.json({ data: refreshed ?? result.data })
  }

  return NextResponse.json({ data: result.data })
}
