import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { revalidatePath, revalidateTag } from 'next/cache'
import { cookies } from 'next/headers'

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

interface Body {
  tournamentId?: string
  teamId?: string
  playerId?: string
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request format' }, { status: 400 })
  }

  // Tournament edits are by far the most common admin write. Invalidate the
  // shared in-process cache, then refresh the ISR-cached public pages that
  // pull from it.
  if (body.tournamentId) {
    revalidateTag('tournament-data', 'default')
    revalidatePath('/')
    revalidatePath('/tournaments')
    revalidatePath(`/tournaments/${body.tournamentId}`)
  }

  if (body.teamId) {
    revalidatePath('/teams')
    revalidatePath(`/teams/${body.teamId}`)
  }

  if (body.playerId) {
    revalidatePath('/players')
    revalidatePath(`/players/${body.playerId}`)
  }

  return NextResponse.json({ ok: true })
}
