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

  let body: { name?: string; short_name?: string; nationality?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, short_name, nationality } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })

  const db = serviceClient()

  const { data, error } = await db
    .from('teams')
    .insert([{
      name: name.trim(),
      short_name: short_name?.trim() || null,
      nationality: nationality?.trim() || null,
    }])
    .select('*, team_aliases(*)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-insert combined alias "TAG - Name" (or just name if no tag)
  if (data?.id) {
    const tag = short_name?.trim()
    const teamName = name.trim()
    const alias = tag ? `${tag} - ${teamName}` : teamName
    await db.from('team_aliases').insert([{ team_id: data.id, alias }]).select()
    // Re-fetch with updated aliases
    const { data: refreshed } = await db.from('teams').select('*, team_aliases(*)').eq('id', data.id).single()
    return NextResponse.json({ data: refreshed ?? data })
  }

  return NextResponse.json({ data })
}
