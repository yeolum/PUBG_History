// Public-page cache invalidation called after admin writes so the user
// site reflects the change immediately instead of waiting for the 30s
// ISR / unstable_cache window.
//
// Failures are surfaced via console.warn — a stale public page is better
// than aborting the admin save, but we want it visible during debugging.

interface RevalidateInput {
  tournamentId?: string
  teamId?: string
  playerId?: string
}

export async function revalidatePublic(input: RevalidateInput): Promise<void> {
  try {
    const res = await fetch('/api/admin/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(`[revalidate] ${res.status} ${res.statusText}`, text, input)
    }
  } catch (err) {
    console.warn('[revalidate] request failed', err, input)
  }
}
