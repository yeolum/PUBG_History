import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// 서버 컴포넌트에서 사용 (쿠키 기반 세션)
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component에서는 쿠키 설정 불가 - 무시
          }
        },
      },
    }
  )
}

// 공개 페이지에서 사용 (쿠키 없음 → Next.js Data Cache 활성화)
// fetch에 next.revalidate를 주입하면 각 Supabase 쿼리 결과가 30초간
// Next.js Data Cache에 저장되어 동일 쿼리는 DB를 거치지 않고 즉시 응답.
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, next: { revalidate: 30 } } as RequestInit),
      },
    }
  )
}

// Admin API Routes에서 사용 (RLS 우회, 서버 사이드 전용)
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
