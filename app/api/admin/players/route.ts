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

  let body: { nickname?: string; real_name?: string; nationality?: string; nationality_code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { nickname, real_name, nationality, nationality_code } = body
  if (!nickname?.trim()) return NextResponse.json({ error: 'Nickname is required' }, { status: 400 })

  const db = serviceClient()

  // Check if nationality_code column exists, fall back gracefully if not
  const insertData: Record<string, string | null> = {
    nickname: nickname.trim(),
    real_name: real_name?.trim() || null,
    nationality: nationality?.trim() || null,
  }
  if (nationality_code !== undefined) {
    insertData.nationality_code = nationality_code?.trim().toUpperCase() || null
  }

  const { data, error } = await db
    .from('players')
    .insert([insertData])
    .select('*, player_aliases(*), teams(id, name, short_name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
