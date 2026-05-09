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
          fetch(input, { ...init, next: { revalidate: 30, tags: ['tournament-data'] } } as RequestInit),
      },
    }
  )
}

// unstable_cache 내부에서 사용 — fetch 레벨 캐싱 없이 항상 DB에서 직접 읽음.
// unstable_cache 자체가 30초 캐싱을 담당하므로 개별 fetch 캐시가 불필요하며,
// 이중 캐싱이 있으면 revalidateTag 후에도 내부 fetch 캐시가 stale 데이터를
// 반환하는 문제가 생길 수 있다.
export function createUncachedPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: 'no-store' } as RequestInit),
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
